/**
 * Entitlement model. Pure logic: derives access from a store-agnostic view of
 * RevenueCat CustomerInfo, and decides feature access. No entitlement is ever
 * hardcoded; the only input is what the purchase SDK reports.
 *
 * Product offer (PROVISIONAL — prices and allowances need founder approval):
 *  - Free: scripts, manual + timed prompter, 1080p recording, export without
 *    watermark, captions (Clean style + SRT), Voice Follow trial, small AI quota.
 *  - Pro (monthly/annual): everything, monthly AI allowance.
 *  - Lifetime: every on-device Pro feature permanently + one-time AI credit
 *    grant. Cloud AI beyond that uses optional credit packs. Never "unlimited".
 */

export const ENTITLEMENT_PRO = 'pro';

export const PRODUCT_IDS = {
  monthly: 'promptly_pro_monthly',
  annual: 'promptly_pro_annual',
  lifetime: 'promptly_lifetime',
  credits100: 'promptly_ai_credits_100',
} as const;

export type AccessSource = 'none' | 'subscription' | 'lifetime';

export interface AccessState {
  isPro: boolean;
  source: AccessSource;
  productId: string | null;
  /** ISO date; null for lifetime or free. */
  expiresAt: string | null;
  willRenew: boolean;
  /** True when the store reports a billing problem but access continues. */
  billingIssue: boolean;
}

export const FREE_ACCESS: AccessState = {
  isPro: false,
  source: 'none',
  productId: null,
  expiresAt: null,
  willRenew: false,
  billingIssue: false,
};

/** Minimal subset of RevenueCat's EntitlementInfo we depend on. */
export interface EntitlementInfoLike {
  isActive: boolean;
  productIdentifier: string;
  expirationDate: string | null;
  willRenew: boolean;
  billingIssueDetectedAt: string | null;
}

export interface CustomerInfoLike {
  entitlements: { active: Record<string, EntitlementInfoLike | undefined> };
  /** Product IDs of non-subscription purchases (lifetime, credit packs). */
  nonSubscriptionProductIds: string[];
}

export function deriveAccess(info: CustomerInfoLike | null): AccessState {
  if (!info) return FREE_ACCESS;
  const ownsLifetime = info.nonSubscriptionProductIds.includes(PRODUCT_IDS.lifetime);
  const pro = info.entitlements.active[ENTITLEMENT_PRO];
  // Lifetime wins over a concurrently active subscription: it never expires.
  if (ownsLifetime || (pro?.isActive && pro.productIdentifier === PRODUCT_IDS.lifetime)) {
    return {
      isPro: true,
      source: 'lifetime',
      productId: PRODUCT_IDS.lifetime,
      expiresAt: null,
      willRenew: false,
      billingIssue: false,
    };
  }
  if (pro?.isActive) {
    return {
      isPro: true,
      source: 'subscription',
      productId: pro.productIdentifier,
      expiresAt: pro.expirationDate,
      willRenew: pro.willRenew,
      billingIssue: pro.billingIssueDetectedAt != null,
    };
  }
  return FREE_ACCESS;
}

export type Feature =
  | 'voiceFollow'
  | 'captions'
  | 'captionStylePremium'
  | 'captionWordHighlight'
  | 'burnInCaptions'
  | 'srtExport'
  | 'advancedDisplay'
  | 'recording4k'
  | 'scriptFolders'
  | 'aiScript';

/** PROVISIONAL limits — see docs/business/pricing-model.md. */
export const LIMITS = {
  freeVoiceFollowSessions: 3,
  freeAiRequestsPerMonth: 5,
  proAiRequestsPerMonth: 150,
  lifetimeAiCreditGrant: 300,
  creditPackSize: 100,
} as const;

export interface UsageState {
  voiceFollowSessionsUsed: number;
}

export type GateResult =
  | { allowed: true; reason?: 'trial'; remaining?: number }
  | { allowed: false; reason: 'pro_required' | 'trial_exhausted' };

const FREE_FEATURES: ReadonlySet<Feature> = new Set<Feature>(['captions', 'burnInCaptions', 'srtExport', 'aiScript']);

export function checkFeature(feature: Feature, access: AccessState, usage: UsageState): GateResult {
  if (access.isPro) return { allowed: true };
  if (FREE_FEATURES.has(feature)) return { allowed: true };
  if (feature === 'voiceFollow') {
    const remaining = LIMITS.freeVoiceFollowSessions - usage.voiceFollowSessionsUsed;
    return remaining > 0
      ? { allowed: true, reason: 'trial', remaining }
      : { allowed: false, reason: 'trial_exhausted' };
  }
  return { allowed: false, reason: 'pro_required' };
}

/** What the paywall should offer, avoiding overlapping purchases. */
export interface PaywallPlan {
  showSubscriptions: boolean;
  showLifetime: boolean;
  /** Message key explaining why options are hidden or what to do next. */
  noticeKey: string | null;
}

export function paywallPlan(access: AccessState): PaywallPlan {
  if (access.source === 'lifetime') {
    return { showSubscriptions: false, showLifetime: false, noticeKey: 'paywall.notice.ownsLifetime' };
  }
  if (access.source === 'subscription') {
    // Upgrading to lifetime is allowed, but the store will not cancel the
    // subscription automatically — tell the user before they buy.
    return { showSubscriptions: false, showLifetime: true, noticeKey: 'paywall.notice.cancelSubAfterLifetime' };
  }
  return { showSubscriptions: true, showLifetime: true, noticeKey: null };
}

/** Monthly AI allowance for the client UI; the server is the source of truth. */
export function monthlyAiAllowance(access: AccessState): number {
  if (access.source === 'subscription') return LIMITS.proAiRequestsPerMonth;
  if (access.source === 'lifetime') return 0; // lifetime uses its one-time credit grant + packs
  return LIMITS.freeAiRequestsPerMonth;
}
