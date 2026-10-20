# Operating cost model

Prices from `ai-cost-inputs.md` (sources and dates there). Variable AI cost from `ai-unit-economics.md`.

## Fixed costs
| Item | Cost | Notes |
|---|---|---|
| Apple Developer Program | $99 / year | required for TestFlight + App Store |
| Google Play developer account | $25 one-time | |
| Cloudflare Workers Paid | $5 / month | includes Durable Objects quota; required for DOs |
| EAS Build | $0 (free tier) to paid plan | free tier has queue limits; paid plan optional (VERIFY current EAS pricing) |
| RevenueCat | $0 until $2.5k MTR, then 1% | |
| Domain + email + privacy-policy hosting | ~$2–5 / month | existing site in this repo can host policy pages |

## Variable cost by monthly active users (MAU)
Assumptions: 5% of MAU pay; payers make 15 AI requests/month, free users 2; captions and Voice Follow
are on-device ($0).

| MAU | AI requests / month | Opus 5.5 ($0.0176) | Haiku 5.5 ($0.00044) | Workers/DO overage |
|---|---|---|---|---|
| 100 | 265 | $4.66 | $0.12 | $0 (within $5 plan) |
| 1,000 | 2,650 | $46.64 | $1.17 | $0 |
| 10,000 | 26,500 | $466 | $11.66 | ~$0–2 |
| 100,000 | 265,000 | $4,664 | $116.60 | ~$10–20 |

At 100k MAU and 5% paying (5,000 payers, ~$12k+ net/month blended) AI is ~39% of net revenue on Opus
vs ~1% on Haiku — the model decision is the single biggest cost lever.

## Controls in place (code)
- Server kill switch `AI_ENABLED` (default `false`) and hard `DAILY_BUDGET_USD` (default $5).
- Per-user monthly quotas, per-IP daily limit, request-size and token caps.
- No cloud transcription, no video uploads.
