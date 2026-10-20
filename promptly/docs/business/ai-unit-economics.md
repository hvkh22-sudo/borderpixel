# AI unit economics

Status: **estimate** (no production traffic yet). Prices: Anthropic's published rates as cached in the
Claude API reference on 2026-10-06 (re-verify before launch). Other inputs: `ai-cost-inputs.md`.

## 1. Cost per Script Studio request

Token assumptions (ASSUMPTION — measure with real traffic via the proxy's `studio_ok` logs):

| Item | Tokens |
|---|---|
| System prompt (server/src/prompts.ts) | ~350 input |
| Tool instructions + a 60–90 s script (150–230 words) | ~550 input |
| Output script (~200 words) + structured-output overhead | ~350 output |
| Model reasoning at `effort: low` (thinking is always on for these models) | ~150–400 output |
| **Typical total** | **~900 in / ~700 out** |

| Model | $/MTok in / out | Cost per typical request | Worst-case request (12k-char script, ~3.5k in / 4k out) |
|---|---|---|---|
| `claude-opus-5-5` (current server default) | $4 / $20 | **$0.0176** | $0.094 |
| `claude-sonnet-5-5` | $2 / $10 | $0.0088 | $0.047 |
| `claude-haiku-5-5` | $0.10 / $0.50 | **$0.00044** | $0.0024 |

## 2. Per-user AI cost vs. allowance (PROVISIONAL limits in `server/wrangler.toml`)

| Plan | Allowance | Opus 5.5 worst case (allowance fully used) | Haiku 5.5 worst case | Net revenue / user / month* |
|---|---|---|---|---|
| Free | 5 / month | $0.09 | $0.002 | $0 |
| Pro monthly ($6.99) | 150 / month | **$2.64** | $0.07 | $5.87 |
| Pro annual ($34.99) | 150 / month | **$2.64** | $0.07 | **$2.45** |
| Lifetime ($59.99) | 300 one-time + packs | $5.28 total | $0.13 total | $50.39 one-time |

\* After 15% store fee and 1% RevenueCat (above $2.5k MTR).

**Finding:** with Opus 5.5 an annual subscriber who uses the whole allowance costs more than they pay.
Expected usage is far lower (ASSUMPTION: median ~10–20 requests/month → $0.18–$0.35 on Opus), but the
allowance must be safe in the worst case.

## 3. Recommendation (founder decision required)

1. **Decide the model with a quality eval, not by assumption.** Run 30–50 representative scripts through
   Opus 5.5, Sonnet 5.5 and Haiku 5.5 and compare naturalness, length accuracy and fact preservation.
   If Haiku 5.5 is close enough for rewrite/shorten tools, it makes the allowance essentially free.
2. If Opus 5.5 is kept: lower the Pro allowance to **60/month** (worst case $1.06 < $2.45) or route
   `generate`/`hook` to Opus and the rest to a cheaper model.
3. Keep the **hard daily budget** (`DAILY_BUDGET_USD`, default $5) and kill switch (`AI_ENABLED`) on
   until real usage data exists.
4. Lifetime: a one-time 300-credit grant is bounded ($5.28 worst case on Opus). Never offer unlimited AI.

## 4. Captions and Voice Follow

Both run on-device (Apple Speech / Android SpeechRecognizer): **$0 variable cost**. Cloud transcription
is not used in v1. If ever added (opt-in), Deepgram (~$0.0043/min) would cost ~$0.004 per 60 s take
(VERIFIED (index), see ai-cost-inputs.md).
