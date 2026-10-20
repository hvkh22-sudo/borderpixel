# Competitor Matrix: Promptly (AI teleprompter for short-form creators)

Research date: **2026-10-20**. Everything below was observed on that date unless a source date is given.

## Evidence method and limitations (read first)

- **Direct page fetching failed.** WebFetch returned DNS errors (`ENOTFOUND`) for every domain tried: apps.apple.com, play.google.com, appfollow.io, apppricinglab.com, bigvu.tv, wikipedia.org. Direct `curl` to apps.apple.com, itunes.apple.com and play.google.com was refused by the egress proxy (HTTP 403). **No App Store or Google Play page was loaded directly.**
- All evidence comes from **WebSearch result text**: the search engine's indexed text and summaries of the cited URLs. Labels:
  - **V-STORE**: text from an official App Store or Google Play listing, as indexed by search (2026-10-20). Strong, but it can lag the live page.
  - **V-OFFICIAL**: text from the vendor's own site, help center or llms.txt, as indexed by search.
  - **3P**: a third-party tracker or review site (AppFollow, AppPricingLab, AppGoblin, chrome-stats, Marlvel, Trustpilot, SourceForge, blogs). These figures are reported, not verified.
  - **COMPETITOR-CLAIM**: a statement by one competitor about another (for example, Teleprompter.com's comparison pages). Treat it as biased.
  - **UNVERIFIED / ASSUMPTION**: not confirmed by any source found.
- Ratings vary by storefront, platform and snapshot date. Where sources conflict, all values are shown.
- No revenue or download numbers are asserted. Where a 3P tracker publishes modelled installs, they are noted as such and not relied on.

## Summary matrix

| # | App (developer) | Platforms | Audience | Voice-follow scroll | In-app recording | Auto captions | AI writing | Lifetime? | Headline price | Rating (source, date) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Teleprompter for Video** (Norton Five Ltd) | iOS, Android | Creators, vloggers, business | Yes, "voice-assisted scrolling" (V-STORE) | Yes | Yes, from recording timings; .srt export (V-STORE) | Yes, AI rewrite (Premium) (V-STORE) | UNVERIFIED (none found) | $8.99/mo, $34.99/yr (V-STORE) | iOS 4.9, 13K–15K ratings (V-STORE snippets); 14,041 (3P AppFollow). Play 4.7, 29.4K (V-STORE snippet); 4.65 / 27,701 (3P chrome-stats, v3.10.4, 2026-07-01) |
| 2 | **Teleprompter** (Teleprompter Apps Ltd) + sibling apps Teleprompter Pro, Telepromptr | iOS, Android | General, prosumer, rigs | No voice scroll found in listing (UNVERIFIED) | Yes, save to Photos (V-STORE) | Not found | Not found | **Yes**: "one-time in-app purchase forever, or as a subscription" (V-STORE) | Pro up to $59.99 one-time (V-STORE snippet; label unclear) | iOS 4.8, 27K (V-STORE snippet) |
| 3 | **BIGVU Teleprompter Captions AI** (BIGVU) | iOS, Android, web | Marketers, coaches, solo businesses | Not claimed in the snippets reviewed | Yes | Yes, styled; "up to 70 languages" (older help article) | Yes, AI scripts (credits) | Not official; anecdotal and AppSumo (3P) | Web: Starter $12/mo, AI Pro $19/mo, Max $49/mo (V-OFFICIAL). iOS IAP $14.99–$24.99/mo, $99.99/6 mo, $139.99/yr (3P AppPricingLab, 2026-04-26) | iOS 4.7, 31.5K (3P, 2026-03-01). Play 4.3 / 61.5K or 4.5 / ~67K (snippets conflict) |
| 4 | **PromptSmart Pro** (Belleau Technologies / PromptSmart) | iOS, Android | Speakers, presenters, pros | **Yes, patented "VoiceTrack"**, holds place off-script (V-STORE); **English only** in Pro (V-STORE) | Yes (Android: video and mirroring) | Not found | Not found | Paid upfront ($29.99), plus optional "Extended" sub | $29.99 + Extended $1.99/mo or $19.99/yr (V-STORE), $3.99 per 3P | iOS 4.57 / 11.7K (3P AppGoblin, Sep 2025); 4.6 / 10.6K (3P) |
| 5 | **CapCut teleprompter** (ByteDance) | iOS, Android only (not desktop or web) (V-OFFICIAL) | Mass-market creators | **No**, manual speed slider only (COMPETITOR-CLAIM) | Yes, in the CapCut camera | Yes, CapCut auto-captions (V-OFFICIAL) | AI writer available (V-OFFICIAL) | n/a | Teleprompter reported free; CapCut Pro tiers vary (3P conflicting) | n/a (feature inside CapCut) |
| 6 | **Instagram Edits / Instagram camera teleprompter** (Meta) | iOS, Android | IG Reels creators | Not documented. Speed slider only (V-press); "fixed scroll" (COMPETITOR-CLAIM) | Yes | Edits has captions (3P review) | Not found for the teleprompter | n/a | **Free** (press) | n/a |
| 7 | **Elegant Teleprompter** (Android-first) | Android, basic iOS | Budget users | Not found | **No built-in recording** (COMPETITOR-CLAIM) | No | No | Yes, Pro $3.99 one-time (COMPETITOR-CLAIM) | Free with ads | Pro 4.6 / 1,371 (3P, undated) |
| 8 | **Teleprompter.com** (Teleprompter LLC) | iOS, Android, Mac, web | Creators and business; cross-platform | **Yes, "VoiceGlide"** plus fixed speed / fixed time / WPM modes (V-OFFICIAL) | Yes, 4K (V-OFFICIAL) | Yes, captions "from scripts" (V-OFFICIAL) | Not confirmed | **No lifetime found** | Pro $19.99/mo, $89.99/yr (= $7.50/mo); 7-day trial; 30-day money-back (V-OFFICIAL + V-STORE) | iOS 4.8 / 27,670 (3P AppFollow US); 4.7 / 34.4K (3P Marlvel) |
| 9 | **Speakflow** | Web (plus devices) | Teams, presenters, agencies | **Yes, "Flow"** (limited on free) (V-OFFICIAL) | Yes, on Plus | Not found | Not found | No | Free; Plus $15/mo billed yearly; Studio $99/mo billed yearly (V-OFFICIAL) | Capterra 2.0 (1 review, meaningless) |
| 10 | **Captions** (Mirage, formerly Captions) | iOS, Android, web | AI-video creators | Not claimed | Yes | **Core product** | Yes, AI scripts and avatars (credits) | No | Max $24.99/mo; Scale $69.99–$279.99/mo; Basic $9.99 (3P) | Not observed |
| 11 | **Parrot Teleprompter** (The Padcaster, LLC) | iOS | Owners of Parrot hardware rigs | No | No (prompter only) | No | No | Free app | Free; hardware sold separately | Not observed |
| 12 | **VoicePrompter** | iOS, Android, Mac (Setapp) | Short-form creators | **Yes**, on-device; backward scroll; tap-to-jump (V-STORE + self-published) | Yes (Android) | Not found | "AI Teleprompter" variant listed | Android listing mentions a Lifetime option (3P) | Mac via Setapp from $9.99/mo (3P); free tier 3 scripts (3P) | Not observed |
| 13 | **Small AI-teleprompter cluster** (2025–26 entrants): OtterScroll (ex-FlowPrompter), Prompty, Teleprompter: AI Video Studio, TikCue, Teleprompter for Reels, Cue: Teleprompter, Scripttie, FoxCue, CreatorCue, **Promptly Pro Teleprompter** | Mostly iOS | Short-form creators | Most claim it | Most | Many (SRT export: Teleprompter: AI Video Studio) | Many | Several (Scripttie $39.99; AI Teleprompter for Video $59.99; Cue (Obtu) $29.99) | $2.99–$17.99 / wk–mo, $14.99–$69.99/yr | Mostly too few ratings to display (V-STORE) |

## Per-competitor notes

### 1. Teleprompter for Video (Norton Five Ltd): the closest direct competitor
- **Positioning:** A creator-friendly all-in-one: prompter beside the lens, recording, captions, post-edit (logo, music, green screen, resizing to landscape/portrait/square) (V-STORE, https://apps.apple.com/us/app/teleprompter-for-video/id1139307843).
- **Free tier:** "free for scripts of up to 750 characters, which is around 1 minute of video with no watermarks" (V-STORE). A 3-day trial on the subscription (V-STORE). The Android free tier has ads ("ads that can get annoying") (3P).
- **Premium:** longer scripts, logo, royalty-free music, floating script over other apps, AI rewriting, AI eye-contact enhancement (V-STORE). Remote control by Bluetooth remote, keyboard, foot pedal or Apple Watch (V-STORE).
- **Pricing:** Premium Monthly $8.99, Premium Annual $34.99 (V-STORE snippet, US). Lifetime and weekly plans were not found (UNVERIFIED).
- **Captions:** auto captions "from your recording timings" plus .srt export (V-STORE). **Burn-in is UNVERIFIED.**
- **Release notes:** a fix for an "audio sync issue … when mirroring during recording on iOS 26" (V-STORE, via search).
- **Localization:** localized store titles exist (e.g. "Teleprompter para Vídeo" on Spanish and Portuguese storefronts, 3P AppFollow). The full language list is UNVERIFIED.
- **Complaints:** see user-pain-points.md (voice scroll stops or jumps; trial charged immediately; external mic broke after an update; captions slower than voice; paywall to save scripts over 750 characters).

### 2. Teleprompter Apps Ltd: Teleprompter / Teleprompter Pro / Telepromptr
- **Free tier is generous:** "unlimited scripts with NO character or length limits", import of up to 5 Word/PDF/txt/rtf documents, record video, save to Photos (V-STORE, https://apps.apple.com/us/app/teleprompter/id941620509).
- **Monetization:** Pro "as a one-time in-app purchase forever, or as a subscription" (V-STORE). Price points seen: $59.99 Pro, plus an unlabeled $159.99 item (V-STORE snippet). A 3P tracker shows 4 IAPs from $7.99 to $59.99 on the Teleprompter Pro listing (id941070561). **The lifetime price label is UNVERIFIED.**
- **Positioning:** a long-running utility (Teleprompter Pro "first launched in 2011", V-STORE), rig-friendly (mirroring), with a large rating base (4.8, 27K).
- **Voice scroll:** not found in the free-feature list. The sibling app "AutoPrompter" (2018) advertised a voice engine (3P AppSpy).
- **Release notes** mention fixes for recording-state sync, video recording stability, and "a crash that could happen when starting/stopping a recording" (V-STORE via search, v3.86.0 and others).
- **Modelled figures:** 3P AppGoblin publishes modelled installs and revenue. They are **not used** here.

### 3. BIGVU
- **Positioning:** "Teleprompter + captions + AI" for businesses and marketers, broadening into social media management ("Social media audit, connect all social channels") (V-OFFICIAL, https://bigvu.tv/pricing/).
- **Free plan (2026 pricing page):** 500 AI credits/mo, recordings up to 9 minutes, 720p, **watermarked** (V-OFFICIAL).
- **Paid tiers:** Starter $12/mo (no watermark, 1080p, unlimited captions), AI Pro $19/mo (AI eye-contact fix, 4K, background replace, auto B-roll, AI dubbing in 30+ languages), Max $49/mo (V-OFFICIAL). iOS IAPs are higher: $14.99/$18.99/$24.99 monthly, $99.99 for 6 months, $139.99/yr (3P AppPricingLab, 2026-04-26).
- **Claims:** "more than 12 million users" (V-STORE, a self-reported figure).
- **Cancellation:** the help center explains that deleting the app does not cancel (V-OFFICIAL, https://faq.bigvu.tv/en/article/cancel-subscription-cm36tl/). Trustpilot shows repeated cancellation and billing grievances (3P, https://www.trustpilot.com/review/bigvu.tv).

### 4. PromptSmart Pro
- **Differentiator:** "patented VoiceTrack" speech recognition that "knows and will hold your place, waiting for you to return" when you go off-script (V-STORE, https://apps.apple.com/us/app/promptsmart-pro-teleprompter/id894811756). Works without a data connection (press, SpeechTechMag).
- **Language:** VoiceTrack is **English only** in Pro (V-STORE). The separate app PromptSmart+ lists about 14–15 languages (V-STORE).
- **Pricing:** $29.99 upfront, plus an "Extended" subscription (remote control, file sync, Scroll Assist) at $1.99/mo or $19.99/yr (V-STORE); $3.99 per 3P. One 3P roundup lists "Starter $9.99/mo or $99.99/yr" (conflicting; UNVERIFIED).
- **Developer advice:** use a microphone physically connected to the phone, "NO Bluetooth", for voice tracking (developer reply on App Store, V-STORE). **Bluetooth mics are a known weak spot for voice tracking.**
- **Independent test:** VoiceTrack was accurate on about 80% of takes in a quiet room (3P, teleprompter.works 2026 review).

### 5. CapCut teleprompter
- Mobile only. CapCut help states the teleprompter is not on desktop or web (V-OFFICIAL, https://www.capcut.com/help/use-front-camera-in-teleprompter). You can flip the camera mid-recording and the text keeps scrolling (V-OFFICIAL). Speed, text size and position are adjustable, and an AI writer is available (V-OFFICIAL).
- **Gaps:** manual speed slider only, no voice-follow, no Bluetooth clicker or pedal support (COMPETITOR-CLAIM, https://www.teleprompter.com/blog/teleprompter-com-vs-capcut-teleprompter).
- **Free vs Pro gating is UNVERIFIED** (3P sources conflict; one says CapCut charges extra for teleprompter features, another calls it free).
- **Strategic weight:** CapCut is where many creators already edit. Its teleprompter is "good enough" for casual users.

### 6. Instagram Edits and the main Instagram camera
- The Edits teleprompter launched in **June 2025** for all users. You paste a script, it scrolls near the front camera, sliders control size and speed, it can be dragged anywhere, and there is "Stickies-to-Teleprompter" conversion (press: Social Samosa, SocialMediaToday, AlternativeTo).
- Moved into the **main Instagram camera around late May / early June 2026** (Mosseri announcement; press dated 2026-05-31 and 2026-06-08). A French outlet reports the post was later deleted while the feature remains live (UNVERIFIED).
- **Free** (press). Voice-following is not documented (UNVERIFIED). It only works inside Instagram (COMPETITOR-CLAIM).
- **No native TikTok teleprompter was confirmed** (search found none).

### 7. Elegant Teleprompter
- Only competitor-sourced data was found (Teleprompter.com comparison): free with ads, Pro $3.99 one-time, floating window, no login, **no built-in recording**. Pro rating 4.6 / 1,371 (3P, undated). Treat all of it as COMPETITOR-CLAIM.

### 8. Teleprompter.com
- **Positioning:** a dedicated cross-platform prompter (web, iOS, Android, macOS). "One subscription works across all platforms" (V-OFFICIAL, https://www.teleprompter.com/llms.txt).
- **Features:** VoiceGlide (pauses and resumes with speech) plus fixed-speed, fixed-time and WPM modes, 4K recording, script sync with Google Drive / Dropbox / iCloud, captions generated from scripts (V-OFFICIAL). Bluetooth mic selectable (V-OFFICIAL). Smooth-scroll vs jump-to-spoken-word setting (V-OFFICIAL FAQ).
- **Price:** $19.99/mo, $89.99/yr; 7-day trial; 30-day money-back guarantee (V-OFFICIAL / V-STORE). **No lifetime option found.**
- **Signals:** an FAQ page titled "I got charged immediately instead of 7 days free trial" (V-OFFICIAL, https://www.teleprompter.com/faq/i-got-charged-immediately-instead-of-7-days-free-trial) shows trial-billing confusion is common. Teleprompter.com also runs heavy SEO comparison content against CapCut, Instagram, PromptSmart, Elegant and Speakflow.

### 9. Speakflow
- Web-first and team-oriented. Free tier with limited Flow. Plus $15/mo billed yearly (unlimited Flow, recording, overlay, voice commands, sync). Studio $99/mo billed yearly (V-OFFICIAL, https://speakflow.com/pricing). Not short-form specific.

### 10. Captions (Mirage)
- An AI video editor whose teleprompter was made free in January 2025 (3P, eesel.ai). Offers AI eye-contact correction in post, with help docs explaining gaze drift (V-OFFICIAL, https://captions.ai/help/guides/advanced/eye-contact). Credit-based pricing from about $9.99 (3P) to $279.99/mo (V-OFFICIAL API pricing doc). Reported $75M raise (press, 2026-03, rutab.net; UNVERIFIED amount).

### 11. Parrot Teleprompter (Padcaster)
- A free companion app for Parrot hardware. Landscape, portrait and mirror modes, Dropbox .txt import, loop, a remote via accessory (V-STORE, https://apps.apple.com/us/app/parrot-teleprompter/id1010384663). Not a creator-recording tool.

### 12–13. New AI-teleprompter entrants (crowding signal)
- **VoicePrompter:** on-device voice tracking with an approximately 150 MB model download then offline; floating over TikTok/IG; backward scroll; tap-to-jump (V-STORE, https://apps.apple.com/us/app/voiceprompter-ai-teleprompter/id6756851576).
- **OtterScroll (formerly FlowPrompter):** offline voice tracking in 16 languages, auto-captions, AI scripts (V-STORE / Play).
- **Prompty: AI Video Teleprompter:** AI scripts, voice auto-scroll, **on-device gaze tracker that nudges you back to the lens**, 720p/1080p/4K (V-STORE, id6767272173).
- **Teleprompter: AI Video Studio:** follows your pace, captions plus **SRT export**, 4K on Premium; Lifetime $199.99–$229.99 depending on region (V-STORE, id6765807176).
- **Cue: Teleprompter:** voice-follow that waits through breaths and ad-libs; **shoot in sections and merge best takes** (V-STORE, id6795992585).
- **Teleprompter for Reels:** captions, safe-area guides; $2.99/wk, $9.99/mo, $49.99/yr (V-STORE, id6794462208).
- **TikCue:** $17.99/mo, $69.99/yr (V-STORE, id6642695517).
- **Scripttie:** on-device; $5.99/mo or $39.99 lifetime (V-STORE).
- **Creator Cam:** records vertical and horizontal versions in one take (V-STORE, id6765870055).
- **Name collision:** **"Promptly Pro Teleprompter"** (Craig Roberts, id6757360688) is a live teleprompter app with voice-activated scrolling and recording, at £3.99/mo or £19.99/yr with a 24-hour trial (V-STORE, CZ and US storefront URLs). **"Prompty: AI Video Teleprompter"** is a near-identical name. A non-teleprompter app named "Promptly" also exists (id6797143717). **The provisional name "Promptly" has a real conflict and ASO-confusion risk. Run a trademark and naming check before launch.**

## Sources (all accessed via search 2026-10-20)
- Norton Five: https://apps.apple.com/us/app/teleprompter-for-video/id1139307843 · https://play.google.com/store/apps/details?id=norton.five.teleprompter · https://chrome-stats.com/d/norton.five.teleprompter · https://apps.appfollow.io/ios/teleprompter-for-video/1139307843?country=us · https://appgrooves.com/ios/1139307843/teleprompter-for-video/norton-five-ltd/negative · https://marlvel.ai/apps/teleprompter-for-video
- Teleprompter Apps Ltd: https://apps.apple.com/us/app/teleprompter/id941620509 · https://apps.apple.com/app/id941070561 · https://apppricinglab.com/iap/apple/941070561
- BIGVU: https://bigvu.tv/pricing/ · https://faq.bigvu.tv/en/article/cancel-subscription-cm36tl/ · https://apppricinglab.com/iap/apple/1124958568 · https://www.trustpilot.com/review/bigvu.tv · https://apps.apple.com/us/app/bigvu-teleprompter-captions-ai/id1124958568
- PromptSmart: https://apps.apple.com/us/app/promptsmart-pro-teleprompter/id894811756 · https://appgoblin.info/apps/894811756 · https://sourceforge.net/software/product/PromptSmart/ · https://teleprompter.works/blog/promptsmart-pro-review/ · https://www.speechtechmag.com/Articles/News/Speech-Technology-News/PromptSmart-Pro-Speech-Recognition-Based-Teleprompter-App-Now-Available-on-Android-123277.aspx · https://sites.duke.edu/ddmc/2015/11/19/promptsmart-automates-teleprompters-with-voice-recognition/
- CapCut: https://www.capcut.com/help/use-front-camera-in-teleprompter · https://www.teleprompter.com/blog/teleprompter-com-vs-capcut-teleprompter · https://www.capcut.com/help/auto-captions-in-capcut
- Instagram/Edits: https://www.socialsamosa.com/news-2/instagram-rolls-out-teleprompter-edits-app-9353326 · https://alternativeto.net/news/2025/6/instagram-edits-adds-teleprompter-overlays-and-script-controls-for-creators · https://www.socialmediatoday.com/news/instagram-introduces-teleprompter-tool/821564/ · https://www.igeeksblog.com/instagram-built-in-teleprompter-feature/ · https://siecledigital.fr/2026/06/08/un-prompteur-arrive-dans-instagram-pour-eviter-les-trous-de-memoire-en-video/
- Elegant: https://www.teleprompter.com/compare/teleprompter-vs-elegant-teleprompter
- Teleprompter.com: https://www.teleprompter.com/llms.txt · https://teleprompter.com/pricing · https://apps.apple.com/us/app/-/id1420515755 · https://www.teleprompter.com/faq/how-to-use-voice-scrolling-with-the-teleprompter-app
- Speakflow: https://speakflow.com/pricing
- Captions/Mirage: https://www.eesel.ai/blog/captions-ai · https://captions.ai/help/docs/api/pricing · https://captions.ai/help/guides/advanced/eye-contact · https://www.hooked.so/compare/captions-ai-pricing
- Parrot: https://apps.apple.com/us/app/parrot-teleprompter/id1010384663
- New entrants: https://apps.apple.com/us/app/voiceprompter-ai-teleprompter/id6756851576 · https://apps.apple.com/us/app/teleprompter-otterscroll/id6773507279 · https://apps.apple.com/us/app/prompty-ai-video-teleprompter/id6767272173 · https://apps.apple.com/af/app/id6765807176 · https://apps.apple.com/us/app/cue-teleprompter/id6795992585 · https://apps.apple.com/us/app/teleprompter-for-reels/id6794462208 · https://apps.apple.com/us/app/telepompter/id6642695517 · https://apps.apple.com/us/app/creator-cam-teleprompter/id6765870055 · https://apps.apple.com/cz/app/promptly-pro-teleprompter/id6757360688 · https://apps.apple.com/us/app/promptly/id6797143717
