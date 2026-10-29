/**
 * Request handling, independent of the Workers runtime (fully unit-tested).
 * Order: validate → IP limit → entitlement → device integrity → quota →
 * budget reservation (worst case) → LLM → settle spend. Script text is never logged.
 */
import {
  INTEGRITY_DEFAULTS,
  decideIntegrity,
  issueChallenge,
  registerAppAttestKey,
  verifyRequestIntegrity,
  type IntegrityDeps,
} from './integrity';
import { LlmError, type LlmUsage } from './llm';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';
import type { QuotaStore } from './quota';
import type { Entitlement, LlmClient, StudioResponse } from './types';
import { LIMITS, parseStudioRequest } from './validate';

export interface HandlerConfig {
  freePerMonth: number;
  proPerMonth: number;
  lifetimeGrant: number;
  creditPackSize: number;
  ipPerDay: number;
  dailyBudgetUsd: number;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  /** Output cap per request (the hook tool uses less). */
  maxOutputTokens: number;
  /** Share of the daily budget free-tier requests may use, so free traffic can't lock out payers. */
  freeBudgetShare: number;
}

export interface Deps {
  store: QuotaStore;
  llm: LlmClient;
  entitlement: (userId: string) => Promise<Entitlement>;
  now: () => number;
  config: HandlerConfig;
  log: (entry: Record<string, string | number>) => void;
  /** Device integrity (App Attest / Play Integrity). Omitted → mode "off". */
  integrity?: IntegrityDeps;
}

const INTEGRITY_OFF: IntegrityDeps = {
  config: {
    mode: 'off',
    appleAppId: null,
    allowDevelopmentKeys: false,
    androidPackage: null,
    androidCertDigests: [],
    ...INTEGRITY_DEFAULTS,
  },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const USER_ID_RE = /^[A-Za-z0-9$:_\-.]{8,128}$/;
const ENTITLEMENT_TTL_MS = 10 * 60 * 1000;
const MICRO = 1_000_000;
/** Three one- or two-sentence openings fit comfortably. */
const HOOK_MAX_TOKENS = 800;

function periodKeys(now: number) {
  const d = new Date(now);
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const day = `${month}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { month, day, monthResetsAt: new Date(next).toISOString() };
}

/** A cached entitlement older than this is re-checked once when quota runs out (the user may have just subscribed). */
const ENTITLEMENT_RECHECK_MS = 30 * 1000;

type CachedEntitlement = Entitlement & { fetchedAt?: number };

async function resolveEntitlement(deps: Deps, userId: string, opts: { bypassCache?: boolean } = {}): Promise<{ e: Entitlement; fetchedAt: number }> {
  const now = deps.now();
  if (!opts.bypassCache) {
    const cached = await deps.store.cacheGet<CachedEntitlement>(`user:${userId}`, 'entitlement', now);
    if (cached) {
      const { fetchedAt, ...e } = cached;
      return { e, fetchedAt: fetchedAt ?? 0 };
    }
  }
  const e = await deps.entitlement(userId);
  await deps.store.cachePut<CachedEntitlement>(`user:${userId}`, 'entitlement', { ...e, fetchedAt: now }, now + ENTITLEMENT_TTL_MS);
  return { e, fetchedAt: now };
}

/**
 * Base allowance per plan. Credit packs are a separate one-time pool used only
 * after the base allowance is exhausted — never re-granted monthly.
 */
function quotaFor(e: Entitlement, cfg: HandlerConfig, month: string) {
  const credits = { key: 'credits_total', limit: e.creditPacks * cfg.creditPackSize };
  if (e.plan === 'subscription') return { base: { key: `m:${month}`, limit: cfg.proPerMonth }, credits, resets: true };
  if (e.plan === 'lifetime') return { base: { key: 'lifetime_total', limit: cfg.lifetimeGrant }, credits, resets: false };
  return { base: { key: `m:${month}`, limit: cfg.freePerMonth }, credits, resets: true };
}

async function remainingFor(store: QuotaStore, scope: string, q: ReturnType<typeof quotaFor>): Promise<number> {
  const [baseUsed, creditsUsed] = await Promise.all([store.get(scope, q.base.key), store.get(scope, q.credits.key)]);
  return Math.max(0, q.base.limit - baseUsed) + Math.max(0, q.credits.limit - creditsUsed);
}

/** Reads at most `max` bytes: a chunked body without content-length cannot make us buffer more. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * Rate-limit key for a client address. IPv6 is keyed on its /64 (one subscriber's whole block);
 * a missing address shares one bucket.
 */
export function ipKey(ip: string | null): string {
  if (!ip) return 'ip:unknown';
  if (!ip.includes(':')) return `ip:${ip}`;
  const [head = ''] = ip.split('::');
  const groups = head.split(':').filter(Boolean);
  // "::" elides zero groups; anything shorter than four groups before it is padded with zeros.
  const prefix = ip.includes('::') && groups.length < 4 ? [...groups, ...Array(4 - groups.length).fill('0')] : ip.split(':').slice(0, 4);
  return `ip6:${prefix.map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

async function readJson(req: Request): Promise<{ raw: string; body: unknown } | { error: Response }> {
  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > LIMITS.maxBodyBytes) return { error: json(413, { error: 'too_large' }) };
  const raw = await readCapped(req, LIMITS.maxBodyBytes);
  if (raw === null) return { error: json(413, { error: 'too_large' }) };
  try {
    return { raw, body: JSON.parse(raw) };
  } catch {
    return { error: json(400, { error: 'invalid_json' }) };
  }
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const userId = req.headers.get('x-app-user-id') ?? '';
  if (!USER_ID_RE.test(userId)) return json(401, { error: 'unauthorized' });
  const { month, day, monthResetsAt } = periodKeys(deps.now());

  const ip = ipKey(req.headers.get('cf-connecting-ip'));

  if (req.method === 'GET' && url.pathname === '/v1/balance') {
    // Each unknown user id costs a RevenueCat lookup: bounded per address like the studio route.
    const ipBalance = await deps.store.consume(ip, `b:${day}`, deps.config.ipPerDay * 5);
    if (!ipBalance.allowed) return json(429, { error: 'rate_limited' });
    let e: Entitlement;
    try {
      ({ e } = await resolveEntitlement(deps, userId));
    } catch {
      return json(503, { error: 'entitlement_unavailable' });
    }
    const q = quotaFor(e, deps.config, month);
    const remaining = await remainingFor(deps.store, `user:${userId}`, q);
    return json(200, { remaining, resetsAt: q.resets ? monthResetsAt : null, plan: e.plan });
  }

  const integrity = deps.integrity ?? INTEGRITY_OFF;
  const ctx = { store: deps.store, now: deps.now, integrity };

  if (req.method === 'POST' && url.pathname.startsWith('/v1/integrity/')) {
    if (integrity.config.mode === 'off') return json(404, { error: 'integrity_disabled' });
    const ipIntegrity = await deps.store.consume(ip, `i:${day}`, deps.config.ipPerDay * 5);
    if (!ipIntegrity.allowed) return json(429, { error: 'rate_limited' });
    if (url.pathname === '/v1/integrity/challenge') {
      const c = await issueChallenge(ctx, userId, day);
      return c ? json(200, c) : json(429, { error: 'rate_limited' });
    }
    if (url.pathname === '/v1/integrity/attest') {
      const read = await readJson(req);
      if ('error' in read) return read.error;
      const b = read.body as { keyId?: unknown; attestation?: unknown; challenge?: unknown } | null;
      if (!b || typeof b.keyId !== 'string' || typeof b.attestation !== 'string' || typeof b.challenge !== 'string') {
        return json(400, { error: 'invalid_request' });
      }
      const r = await registerAppAttestKey(ctx, userId, { keyId: b.keyId, attestation: b.attestation, challenge: b.challenge });
      deps.log({ event: 'integrity_attest', platform: 'ios', status: r.ok ? 'verified' : 'failed', reason: r.ok ? '' : r.reason });
      return r.ok ? json(200, { ok: true }) : json(400, { error: 'attestation_failed' });
    }
    return json(404, { error: 'not_found' });
  }

  if (req.method !== 'POST' || url.pathname !== '/v1/studio') return json(404, { error: 'not_found' });

  const read = await readJson(req);
  if ('error' in read) return read.error;
  const { raw, body } = read;
  const parsed = parseStudioRequest(body);
  if ('error' in parsed) return json(400, { error: parsed.error });

  const ipCheck = await deps.store.consume(ip, `d:${day}`, deps.config.ipPerDay);
  if (!ipCheck.allowed) return json(429, { error: 'rate_limited' });

  let ent: Entitlement;
  let entFetchedAt: number;
  try {
    ({ e: ent, fetchedAt: entFetchedAt } = await resolveEntitlement(deps, userId));
  } catch {
    return json(503, { error: 'entitlement_unavailable' });
  }
  const scope = `user:${userId}`;

  if (integrity.config.mode !== 'off') {
    const outcome = await verifyRequestIntegrity(ctx, userId, req.headers, raw);
    const decision = decideIntegrity(integrity.config.mode, outcome, ent);
    deps.log({
      event: 'integrity',
      mode: integrity.config.mode,
      status: outcome.status,
      platform: outcome.status === 'missing' ? '' : outcome.platform,
      reason: outcome.status === 'failed' ? outcome.reason : '',
      plan: ent.plan,
      decision,
    });
    if (decision === 'block') return json(403, { error: 'integrity_required' });
    if (decision === 'limit') {
      const cap = await deps.store.consume(scope, `unverified:${day}`, integrity.config.unverifiedPaidPerDay);
      if (!cap.allowed) return json(429, { error: 'rate_limited' });
    }
  }

  const consumeFor = async (e: Entitlement) => {
    const q = quotaFor(e, deps.config, month);
    let key = q.base.key;
    let r = await deps.store.consume(scope, q.base.key, q.base.limit);
    if (!r.allowed && q.credits.limit > 0) {
      key = q.credits.key;
      r = await deps.store.consume(scope, q.credits.key, q.credits.limit);
    }
    return { q, chargedKey: key, allowed: r.allowed };
  };
  let charge = await consumeFor(ent);
  if (!charge.allowed && deps.now() - entFetchedAt > ENTITLEMENT_RECHECK_MS) {
    // A purchase made after the entitlement was cached would otherwise wait out the cache TTL.
    try {
      ({ e: ent } = await resolveEntitlement(deps, userId, { bypassCache: true }));
      charge = await consumeFor(ent);
    } catch {
      // RevenueCat unavailable: keep the cached answer.
    }
  }
  if (!charge.allowed) return json(402, { error: 'quota_exceeded', remaining: 0 });
  const { q, chargedKey } = charge;

  const { prompt, wantsAlternatives } = buildUserPrompt(parsed);
  const maxTokens = parsed.tool === 'hook' ? Math.min(HOOK_MAX_TOKENS, deps.config.maxOutputTokens) : deps.config.maxOutputTokens;
  const costMicro = (u: LlmUsage) => Math.ceil(u.inputTokens * deps.config.inputUsdPerMTok + u.outputTokens * deps.config.outputUsdPerMTok);
  // Worst case is reserved before the call (atomic, so concurrent requests can't overshoot the cap);
  // input tokens are bounded by characters. Settled to the billed usage afterwards.
  const reserved = costMicro({ inputTokens: SYSTEM_PROMPT.length + prompt.length, outputTokens: maxTokens });
  const budgetKeys = [{ key: `spend:${day}`, limit: deps.config.dailyBudgetUsd * MICRO }];
  if (ent.plan === 'free') budgetKeys.unshift({ key: `spend_free:${day}`, limit: deps.config.dailyBudgetUsd * deps.config.freeBudgetShare * MICRO });
  const held: string[] = [];
  for (const b of budgetKeys) {
    if (!(await deps.store.reserve('global', b.key, reserved, b.limit))) {
      for (const k of held) await deps.store.add('global', k, -reserved);
      await deps.store.refund(scope, chargedKey);
      deps.log({ event: 'budget_exhausted', day, plan: ent.plan });
      return json(503, { error: 'temporarily_unavailable' });
    }
    held.push(b.key);
  }
  /** Moves the reservation to the billed amount (worst case stays when the bill is unknown). */
  const settle = async (billedMicro: number) => {
    for (const k of held) await deps.store.add('global', k, billedMicro - reserved);
  };

  const started = deps.now();
  try {
    const out = await deps.llm.complete(SYSTEM_PROMPT, prompt, wantsAlternatives, maxTokens, req.signal);
    await settle(costMicro(out));
    deps.log({ event: 'studio_ok', tool: parsed.tool, plan: ent.plan, in: out.inputTokens, out: out.outputTokens, ms: deps.now() - started });
    const response: StudioResponse = {
      text: out.text,
      alternatives: wantsAlternatives ? out.alternatives : undefined,
      remaining: await remainingFor(deps.store, scope, q),
    };
    return json(200, response);
  } catch (e) {
    const kind = e instanceof LlmError ? e.kind : 'upstream';
    // Whatever the provider billed counts toward the daily budget. Rejected before generation
    // (429/overloaded): nothing billed. Otherwise unknown (timeout, disconnect): the worst case stays.
    if (e instanceof LlmError && e.usage) await settle(costMicro(e.usage));
    else if (kind === 'rate_limited' || kind === 'overloaded') await settle(0);
    // A refused or unusable answer consumed a completion, so it keeps its charge (otherwise it could
    // be retried for free); so does a request the client abandoned. Provider failures are refunded.
    if (kind !== 'refused' && kind !== 'bad_output' && kind !== 'aborted') await deps.store.refund(scope, chargedKey);
    deps.log({ event: 'studio_error', tool: parsed.tool, plan: ent.plan, kind, ms: deps.now() - started });
    if (kind === 'rate_limited') return json(429, { error: 'rate_limited' });
    if (kind === 'refused') return json(422, { error: 'refused' });
    return json(502, { error: 'upstream_error' });
  }
}
