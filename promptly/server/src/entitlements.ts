/**
 * Server-side entitlement lookup via the RevenueCat REST API (secret key,
 * server only). The app's anonymous RevenueCat ID is the user identity.
 *
 * NOTE: RevenueCat creates a subscriber record for unknown IDs, so an ID alone
 * does not prove a real install. Free-tier abuse is bounded by per-IP limits
 * and the global daily budget; device attestation (App Attest / Play
 * Integrity) is required before enabling free AI in production
 * (docs/architecture/ai-proxy.md).
 */
import type { Entitlement } from './types';

export const ENTITLEMENT_ID = 'pro';
export const LIFETIME_PRODUCT = 'promptly_lifetime';
export const CREDIT_PACK_PRODUCT = 'promptly_ai_credits_100';

interface RcSubscriberResponse {
  subscriber?: {
    entitlements?: Record<string, { expires_date: string | null; product_identifier: string } | undefined>;
    non_subscriptions?: Record<string, Array<{ id: string; refunded_at?: string | null }> | undefined>;
  };
}

/** Pure mapping, unit-tested. */
export function entitlementFromRevenueCat(body: RcSubscriberResponse, now: number): Entitlement {
  const sub = body.subscriber ?? {};
  const nonSubs = sub.non_subscriptions ?? {};
  const owned = (pid: string) => (nonSubs[pid] ?? []).filter((t) => !t.refunded_at).length;
  const creditPacks = owned(CREDIT_PACK_PRODUCT);
  if (owned(LIFETIME_PRODUCT) > 0) return { plan: 'lifetime', creditPacks };
  const pro = sub.entitlements?.[ENTITLEMENT_ID];
  if (pro) {
    // No expiry (lifetime product, or a promotional/manual grant): the one-time lifetime allowance,
    // never a monthly allowance that would renew forever.
    if (pro.product_identifier === LIFETIME_PRODUCT || pro.expires_date === null) return { plan: 'lifetime', creditPacks };
    if (Date.parse(pro.expires_date) > now) return { plan: 'subscription', creditPacks };
  }
  return { plan: 'free', creditPacks };
}

export async function fetchEntitlement(appUserId: string, secretKey: string, now: number): Promise<Entitlement> {
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { authorization: `Bearer ${secretKey}`, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`revenuecat ${res.status}`);
  return entitlementFromRevenueCat((await res.json()) as RcSubscriberResponse, now);
}
