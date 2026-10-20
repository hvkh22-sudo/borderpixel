/**
 * Atomic usage counters. Production: one Durable Object per counter scope
 * (strongly consistent, single-threaded). Tests: in-memory implementation.
 */
export interface QuotaStore {
  /** Atomically increments `key` if the result stays <= limit. */
  consume(scope: string, key: string, limit: number): Promise<{ allowed: boolean; used: number }>;
  /** Undo one consume (upstream failure: the user is not charged). */
  refund(scope: string, key: string): Promise<void>;
  get(scope: string, key: string): Promise<number>;
  /** Adds to a floating-point counter (spend in micro-dollars stored as integer). */
  add(scope: string, key: string, amount: number): Promise<number>;
  /** Small JSON cache with TTL (entitlements). */
  cacheGet<T>(scope: string, key: string, now: number): Promise<T | null>;
  cachePut<T>(scope: string, key: string, value: T, expiresAt: number): Promise<void>;
  /** Atomically reads and deletes a cache entry (single-use integrity challenges). */
  cacheTake<T>(scope: string, key: string, now: number): Promise<T | null>;
  /** Atomically sets counter `key` to `value` iff value > current; returns whether it advanced. */
  advance(scope: string, key: string, value: number): Promise<boolean>;
}

export class MemoryQuotaStore implements QuotaStore {
  private counters = new Map<string, number>();
  private cache = new Map<string, { value: unknown; expiresAt: number }>();
  private k = (s: string, k: string) => `${s}|${k}`;

  async consume(scope: string, key: string, limit: number) {
    const id = this.k(scope, key);
    const used = this.counters.get(id) ?? 0;
    if (used + 1 > limit) return { allowed: false, used };
    this.counters.set(id, used + 1);
    return { allowed: true, used: used + 1 };
  }
  async refund(scope: string, key: string) {
    const id = this.k(scope, key);
    this.counters.set(id, Math.max(0, (this.counters.get(id) ?? 0) - 1));
  }
  async get(scope: string, key: string) {
    return this.counters.get(this.k(scope, key)) ?? 0;
  }
  async add(scope: string, key: string, amount: number) {
    const id = this.k(scope, key);
    const v = (this.counters.get(id) ?? 0) + amount;
    this.counters.set(id, v);
    return v;
  }
  async cacheGet<T>(scope: string, key: string, now: number) {
    const e = this.cache.get(this.k(scope, key));
    return e && e.expiresAt > now ? (e.value as T) : null;
  }
  async cachePut<T>(scope: string, key: string, value: T, expiresAt: number) {
    this.cache.set(this.k(scope, key), { value, expiresAt });
  }
  async cacheTake<T>(scope: string, key: string, now: number) {
    const id = this.k(scope, key);
    const e = this.cache.get(id);
    this.cache.delete(id);
    return e && e.expiresAt > now ? (e.value as T) : null;
  }
  async advance(scope: string, key: string, value: number) {
    const id = this.k(scope, key);
    if (value <= (this.counters.get(id) ?? 0)) return false;
    this.counters.set(id, value);
    return true;
  }
}
