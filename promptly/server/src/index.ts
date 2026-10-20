/**
 * Cloudflare Worker entry. Secrets (ANTHROPIC_API_KEY, REVENUECAT_SECRET_KEY)
 * are set with `wrangler secret put` and never leave the server.
 */
import { DurableObject } from 'cloudflare:workers';

import { fetchEntitlement } from './entitlements';
import { handle, type HandlerConfig } from './handler';
import { AnthropicLlm } from './llm';
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
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

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
    });
  },
};
