# Market Positioning: Promptly

Research date: 2026-10-20. Evidence in competitor-matrix.md and user-pain-points.md. Strategic judgments are marked **ASSUMPTION**.

## 1. Market map (observed)

| Segment | Players | What they own | Weakness for short-form creators |
|---|---|---|---|
| **Free, platform-native** | Instagram Edits and the IG main camera (free; Edits since 2025-06, IG camera around 2026-06); CapCut teleprompter (mobile only) | Zero friction, already in the creator's workflow, free | Manual speed only; voice-follow not documented (UNVERIFIED for IG; COMPETITOR-CLAIM for CapCut); locked to one ecosystem; no remotes |
| **Established dedicated prompters** | Teleprompter for Video (Norton Five; 4.9★ iOS, ~13–15K ratings), Teleprompter Apps Ltd (4.8★, 27K), Teleprompter.com (4.8★, ~27.7K), PromptSmart (4.6★, ~11K) | Ratings moat, years of ASO equity, remotes, rigs, mirroring, cross-platform (Teleprompter.com) | Voice tracking still unreliable; billing and trial complaints; dated, feature-heavy UX; PromptSmart VoiceTrack English-only |
| **Creator video suites with a prompter inside** | BIGVU, Captions/Mirage | AI editing, eye-contact fix, dubbing, avatars | Expensive ($12–$49+/mo, credits); watermark on free tier; cancellation complaints (BIGVU) |
| **New AI-teleprompter wave (2025–26)** | VoicePrompter, OtterScroll, Prompty, Teleprompter: AI Video Studio, Cue, TikCue, Teleprompter for Reels, Scripttie, CreatorCue, **Promptly Pro Teleprompter** | Same pitch as Promptly: AI scripts + voice-follow + captions + SRT, often on-device and offline | Few ratings; unproven reliability; crowded, near-identical naming |

**Key observation:** Every core Promptly feature already ships somewhere:
- teleprompter overlay excluded from the video: all dedicated apps
- timed scroll: universal
- voice-follow: PromptSmart, Teleprompter.com, Norton Five, VoicePrompter and others
- captions with SRT: Norton Five, Teleprompter: AI Video Studio
- burn-in: CapCut, Captions
- AI script generation and rewriting: Norton Five, BIGVU, CapCut, many new entrants
- multi-take merging: Cue

The feature list alone does not differentiate.

## 2. Target user (ASSUMPTION, to validate with 10–15 interviews)
A primary user is a "talking-head" short-form creator who posts 3–10 videos a week to more than one platform (TikTok + Reels + Shorts) and:
- writes or adapts their own scripts
- films on a phone, often with a wireless lav (DJI / Rode / Hollyland)
- edits lightly or not at all
- is price-sensitive but will pay for time saved

Secondary users: solo business owners, coaches and educators doing "faceless-to-face" content.

## 3. Where the incumbents are weak (evidence-based openings)
1. **Voice-follow reliability.** It is the most-praised and most-complained-about feature. Stalls, jumps and repeated-phrase skips are reported for PromptSmart and Norton Five, and about 80% take accuracy was measured in one 2026 test.
2. **Recording trust.** Users report crashes, lost recordings, A/V desync and broken external mics after updates, across several apps.
3. **Honest monetization.** Users report trials charging immediately, cancellation friction and repeated upsells (Norton Five, Teleprompter.com FAQ, BIGVU).
4. **Short-form-native script craft.** Generic AI "rewrite" exists, but there is little evidence of tools built around hook / retention / length-to-platform constraints. This is ASSUMPTION; we found no competitor claiming it explicitly beyond "hook" templates in Teleprompter for Reels.
5. **Multilingual voice-follow.** PromptSmart Pro is English-only. Newer apps claim 15–16 languages.
6. **Mic handling.** Bluetooth and wireless lav mics break voice tracking. PromptSmart tells users not to use Bluetooth.

## 4. Positioning statement (recommended)
> **Promptly is the teleprompter camera that never loses your place and never loses your take.** Write a scroll-stopping hook with AI, read it naturally while Promptly follows your voice, ad-libs included, and post a captioned, platform-ready video in one sitting, with no watermark.

Proof points we must be able to *measure and publish* (tie to REQs):
- "Follows you through ad-libs": ≥ 95% line accuracy on a published benchmark (REQ-VT-1).
- "Never lose a take": crash-safe segmented recording with auto-recovery (REQ-RL-2).
- "Captions from your script": script-aligned captions, ≤ 3% WER on-script (REQ-CAP-1).
- "Works with your mic": validated with DJI / Rode / AirPods (REQ-MIC-2).
- "Fair pricing": clear trial reminders, 2-tap cancel, lifetime option.

## 5. The honest answer: why choose Promptly over the teleprompter in CapCut / Edits, or over established apps?

**Honestly, as currently specced the differentiation is weak.**
- **Against CapCut and Edits/Instagram:** these are free, already open, and fine for a 20-second script read at a steady pace. A casual creator has little reason to download another app for "a teleprompter + captions + AI script". CapCut already offers captions and an AI writer, and IG now has the prompter in the main camera.
- **Against established apps:** Norton Five already sells voice scroll + recording + auto captions + SRT + AI rewrite at **$34.99/yr, the same annual price as Promptly's provisional plan**, with a 4.9★ rating base. Teleprompter.com has cross-platform sync and VoiceGlide. A newcomer at feature parity loses on trust and ratings.
- **Against the 2025–26 AI wave:** at least 10 small apps make nearly the same pitch, and one is literally named "Promptly Pro Teleprompter".

**A creator would choose Promptly only if it is clearly better at the moments that hurt.** How to sharpen:
1. **Make voice-follow the hero, and prove it.** Handle ad-libs, skipped lines, repeated phrases, going back, and Bluetooth/wireless mics, in 6+ languages on-device. Publish a reproducible benchmark video and comparison. This is the single biggest gap vs CapCut and Edits: neither documents voice-follow.
2. **"Never lose a take" reliability as brand.** Crash-safe recording, auto-recovery, mic pre-flight, A/V sync guarantee. Incumbents' reviews show this is where trust breaks.
3. **Short-form script craft, not generic rewrite.** The AI Script Studio should optimize for the first 2 seconds (hook variants with scoring), target length per platform (e.g. "fit 30 s Reels"), on-screen text and CTA, and a line-by-line "take mode": record one sentence at a time with auto-advance, keep the best take, and auto-stitch. Cue already does section merging, so execution quality matters.
4. **One recording → three platform-ready exports.** TikTok, Reels and Shorts presets, safe zones, script-aligned burned captions, no watermark on the free tier for short clips. Edits locks you into Instagram. CapCut requires an editing pass.
5. **Fair-pricing brand.** A lifetime option plus transparent trials directly addresses the most frequent complaint category.
6. **Fix the name before launch.** "Promptly Pro Teleprompter" exists on the App Store (and so does "Prompty"). Rename, or secure a distinctive brand + subtitle (see aso-keywords.md). **Founder decision.**

**If Promptly cannot hit the voice-follow and reliability targets at MVP**, the better bet is to narrow the scope further: a "short-form take-mode camera" (line-by-line recording + auto-stitch + script-aligned captions). In that version voice-follow becomes a secondary bonus, and the product competes on time-to-post rather than on prompting.

## Sources
See competitor-matrix.md and user-pain-points.md source lists. Key: https://www.socialmediatoday.com/news/instagram-introduces-teleprompter-tool/821564/ · https://www.capcut.com/help/use-front-camera-in-teleprompter · https://www.teleprompter.com/blog/teleprompter-com-vs-capcut-teleprompter · https://apps.apple.com/us/app/teleprompter-for-video/id1139307843 · https://apps.apple.com/cz/app/promptly-pro-teleprompter/id6757360688 · https://apps.apple.com/us/app/cue-teleprompter/id6795992585 · https://teleprompter.works/blog/promptsmart-pro-review/
