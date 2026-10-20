/**
 * Cloudflare Worker entry. Secrets (ANTHROPIC_API_KEY, REVENUECAT_SECRET_KEY)
 * are set with `wrangler secret put` and never leave the server.
 */
import { DurableObject } from 'cloudflare:workers';

import { fetchEntitlement } from './entitlements';
import { handle, type HandlerConfig } from './handler';
import { INTEGRITY_DEFAULTS, parseIntegrityMode, type IntegrityDeps } from './integrity';
import { AnthropicLlm } from './llm';
import { decodeIntegrityToken, parseServiceAccount } from './playIntegrity';
import type { QuotaStore } from './quota';

export interface Env {
  ANTHROPIC_API_KEY: string;
  REVENUECAT_SECRET_KEY: string;
  MODEL: string;
  MAX_OUTPUT_TOKENS: string;
  FREE_PER_MONTH: string;
  PRO_PER_MONTH: string;
  LIFETIME_GRANT: string;
  CREDIT_PACK_SIZE: string;
  IP_PER_DAY: string;
  DAILY_BUDGET_USD: string;
  INPUT_USD_PER_MTOK: string;
  OUTPUT_USD_PER_MTOK: string;
  /** Kill switch: anything but "true" disables AI (no billable calls). */
  AI_ENABLED: string;
  /** Device integrity enforcement: off | report (default) | enforce. */
  INTEGRITY_MODE?: string;
  APPLE_TEAM_ID?: string;
  IOS_BUNDLE_ID?: string;
  /** "true" accepts App Attest development-environment keys (dev builds). */
  APP_ATTEST_ALLOW_DEVELOPMENT?: string;
  ANDROID_PACKAGE?: string;
  /** Comma-separated base64url SHA-256 digests of the Play app-signing certificate. */
  ANDROID_CERT_SHA256?: string;
  /** Secret: Google service-account JSON with access to the Play Integrity API. */
  PLAY_INTEGRITY_SA_JSON?: string;
  UNVERIFIED_PAID_PER_DAY?: string;
  COUNTERS: DurableObjectNamespace<Counters>;
}

/** One instance per scope (user, IP, global); storage ops are serialized. */
export class Counters extends DurableObject {
  async consume(key: string, limit: number): Promise<{ allowed: boolean; used: number }> {
    const used = ((await this.ctx.storage.get<number>(key)) ?? 0) + 1;
    if (used > limit) return { allowed: false, used: used - 1 };
    await this.ctx.storage.put(key, used);
    return { allowed: true, used };
  }
  async refund(key: string): Promise<void> {
    const used = (await this.ctx.storage.get<number>(key)) ?? 0;
    await this.ctx.storage.put(key, Math.max(0, used - 1));
  }
  async read(key: string): Promise<number> {
    return (await this.ctx.storage.get<number>(key)) ?? 0;
  }
  async add(key: string, amount: number): Promise<number> {
    const v = ((await this.ctx.storage.get<number>(key)) ?? 0) + amount;
    await this.ctx.storage.put(key, v);
    return v;
  }
  async cacheGet(key: string, now: number): Promise<unknown> {
    const e = await this.ctx.storage.get<{ value: unknown; expiresAt: number }>(`cache:${key}`);
    return e && e.expiresAt > now ? e.value : null;
  }
  async cachePut(key: string, value: unknown, expiresAt: number): Promise<void> {
    await this.ctx.storage.put(`cache:${key}`, { value, expiresAt });
  }
  async cacheTake(key: string, now: number): Promise<unknown> {
    const e = await this.ctx.storage.get<{ value: unknown; expiresAt: number }>(`cache:${key}`);
    if (e) await this.ctx.storage.delete(`cache:${key}`);
    return e && e.expiresAt > now ? e.value : null;
  }
  async advance(key: string, value: number): Promise<boolean> {
    if (value <= ((await this.ctx.storage.get<number>(key)) ?? 0)) return false;
    await this.ctx.storage.put(key, value);
    return true;
  }
}

class DurableQuotaStore implements QuotaStore {
  constructor(private readonly ns: DurableObjectNamespace<Counters>) {}
  private stub(scope: string) {
    return this.ns.get(this.ns.idFromName(scope));
  }
  consume(scope: string, key: string, limit: number) {
    return this.stub(scope).consume(key, limit);
  }
  refund(scope: string, key: string) {
    return this.stub(scope).refund(key);
  }
  get(scope: string, key: string) {
    return this.stub(scope).read(key);
  }
  add(scope: string, key: string, amount: number) {
    return this.stub(scope).add(key, amount);
  }
  async cacheGet<T>(scope: string, key: string, now: number) {
    return (await this.stub(scope).cacheGet(key, now)) as T | null;
  }
  cachePut<T>(scope: string, key: string, value: T, expiresAt: number) {
    return this.stub(scope).cachePut(key, value, expiresAt);
  }
  async cacheTake<T>(scope: string, key: string, now: number) {
    return (await this.stub(scope).cacheTake(key, now)) as T | null;
  }
  advance(scope: string, key: string, value: number) {
    return this.stub(scope).advance(key, value);
  }
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

function integrityDeps(env: Env): IntegrityDeps {
  const sa = env.PLAY_INTEGRITY_SA_JSON ? parseServiceAccount(env.PLAY_INTEGRITY_SA_JSON) : null;
  return {
    config: {
      mode: parseIntegrityMode(env.INTEGRITY_MODE),
      appleAppId: env.APPLE_TEAM_ID && env.IOS_BUNDLE_ID ? `${env.APPLE_TEAM_ID}.${env.IOS_BUNDLE_ID}` : null,
      allowDevelopmentKeys: env.APP_ATTEST_ALLOW_DEVELOPMENT === 'true',
      androidPackage: env.ANDROID_PACKAGE || null,
      androidCertDigests: (env.ANDROID_CERT_SHA256 ?? '').split(',').map((d) => d.trim()).filter(Boolean),
      ...INTEGRITY_DEFAULTS,
      unverifiedPaidPerDay: num(env.UNVERIFIED_PAID_PER_DAY, INTEGRITY_DEFAULTS.unverifiedPaidPerDay),
    },
    decodePlayToken: sa ? (token, pkg) => decodeIntegrityToken(token, pkg, sa, Date.now()) : undefined,
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (env.AI_ENABLED !== 'true') {
      return new Response(JSON.stringify({ error: 'temporarily_unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    const config: HandlerConfig = {
      freePerMonth: num(env.FREE_PER_MONTH, 5),
      proPerMonth: num(env.PRO_PER_MONTH, 150),
      lifetimeGrant: num(env.LIFETIME_GRANT, 300),
      creditPackSize: num(env.CREDIT_PACK_SIZE, 100),
      ipPerDay: num(env.IP_PER_DAY, 40),
      dailyBudgetUsd: num(env.DAILY_BUDGET_USD, 5),
      inputUsdPerMTok: num(env.INPUT_USD_PER_MTOK, 4),
      outputUsdPerMTok: num(env.OUTPUT_USD_PER_MTOK, 20),
    };
    return handle(req, {
      store: new DurableQuotaStore(env.COUNTERS),
      llm: new AnthropicLlm(env.ANTHROPIC_API_KEY, env.MODEL, num(env.MAX_OUTPUT_TOKENS, 4000)),
      entitlement: (id) => fetchEntitlement(id, env.REVENUECAT_SECRET_KEY, Date.now()),
      now: Date.now,
      config,
      log: (entry) => console.log(JSON.stringify(entry)),
      integrity: integrityDeps(env),
    });
  },
};
