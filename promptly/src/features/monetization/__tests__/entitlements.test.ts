import {
  CustomerInfoLike,
  FREE_ACCESS,
  LIMITS,
  PRODUCT_IDS,
  checkFeature,
  deriveAccess,
  monthlyAiAllowance,
  paywallPlan,
} from '../entitlements';

function info(partial: Partial<CustomerInfoLike> & { pro?: Partial<NonNullable<CustomerInfoLike['entitlements']['active']['pro']>> }): CustomerInfoLike {
  return {
    entitlements: {
      active: partial.pro
        ? {
            pro: {
              isActive: true,
              productIdentifier: PRODUCT_IDS.monthly,
              expirationDate: '2026-11-20T00:00:00Z',
              willRenew: true,
              billingIssueDetectedAt: null,
              ...partial.pro,
            },
          }
        : {},
    },
    nonSubscriptionProductIds: partial.nonSubscriptionProductIds ?? [],
  };
}

describe('deriveAccess', () => {
  it('is free without customer info or entitlements', () => {
    expect(deriveAccess(null)).toEqual(FREE_ACCESS);
    expect(deriveAccess(info({}))).toEqual(FREE_ACCESS);
  });

  it('grants subscription access', () => {
    const a = deriveAccess(info({ pro: {} }));
    expect(a).toMatchObject({ isPro: true, source: 'subscription', willRenew: true });
  });

  it('reports cancelled-but-active and billing issues', () => {
    const a = deriveAccess(info({ pro: { willRenew: false, billingIssueDetectedAt: '2026-10-01T00:00:00Z' } }));
    expect(a).toMatchObject({ isPro: true, willRenew: false, billingIssue: true });
  });

  it('expired/refunded entitlement (not in active) is free', () => {
    expect(deriveAccess(info({ pro: { isActive: false } })).isPro).toBe(false);
  });

  it('lifetime wins over an active subscription', () => {
    const a = deriveAccess(info({ pro: {}, nonSubscriptionProductIds: [PRODUCT_IDS.lifetime] }));
    expect(a).toMatchObject({ isPro: true, source: 'lifetime', expiresAt: null });
  });

  it('a refunded lifetime purchase still in the history does not grant Pro', () => {
    expect(deriveAccess(info({ nonSubscriptionProductIds: [PRODUCT_IDS.lifetime] })).isPro).toBe(false);
  });

  it('credit packs alone do not grant Pro', () => {
    expect(deriveAccess(info({ nonSubscriptionProductIds: [PRODUCT_IDS.credits100] })).isPro).toBe(false);
  });
});

describe('checkFeature', () => {
  const free = FREE_ACCESS;
  const pro = deriveAccess(info({ pro: {} }));

  it('free users keep core value', () => {
    for (const f of ['captions', 'burnInCaptions', 'srtExport', 'aiScript'] as const) {
      expect(checkFeature(f, free, { voiceFollowSessionsUsed: 0 }).allowed).toBe(true);
    }
  });

  it('voice follow trial counts down then requires Pro', () => {
    expect(checkFeature('voiceFollow', free, { voiceFollowSessionsUsed: 0 })).toEqual({
      allowed: true,
      reason: 'trial',
      remaining: LIMITS.freeVoiceFollowSessions,
    });
    expect(checkFeature('voiceFollow', free, { voiceFollowSessionsUsed: LIMITS.freeVoiceFollowSessions })).toEqual({
      allowed: false,
      reason: 'trial_exhausted',
    });
  });

  it('premium features require Pro', () => {
    expect(checkFeature('captionStylePremium', free, { voiceFollowSessionsUsed: 0 })).toEqual({
      allowed: false,
      reason: 'pro_required',
    });
    expect(checkFeature('captionStylePremium', pro, { voiceFollowSessionsUsed: 99 }).allowed).toBe(true);
  });
});

describe('paywallPlan', () => {
  it('prevents overlapping purchases', () => {
    expect(paywallPlan(FREE_ACCESS)).toMatchObject({ showSubscriptions: true, showLifetime: true });
    const sub = deriveAccess(info({ pro: {} }));
    expect(paywallPlan(sub)).toMatchObject({ showSubscriptions: false, showLifetime: true });
    const life = deriveAccess(info({ pro: { productIdentifier: PRODUCT_IDS.lifetime, expirationDate: null }, nonSubscriptionProductIds: [PRODUCT_IDS.lifetime] }));
    expect(paywallPlan(life)).toMatchObject({ showSubscriptions: false, showLifetime: false });
  });

  it('AI allowance per plan', () => {
    expect(monthlyAiAllowance(FREE_ACCESS)).toBe(LIMITS.freeAiRequestsPerMonth);
    expect(monthlyAiAllowance(deriveAccess(info({ pro: {} })))).toBe(LIMITS.proAiRequestsPerMonth);
  });
});
