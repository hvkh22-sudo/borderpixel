# Pricing model

> Everything here is a **proposal**. Final prices, allowances and product activation require founder approval.
> Research basis: `docs/research/pricing-research.md`.

## Offer structure

| | Free | Pro Monthly | Pro Annual | Lifetime |
|---|---|---|---|---|
| Price (USD, proposed) | $0 | $6.99 | $34.99 | $59.99 (launch) |
| Scripts, editor, library | Unlimited | Unlimited | Unlimited | Unlimited |
| Manual + timed prompter, display settings | ✓ | ✓ | ✓ | ✓ |
| 1080p recording, export, **no watermark** | ✓ | ✓ | ✓ | ✓ |
| On-device captions, Clean style, SRT, burn-in | ✓ | ✓ | ✓ | ✓ |
| Voice Follow | 3 free takes | ✓ | ✓ | ✓ (on-device, permanent) |
| Premium caption styles (Creator Bold, High Contrast) | — | ✓ | ✓ | ✓ |
| AI Script Studio | 5 / month | 150 / month* | 150 / month* | 300 one-time credits + optional packs |
| Future on-device Pro features | — | ✓ | ✓ | ✓ |
| Future cloud-dependent features | — | Included per plan terms | Included per plan terms | **Not included** unless stated at purchase |

\* See `ai-unit-economics.md` §3: allowance depends on the model decision.

Implementation: `src/features/monetization/entitlements.ts` (client gates) and `server/src/handler.ts`
(server-enforced AI quota). Product IDs: `promptly_pro_monthly`, `promptly_pro_annual`,
`promptly_lifetime` (non-consumable), `promptly_ai_credits_100` (consumable credit pack). One RevenueCat
entitlement: `pro`.

## Why this shape
- The free tier delivers the full core loop (write → record → caption → export) without a watermark —
  the most common complaint category in competitor reviews is unfair paywalls/watermarks.
- Pro value is the hardest-to-build capability (Voice Follow) plus premium styling and AI.
- Annual is the anchor (parity with the category leader at $34.99). Monthly is the flexible option.
- Lifetime is a differentiator vs. major competitors, bounded to on-device features + a fixed AI grant.
- No weekly plan; trials (if any) must show the charge date clearly.

## Lifetime purchase terms (draft wording for the paywall/store listing)
"Lifetime unlocks all current and future **on-device** Pro features of Promptly, permanently, plus 300 AI
Script Studio credits. Additional AI credits are available as optional purchases. Cloud-based features
that are introduced later may require a subscription." — needs legal review before use.

## Open questions for the founder
1. Approve $6.99 / $34.99 / $59.99 or test $7.99 monthly / $79.99 lifetime (research suggests lifetime is
   only 1.7× annual).
2. Free trial for annual (e.g. 7 days) — yes/no.
3. AI model decision (affects the Pro allowance).
