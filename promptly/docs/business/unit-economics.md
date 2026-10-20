# Unit economics and scenarios

All figures are **projections built from stated assumptions**, not results. Fees: 15% store (Apple Small
Business Program; Google Play with Play Billing), 1% RevenueCat above $2.5k MTR (`ai-cost-inputs.md`).

## Net revenue per paying user
| Plan | Gross | Net after fees | Per month equivalent |
|---|---|---|---|
| Monthly $6.99 | $6.99/mo | $5.87 | $5.87 |
| Annual $34.99 | $34.99/yr | $29.39 | $2.45 |
| Lifetime $59.99 | once | $50.39 | — |

## Scenario assumptions (per month, steady state)
| Assumption | Conservative | Base | Optimistic |
|---|---|---|---|
| New installs / month | 2,000 | 10,000 | 40,000 |
| Install → paid conversion | 1.5% | 3% | 5% |
| Paid mix monthly / annual / lifetime | 40 / 45 / 15 % | 35 / 50 / 15 % | 30 / 55 / 15 % |
| Monthly churn (monthly plan) | 15% | 10% | 8% |
| Refund rate | 5% | 3% | 2% |
| AI requests per paying user / month | 25 | 15 | 15 |
| AI requests per free MAU / month | 3 | 2 | 2 |
| AI cost per request | $0.0176 (Opus 5.5) | $0.0176 | $0.00044 (Haiku 5.5) |

## Derived, month 12 (approximate)
| | Conservative | Base | Optimistic |
|---|---|---|---|
| New paying users / month | 30 | 300 | 2,000 |
| Gross new revenue / month (first payments) | ~$830 | ~$8,700 | ~$60,700 |
| Active payers (cumulative, after churn; ASSUMPTION) | ~150 | ~1,500 | ~10,000 |
| AI variable cost / month | ~$190 | ~$820 | ~$110 |
| Infrastructure (Workers + DOs) | $5 | $5–$10 | ~$20 |
| Support (founder time, not cash) | low | moderate | needs help |

Method: new payers = installs × conversion; revenue uses the plan mix and net prices above, annual and
lifetime counted at purchase (cash view). AI cost = (active payers × requests + free MAU × requests) × cost per
request, with free MAU ≈ 40% of trailing-3-month installs (ASSUMPTION).

## Break-even
Fixed costs before marketing are small (Apple $99/yr, Google $25 one-time, Workers $5/mo, domain/email).
Break-even on fixed costs needs only ~3–5 paying users per month. The real break-even question is
**paid acquisition**: with a base-case LTV of roughly $30–$40 per payer (ASSUMPTION: annual-heavy mix,
~1.3 renewals average), CAC per payer must stay below ~$30, i.e. **cost per install below ~$0.90 at 3%
conversion**. Measure organic conversion before spending on ads.

## Lifetime liability
Lifetime users only consume on-device features (no marginal cost) plus a fixed AI grant (≤ $5.28 on
Opus 5.5). There is no open-ended liability as long as no unlimited cloud feature is promised.
