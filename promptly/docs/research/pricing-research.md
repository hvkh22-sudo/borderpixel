# Pricing Research: Promptly

Research date: 2026-10-20. US prices unless noted. Labels as in competitor-matrix.md. The store pages themselves could not be loaded directly; prices come from indexed listing text or third-party trackers and can lag the live price or differ by region.

> **All pricing in this document is a recommendation only and requires founder approval before it is implemented in App Store Connect, Google Play Console or any paywall code.**

## 1. Competitor price table

| App | Weekly | Monthly | Annual | Lifetime / one-time | Trial | Free tier | Source |
|---|---|---|---|---|---|---|---|
| Teleprompter for Video (Norton Five) | not found | $8.99 | **$34.99** | not found | 3-day | Scripts ≤ 750 chars (~1 min), no watermark; ads on Android | V-STORE |
| Teleprompter (Teleprompter Apps Ltd) | not found | sub available (price n/a) | n/a | **Yes**, one-time; $59.99 item seen (label unclear); IAPs $7.99–$59.99 | n/a | Unlimited scripts, record, 5 imports | V-STORE / 3P |
| Teleprompter.com | none | $19.99 | **$89.99** ($7.50/mo) | **none found** | 7-day; 30-day money-back | Free Starter | V-OFFICIAL / V-STORE |
| BIGVU (web) | none | Starter $12 · AI Pro $19 · Max $49 | n/a | not official (AppSumo deal mentioned, 3P) | n/a | 500 AI credits, 9-min rec, 720p, watermark | V-OFFICIAL |
| BIGVU (iOS IAP) | none | $14.99 / $18.99 / $24.99 | $139.99 (plus $99.99 for 6 mo) | none | n/a | as above | 3P AppPricingLab 2026-04-26 |
| PromptSmart Pro | none | Extended $1.99 (or $3.99, 3P) | Extended $19.99 | **$29.99 upfront app price** | 1-month Extended trial | Lite app free | V-STORE |
| Speakflow | none | Plus $15 (billed yearly) | $180/yr implied | none | n/a | Free, limited Flow | V-OFFICIAL |
| Captions (Mirage) | none | Basic ~$9.99 (3P); Max $24.99; Scale $69.99–$279.99 | discounted | none | n/a | 1 caption template, no AI credits; teleprompter free | 3P / V-OFFICIAL |
| CapCut teleprompter | — | CapCut Pro (price conflicting, ~$9.99–$19.99, 3P) | — | — | — | teleprompter reportedly free (UNVERIFIED) | 3P |
| Instagram Edits / IG camera | — | — | — | — | — | **Free** | press |
| Elegant Teleprompter | — | — | — | Pro **$3.99** one-time | — | Free with ads | COMPETITOR-CLAIM |
| Magic Teleprompter ("Teleprompter", MSDC Technologies) | — | $5.99 | $19.99 | none listed | — | yes | V-STORE |
| Promptly Pro Teleprompter (Craig Roberts) | — | £3.99 | £19.99 | none | 24 h | yes | V-STORE |
| Teleprompter for Reels | **$2.99** | $9.99 | $49.99 | none | — | yes, watermark | V-STORE |
| TikCue | — | $17.99 | $69.99 | — | 7-day | — | V-STORE |
| Scripttie | — | $5.99 | — | **$39.99** | — | — | V-STORE |
| AI Teleprompter for Video (id6474969496) | — | — | — | **$59.99** US ($69.99 other region) | — | — | V-STORE |
| Cue Teleprompter (Obtu Studio) | $3.99 | $6.99 | $14.99 | $29.99 | — | — | V-STORE |
| Teleprompter: AI Video Studio | — | — | — | $199.99–$229.99 | — | — | V-STORE |
| Teleprompter for Video Caption (id1670579165) | — | — | — | $29.99 | — | — | V-STORE |
| Unnamed teleprompter (Warthoglab) | **$9.99** | — | yes | yes | — | — | V-STORE |

### Observed patterns
- **Annual anchor:** The dedicated mobile-first prompter leader (Norton Five) sits at **$34.99/yr**. Premium cross-platform (Teleprompter.com) is at $89.99. AI video suites are at $139.99+/yr.
- **Monthly:** clusters at $5.99–$9.99 for prompter apps, and $12–$25 for AI suites.
- **Lifetime:** common among utilities and the new AI entrants ($29.99–$59.99 is typical; outliers go to $229.99). It is **absent** at Teleprompter.com, BIGVU and Norton Five, which makes it a differentiator in the creator segment.
- **Weekly plans** exist ($2.99–$9.99/wk) among newer apps. They are associated with trial and billing complaints category-wide (see user-pain-points.md §8). This is an inference; no review was found that links a weekly plan specifically to a complaint.
- **The free competition is real:** the Instagram and CapCut prompters are free. The paid value must come from voice-follow, reliability, captions and AI.

## 2. Evaluation of provisional pricing: $6.99/mo · $34.99/yr · $59.99 lifetime

| Plan | Assessment |
|---|---|
| **$6.99/mo** | Below Norton Five ($8.99) and Teleprompter for Reels ($9.99), above Magic Teleprompter ($5.99). Fine as a "decoy" that makes the annual plan look good: annual = **58% off** vs 12 × $6.99 = $83.88. Risk: monthly churners pull AI-generation cost without long-term LTV. **OK.** |
| **$34.99/yr** | Identical to Norton Five's annual price, the most direct competitor with a 4.9★ base. Price parity removes "cheaper" as an argument, so Promptly must win on product. Effective $2.92/mo. With variable AI cost (LLM calls for Script Studio, ASR for captions if server-side), the margin is thin if heavy users generate a lot. **Acceptable if** voice-follow and captions run on-device and AI has a fair-use cap. |
| **$59.99 lifetime** | Only **1.7× annual**. Common guidance (ASSUMPTION, industry rule of thumb) is a lifetime at 2–3× annual to avoid cannibalizing subscriptions. In-category lifetimes sit at $29.99–$59.99, so $59.99 is market-consistent. **Main risk:** lifetime + unlimited AI = an open-ended cost liability. |

## 3. Recommendation (for founder approval)

1. **Keep $34.99/yr as the hero plan** (default-selected, with a 7-day trial on annual only). Matching Norton Five neutralizes price objections. Do not undercut; compete on reliability and voice-follow.
2. **Monthly: $6.99 is acceptable; consider $7.99.** $7.99 increases the annual-plan discount framing (≈ 64% off) and stays under Norton Five's $8.99. Either is defensible; A/B test if traffic allows.
3. **Lifetime: offer it, but protect against AI cost.**
   - Option A (preferred): **$79.99 lifetime** (≈ 2.3× annual). It includes all non-AI Pro features forever plus a monthly AI allowance (e.g. N Script Studio generations/month, number to be set from cost modelling). Extra AI is available via a cheap top-up or by also subscribing.
   - Option B: keep **$59.99** as a limited-time **launch** lifetime (first 30–60 days or the first N buyers) to build reviews and early revenue, then raise it to $79.99–$99.99.
   - Either way, state the AI fair-use terms on the paywall.
4. **No weekly plan at launch.** The category's billing complaints are a positioning opportunity ("fair pricing").
5. **Free tier (proposal):** unlimited scripts, timed scroll, recording ≤ 60 s with **no watermark**, voice-follow trial (e.g. 3 takes/day or ≤ 60 s), captions with basic style + SRT, 3 AI generations/day. **Pro:** unlimited length, full voice-follow, burn-in caption styles, all AI tools, 4K, multi-platform export presets, remotes. Gate value, not footage.
6. **Trial hygiene** (also a review-rating lever): show the renewal date on the paywall, send a reminder 24 h before conversion, and keep cancel ≤ 2 taps from Settings. Track refund rate (< 2% target).
7. **Regional pricing:** use App Store / Play price tiers with purchasing-power adjustments for LATAM / IN / SEA if those languages launch. Do not simply convert USD (ASSUMPTION; validate with store tier tables).
8. **Validate before locking in:** cost per AI generation × expected generations per user, trial-to-paid rate, and annual-vs-lifetime mix after 4–6 weeks. Revisit the lifetime price if the lifetime share is over 35% of revenue (ASSUMPTION threshold).

**Required founder decisions:** monthly price ($6.99 vs $7.99); lifetime price and AI cap (A vs B); free-tier limits (60 s / watermark-free); trial length; whether weekly is ever allowed.

## Sources
https://apps.apple.com/us/app/teleprompter-for-video/id1139307843 · https://apps.apple.com/us/app/teleprompter/id941620509 · https://apppricinglab.com/iap/apple/941070561 · https://teleprompter.com/pricing · https://www.teleprompter.com/llms.txt · https://apps.apple.com/us/app/-/id1420515755 · https://bigvu.tv/pricing/ · https://apppricinglab.com/iap/apple/1124958568 · https://apps.apple.com/us/app/promptsmart-pro-teleprompter/id894811756 · https://www.apppricinglab.com/iap/apple/894811756 · https://speakflow.com/pricing · https://captions.ai/help/docs/api/pricing · https://www.hooked.so/compare/captions-ai-pricing · https://dupple.com/learn/is-capcut-free · https://www.teleprompter.com/compare/teleprompter-vs-elegant-teleprompter · https://apps.apple.com/app/id1468329050 · https://apps.apple.com/cz/app/promptly-pro-teleprompter/id6757360688 · https://apps.apple.com/us/app/teleprompter-for-reels/id6794462208 · https://apps.apple.com/us/app/telepompter/id6642695517 · https://apps.apple.com/lc/app/voice-teleprompter-scripttie/id6761836891 · https://apps.apple.com/us/app/al-teleprompter-for-video/id6474969496 · https://apps.apple.com/af/app/id6765807176 · https://apps.apple.com/us/app/id1670579165 · https://apps.apple.com/us/app/-/id6755679054
