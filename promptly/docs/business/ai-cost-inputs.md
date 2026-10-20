# Promptly — AI & Platform Cost Inputs

Prices collected on **2026-10-20**. All amounts are USD and exclude tax.

Status labels match `docs/architecture/technical-feasibility.md`:

| Label | Meaning |
| --- | --- |
| **VERIFIED** | Fetched from the official page. |
| **VERIFIED (index)** | Official vendor page read through the search index, because direct fetch was blocked from this environment. |
| **UNVERIFIED** | Third-party source or estimate. |

**Re-check every VERIFIED (index) row before setting prices.**

## 1. LLM (script generation / rewrite)

| Provider / model | Input $/MTok | Output $/MTok | Notes | Status | Source |
| --- | --- | --- | --- | --- | --- |
| Anthropic **Claude Haiku 5.5** (`claude-haiku-5-5`), prompt ≤100k tokens | 0.10 | 0.50 | Cache hit $0.01. Over 100k-token prompts: $0.50 / $2.50. Batch −50%. | VERIFIED | https://platform.claude.com/docs/en/about-claude/pricing |
| Anthropic **Claude Sonnet 5.5** (`claude-sonnet-5-5`) | 2.00 | 10.00 | Cache hit $0.10 (0.05× input). Batch −50%. | VERIFIED | same |
| Anthropic Claude Sonnet 5 | 2.00 | 10.00 | Intro price made permanent; the planned rise to $3/$15 was cancelled. | VERIFIED | same |
| Anthropic Claude Haiku 4.5 | 1.00 | 5.00 | Older model | VERIFIED | same |
| OpenAI GPT-5.4 mini | 0.75 | 4.50 | — | VERIFIED (index) | https://openai.com/index/introducing-gpt-5-4-mini-and-nano/ |
| OpenAI GPT-5.4 nano | 0.20 | 1.25 | API only | VERIFIED (index) | same |
| OpenAI GPT-5 mini / nano (deprecated) | 0.25 / 0.05 | 2.00 / 0.40 | Marked deprecated on the model pages | VERIFIED (index) | https://developers.openai.com/api/docs/models/gpt-5-mini |
| Google Gemini 3.1 Flash-Lite | 0.25 (text) | 1.50 | Batch $0.125 / $0.75 | VERIFIED (index) | https://ai.google.dev/gemini-api/docs/pricing |
| Google Gemini 2.5 Flash-Lite | 0.10 | 0.40 | — | VERIFIED (index) | same |
| Google Gemini 2.5 Flash | 0.30 | 2.50 | — | VERIFIED (index) | same |
| Google Gemini 3.6 Flash | 0.75–1.50 | 3.75–7.50 | Sources conflict (intro price through 2026-12-31) | UNVERIFIED | https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6 |
| Apple Foundation Models (on-device, iOS 26+) | 0 | 0 | Apple Intelligence devices only | VERIFIED (availability) | https://developer.apple.com/documentation/foundationmodels |
| Gemini Nano via ML Kit GenAI Prompt API | 0 | 0 | Beta; limited device list | VERIFIED (index) | https://developers.google.com/ml-kit/genai |

Note: Claude 4.7+ models use a tokenizer that produces about 30% more tokens for the same text (Anthropic pricing page). The estimates below assume the current tokenizer.

**Per-request estimates (UNVERIFIED usage assumptions):**

| Task | Assumption | Haiku 5.5 | Sonnet 5.5 |
| --- | --- | --- | --- |
| Generate a 60–90 s script | 1,500 input (system + brief) + 1,000 output tokens | $0.00015 + $0.0005 = **$0.00065** | $0.003 + $0.010 = **$0.013** |
| Rewrite / shorten | 2,000 in + 800 out | **$0.0006** | **$0.012** |
| Heavy Pro user | 100 generations/month on Haiku | **≈ $0.07/month** | ≈ $1.30/month on Sonnet |

## 2. Transcription (captions)

| Provider / model | Price | Word timestamps | Status | Source |
| --- | --- | --- | --- | --- |
| On-device: Apple SFSpeechRecognizer / SpeechTranscriber; Android on-device SpeechRecognizer | $0 | yes (Android: 14+, on-device only) | VERIFIED | see technical-feasibility.md §3–4 |
| On-device: whisper.rn (MIT) | $0 (75–466 MiB model download) | yes (experimental) | VERIFIED | https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/README.md |
| OpenAI `gpt-4o-mini-transcribe` | ≈ $0.003/min est. ($1.25/MTok audio in, $5/MTok out) | no | VERIFIED (index) | https://developers.openai.com/api/docs/pricing |
| OpenAI `gpt-4o-transcribe` | ≈ $0.006/min est. | no | VERIFIED (index) | same |
| OpenAI `whisper-1` | $0.006/min | **yes** (`timestamp_granularities[]=word`, `verbose_json`) | VERIFIED (index) | https://developers.openai.com/api/docs/guides/speech-to-text |
| Deepgram Nova-3 pre-recorded, monolingual | $0.0043/min PAYG ($0.0036 Growth) | yes | VERIFIED (index) | https://deepgram.com/pricing |
| Deepgram Nova-3 pre-recorded, multilingual | $0.0052/min PAYG ($0.0043 Growth) | yes | VERIFIED (index) | same |
| Deepgram Nova-3 streaming, monolingual | $0.0048/min (other sources: $0.0077) | yes | VERIFIED (index), conflicting | same |
| AssemblyAI Universal-2 (async, 99 languages) | $0.15/hr (= $0.0025/min) | yes | VERIFIED (index) | https://www.assemblyai.com/pricing |
| AssemblyAI Universal-3.5 Pro (async, 18 languages) | $0.21/hr (= $0.0035/min) | yes | VERIFIED (index) | same |

**Per-video cost (3-minute take):** AssemblyAI U2 $0.0075; Deepgram $0.013; OpenAI mini $0.009; whisper-1 $0.018. A Pro user captioning 30 videos/month costs about **$0.23–$0.54/month** in the cloud, or $0 on-device.

## 3. Serverless proxy

| Service | Price | Status | Source |
| --- | --- | --- | --- |
| Cloudflare Workers Paid | $5/month minimum (covers Workers, KV, Durable Objects, Hyperdrive) | VERIFIED (index) | https://developers.cloudflare.com/workers/platform/pricing/ |
| — Workers requests / CPU | 10M requests included, then $0.30/M; 30M CPU-ms included, then $0.02/M CPU-ms | VERIFIED (index) | same |
| — Workers KV | 10M reads included, then $0.50/M; 1M writes included, then $5.00/M; 1 GB included, then $0.50/GB-mo | VERIFIED (index) | same |
| — D1 | 25B rows read included, then $0.001/M; 50M rows written included, then $1.00/M; 5 GB included, then $0.75/GB-mo | VERIFIED (index) | same |
| — Durable Objects | 1M requests included, then $0.15/M; 400k GB-s included, then $12.50/M GB-s; SQLite storage 5 GB included, then $0.20/GB-mo | VERIFIED (index) | https://developers.cloudflare.com/durable-objects/platform/pricing/ |
| Supabase Edge Functions | Free: 500k invocations; Pro: 2M included, then $2 per 1M (billed in 1M packages). Pro plan base fee not re-verified. | VERIFIED (index) | https://supabase.com/docs/guides/platform/billing-on-supabase |
| Apple App Attest | Free | VERIFIED | https://developer.apple.com/documentation/devicecheck/dcappattestservice |
| Google Play Integrity | Free; default 10,000 requests/day (can be raised) | VERIFIED | https://developer.android.com/google/play/integrity/overview |

At launch scale (under 10M requests/month), expect the proxy to cost **about $5/month** on Cloudflare.

## 4. RevenueCat

| Item | Value | Status | Source |
| --- | --- | --- | --- |
| Pro plan | Free until **$2,500 MTR**. Above that, **1% of total MTR** (e.g. $2,600 MTR → $26). MTR is gross, before store commission. | VERIFIED (index) | https://www.revenuecat.com/pricing ; https://www.revenuecat.com/docs/welcome/set-up-revenuecat/account-management |
| Test Store | Included with every project; separate API key | VERIFIED (index) | https://www.revenuecat.com/docs/test-and-launch/sandbox |
| SDK | `react-native-purchases` 10.15.0 (MIT) | VERIFIED | npm |

## 5. Store commissions

| Store | Rate | Status | Source |
| --- | --- | --- | --- |
| Apple: App Store Small Business Program | **15%** on paid apps and IAP (including subscriptions) for developers with ≤ $1M proceeds in the prior calendar year, counting Associated Developer Accounts. The standard rate applies for the rest of the year once $1M is crossed. You can re-qualify the year after falling below. | VERIFIED | https://developer.apple.com/app-store/small-business-program/ |
| Apple: standard auto-renewable subscriptions | 70% proceeds in the subscriber's first year (30% commission), 85% after one year of paid service. Small Business Program members get 85% from day one. | VERIFIED | https://developer.apple.com/app-store/subscriptions/ |
| Apple: lifetime (non-consumable IAP) | 15% with the Small Business Program; otherwise 30% | VERIFIED (SBP page) | https://developer.apple.com/app-store/small-business-program/ |
| Google Play: new structure from **2026-06-30** (US, EEA, UK first) | Service fee 10% on the first $1M annual earnings, and **10% on all auto-renewing subscriptions**. Google Play Billing adds a **5% billing fee**, so the effective rate is **15%** with Play Billing (10% + your own processor fee with alternative billing or web links). Other one-time transactions depend on new vs existing install; see the table on the blog. | VERIFIED | https://developer.android.com/blog/posts/expanded-billing-choice-and-lower-fees-on-google-play |
| Google Play: legacy structure (markets not yet migrated) | 15% on the first $1M/yr (15% service-fee tier enrolment); subscriptions 15% | VERIFIED (index) | https://support.google.com/googleplay/android-developer/answer/112622 ; https://play.google.com/about/additional-service-fee-tier-terms/ |

**Planning assumption:** an effective **15% store fee on both platforms**, plus RevenueCat 1% of gross once MTR passes $2.5k.

## 6. Unit-economics inputs (example, UNVERIFIED usage)

Pro monthly at $9.99 gross:

| Line item | Monthly cost |
| --- | --- |
| Store fee (15%) | $1.50 |
| RevenueCat (1%, above $2.5k MTR) | $0.10 |
| LLM: 100 Haiku generations | $0.07 |
| Cloud captions: 30 × 3-min takes | ≤ $0.54 |
| Proxy (amortized) | ≈ $0.01 |
| **Margin before tax and marketing** | **≈ $7.8 (≈ 78%)** |

Sonnet-by-default would add about $1.30/user/month at the same volume.
