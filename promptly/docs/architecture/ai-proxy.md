# AI proxy (server/)

Cloudflare Worker, `POST /v1/studio`, `GET /v1/balance`. Header `x-app-user-id` = RevenueCat app user ID.

Pipeline: validate (size ≤ 32 KB, field limits, enums) → per-IP daily limit → global daily budget →
entitlement (RevenueCat REST, cached 10 min) → atomic quota consume (Durable Object) → Claude call via
`@anthropic-ai/sdk` `messages.parse` with a Zod schema (`{script, alternatives}`), `effort: low`,
`max_tokens` 4000, 40 s timeout, 1 SDK retry → spend accounting → response. Model failures refund quota.

Quotas (env, provisional): free 5/month, subscription 150/month, lifetime 300 total, +100 per credit pack.
Errors: 400 invalid, 401 bad id, 402 quota, 413 too large, 429 rate limited, 422 refused, 502 upstream,
503 budget exhausted / disabled / entitlement lookup failed.

Prompt-injection hardening: creator text wrapped in `<creator_input>` tags and declared as data in the
system prompt; output is plain text shown as an editable draft (no tools, no actions).

Privacy: logs contain tool, plan, token counts, latency — never content. Anthropic API data handling per
Anthropic's commercial terms (to be disclosed in the privacy policy).

## Before production (required)
- App Attest (iOS) / Play Integrity (Android) token verification to bind requests to real installs.
- Founder approval of model, allowances, budget; set `AI_ENABLED=true`.
- Quality eval across models (see docs/business/ai-unit-economics.md).
