/**
 * Request handling, independent of the Workers runtime (fully unit-tested).
 * Order: validate → IP limit → global budget → entitlement → quota → LLM →
 * account spend. Script text is never logged.
 */
import { LlmError } from './llm';
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
}

export interface Deps {
  store: QuotaStore;
  llm: LlmClient;
  entitlement: (userId: string) => Promise<Entitlement>;
  now: () => number;
  config: HandlerConfig;
  log: (entry: Record<string, string | number>) => void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const USER_ID_RE = /^[A-Za-z0-9$:_\-.]{8,128}$/;
const ENTITLEMENT_TTL_MS = 10 * 60 * 1000;
const MICRO = 1_000_000;

function periodKeys(now: number) {
  const d = new Date(now);
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const day = `${month}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { month, day, monthResetsAt: new Date(next).toISOString() };
}

async function resolveEntitlement(deps: Deps, userId: string): Promise<Entitlement> {
  const now = deps.now();
  const cached = await deps.store.cacheGet<Entitlement>(`user:${userId}`, 'entitlement', now);
  if (cached) return cached;
  const e = await deps.entitlement(userId);
  await deps.store.cachePut(`user:${userId}`, 'entitlement', e, now + ENTITLEMENT_TTL_MS);
  return e;
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

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const userId = req.headers.get('x-app-user-id') ?? '';
  if (!USER_ID_RE.test(userId)) return json(401, { error: 'unauthorized' });
  const { month, day, monthResetsAt } = periodKeys(deps.now());

  if (req.method === 'GET' && url.pathname === '/v1/balance') {
    const e = await resolveEntitlement(deps, userId);
    const q = quotaFor(e, deps.config, month);
    const remaining = await remainingFor(deps.store, `user:${userId}`, q);
    return json(200, { remaining, resetsAt: q.resets ? monthResetsAt : null, plan: e.plan });
  }

  if (req.method !== 'POST' || url.pathname !== '/v1/studio') return json(404, { error: 'not_found' });

  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > LIMITS.maxBodyBytes) return json(413, { error: 'too_large' });
  const raw = await req.text();
  if (raw.length > LIMITS.maxBodyBytes) return json(413, { error: 'too_large' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  const parsed = parseStudioRequest(body);
  if ('error' in parsed) return json(400, { error: parsed.error });

  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const ipCheck = await deps.store.consume(`ip:${ip}`, `d:${day}`, deps.config.ipPerDay);
  if (!ipCheck.allowed) return json(429, { error: 'rate_limited' });

  const spentMicro = await deps.store.get('global', `spend:${day}`);
  if (spentMicro >= deps.config.dailyBudgetUsd * MICRO) {
    deps.log({ event: 'budget_exhausted', day });
    return json(503, { error: 'temporarily_unavailable' });
  }

  let ent: Entitlement;
  try {
    ent = await resolveEntitlement(deps, userId);
  } catch {
    return json(503, { error: 'entitlement_unavailable' });
  }
  const q = quotaFor(ent, deps.config, month);
  const scope = `user:${userId}`;
  let chargedKey = q.base.key;
  let quota = await deps.store.consume(scope, q.base.key, q.base.limit);
  if (!quota.allowed && q.credits.limit > 0) {
    chargedKey = q.credits.key;
    quota = await deps.store.consume(scope, q.credits.key, q.credits.limit);
  }
  if (!quota.allowed) return json(402, { error: 'quota_exceeded', remaining: 0 });

  const started = deps.now();
  const { prompt, wantsAlternatives } = buildUserPrompt(parsed);
  try {
    const out = await deps.llm.complete(SYSTEM_PROMPT, prompt, wantsAlternatives, req.signal);
    const costMicro = Math.ceil(
      (out.inputTokens * deps.config.inputUsdPerMTok + out.outputTokens * deps.config.outputUsdPerMTok),
    );
    await deps.store.add('global', `spend:${day}`, costMicro);
    deps.log({ event: 'studio_ok', tool: parsed.tool, plan: ent.plan, in: out.inputTokens, out: out.outputTokens, ms: deps.now() - started });
    const response: StudioResponse = {
      text: out.text,
      alternatives: wantsAlternatives ? out.alternatives : undefined,
      remaining: await remainingFor(deps.store, scope, q),
    };
    return json(200, response);
  } catch (e) {
    await deps.store.refund(scope, chargedKey);
    const kind = e instanceof LlmError ? e.kind : 'upstream';
    deps.log({ event: 'studio_error', tool: parsed.tool, plan: ent.plan, kind, ms: deps.now() - started });
    if (kind === 'rate_limited') return json(429, { error: 'rate_limited' });
    if (kind === 'refused') return json(422, { error: 'refused' });
    return json(502, { error: 'upstream_error' });
  }
}
