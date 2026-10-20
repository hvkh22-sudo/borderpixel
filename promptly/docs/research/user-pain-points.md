# User Pain Points: Teleprompter and Short-Form Recording Apps

Research date: 2026-10-20. Evidence labels follow competitor-matrix.md (V-STORE / V-OFFICIAL / 3P / COMPETITOR-CLAIM / UNVERIFIED).

**Limitations:**
- App Store and Play review pages could not be loaded directly (fetch blocked), so quotes come from review text indexed by search.
- **Reddit threads did not surface in any search**, even with `site:reddit.com`. No Reddit evidence is claimed here. Community validation is still needed, for example a manual read of r/NewTubers, r/TikTokCreators and r/videography.
- Many indexed complaints are from 2022–2024. Recency is flagged where known.
- Frequency is qualitative ("recurring" means seen across 2 or more apps or sources). No percentages are claimed.

Each theme ends with **→ REQ**: a measurable requirement for Promptly.

---

## 1. Voice tracking loses place, stalls, or jumps (HIGH, recurring across apps)
- Norton Five, App Store (actor): voice activation "has always just stopped randomly… as if it suddenly stopped listening", then jumps ahead; a recent update made it worse (V-STORE review via search, undated).
- PromptSmart, SourceForge (2023): "It has voice tracking and will lose voice contact and stall"; when it catches up it makes "a fast jump" that loses the reader; it "stop[s] scrolling, often at the same point over and over again" (3P).
- PromptSmart: one user found auto-tracking "frankly worthless" and fell back to a timer (3P).
- PromptSmart, Duke DDMC review: "If similar phrases are close together in the script, the app might jump straight to the second reference" (3P).
- Independent 2026 test: VoiceTrack accurate on about 80% of takes in a quiet room; drift on long pauses or background noise (3P, teleprompter.works).
- Teleprompter.com offers a smooth-scroll vs "jump spoken word to top" toggle, which shows that jump behavior is a known UX tension (V-OFFICIAL).

**→ REQ-VT-1:** On a benchmark set of 50 short-form scripts (30–90 s, including ad-libs, repeated phrases and 3 s pauses), the current line stays correct for ≥ 95% of spoken words in a quiet room and ≥ 85% with 60 dB background noise.
**→ REQ-VT-2:** No forward jump of more than 1 line without 2 or more confirming matched words. Repeated-phrase disambiguation uses position priors.
**→ REQ-VT-3:** Recovery: a single tap on any word re-anchors in under 200 ms. A visible "listening" indicator shows within 500 ms when no speech is detected. Offline / on-device operation is required.

## 2. Scroll speed wrong (too fast or too slow) and pause handling
- Without good speed control, "speakers may end up racing to keep up or waiting awkwardly" (3P guide).
- CapCut and Instagram offer only a manual speed slider (V-OFFICIAL / press). The pace is fixed even if you pause (COMPETITOR-CLAIM).

**→ REQ-SC-1:** Timed mode sets speed from the target duration or WPM (e.g. "fit this script in 45 s") and shows a live ±s deviation.
**→ REQ-SC-2:** Speed adjusts during recording in steps of ≤ 5 WPM without stopping the take. A 3-2-1 countdown and lead-in line are configurable.

## 3. Eye contact / gaze drift
- "When you read from a teleprompter, your eyes naturally drift toward the text"; keep the text "as close to the lens as possible" (V-OFFICIAL, Captions help).
- Competitors monetize fixes: AI eye-contact fix on BIGVU AI Pro ($19/mo) (V-OFFICIAL); Norton Five Pro (V-STORE); Prompty's on-device gaze tracker (V-STORE).

**→ REQ-EC-1:** The default text window is anchored within 15% of screen height from the front camera, with a narrow column (≤ 6 words/line default) to limit horizontal eye travel.
**→ REQ-EC-2:** A post-record "gaze check" flags the percentage of time eyes are off-lens (stretch goal; AI gaze correction is not in MVP).

## 4. Crashes during recording and lost or corrupted recordings (HIGH severity)
- TeleP, App Store: crash on opening recordings; recordings missing; "all my scripts in the app are gone" after reinstall, right after buying a yearly plan (V-STORE review).
- Setapp Teleprompter app: "crashes when trying to change the camera and no audio records" (3P).
- Teleprompter Apps Ltd release notes: fixes for "a crash that could happen when starting/stopping a recording" and recording stability (V-STORE).
- PromptSmart: "frequent crashes … overall instability" (3P Marlvel summary).

**→ REQ-RL-1:** Crash-free sessions ≥ 99.8%, and crash-free *recording* sessions ≥ 99.9% (tracked by Crashlytics/Sentry).
**→ REQ-RL-2:** Recording writes fragmented/segmented MP4 (or periodic flush) so that, after a crash, OS kill or low battery, ≥ 95% of captured footage up to the last 2 s is recoverable on next launch.
**→ REQ-RL-3:** Recordings are saved to app storage **and** optionally auto-copied to Photos/Gallery. Scripts are backed up (iCloud/Drive or account) and survive reinstall. Free-space check before recording (warn at < 2 GB).
**→ REQ-RL-4:** Camera flip during recording does not crash or drop audio (tested on the 10 most-used devices per platform).

## 5. Audio/video sync and audio dropouts
- BIGVU, App Store: "voice is out of sync with the lip movement"; audio cuts out during recording (V-STORE reviews via search).
- Norton Five release note: fixed "audio sync issue … when mirroring during recording on iOS 26" (V-STORE).
- Variable frame rate is a root cause (3P, evelize).

**→ REQ-AV-1:** A/V offset ≤ 1 frame (≤ 40 ms) on exported files across all supported devices. Constant-frame-rate export. Automated sync test in CI with a clap/beep fixture.

## 6. Bluetooth and external microphones
- Norton Five, Play: after an update "the external microphone doesn't work any longer", and recordings were not saved (V-STORE review).
- Norton Five, App Store: switching from AirPods (listening) to an external mic is "cumbersome" because iOS routes to the AirPods mic (V-STORE review).
- PromptSmart developer: for voice tracking use a mic "actually connected to the phone (NO Bluetooth)" (V-STORE developer reply).
- OS updates silently reset mic permissions (3P, SteadyCue).

**→ REQ-MIC-1:** An explicit input picker (built-in / wired / USB-C / Lightning / Bluetooth / wireless lav receivers such as DJI, Rode) with a live level meter before recording.
**→ REQ-MIC-2:** Voice-follow works on Bluetooth input with accuracy ≤ 5 points below wired (benchmark), or the app warns clearly when it cannot.
**→ REQ-MIC-3:** A pre-flight check (permission, route, level) blocks "silent" recordings. Zero reports of silent takes is the target.

## 7. Watermarks and free-tier gating
- "One of the biggest hurdles in finding a free teleprompter app is the dreaded watermark" (3P guide).
- BIGVU free plan exports are watermarked, 720p (V-OFFICIAL). Teleprompter for Reels removes the watermark only on Pro (V-STORE).
- Norton Five: payment required to save a script over 750 characters (2022 review, V-STORE). Its free tier promotes "no watermarks" as a selling point (V-STORE).

**→ REQ-FT-1:** Free tier exports without a watermark at 1080p for recordings up to 60 s (decision for founder approval). Limits apply to AI usage and advanced features, not to the user's own footage.
**→ REQ-FT-2:** Users are never blocked from exporting a take they already recorded under the plan they had at recording time.

## 8. Pricing, trials and cancellation (HIGH frequency)
- Norton Five: charged "as soon as I started my trial" instead of after 3 days (3P AppGrooves/worldsapps). A user who tapped subscribe by mistake on the annual plan was charged (V-STORE review).
- Teleprompter.com has a dedicated FAQ: "I got charged immediately instead of 7 days free trial" (V-OFFICIAL).
- BIGVU Trustpilot: "NO BUTTON on 'Cancel Subscription'", unable to cancel by phone or email, a £99 charge for an unused app (3P). A paid "effects" feature disappeared after purchase (V-STORE review). An AI upsell on every launch makes the app "Almost Unusable" (V-STORE review).
- Teleprompter.com: complaints about paywalls and billing (3P Marlvel). Mirror mode is charged; an email is required for the free tier (3P Kimola, app attribution uncertain).

**→ REQ-PR-1:** Trial terms (length, price, renewal date) appear on the paywall and in a push/email reminder 24 h before conversion. Target: refund-request rate < 2% of conversions.
**→ REQ-PR-2:** "Manage / cancel subscription" is reachable in ≤ 2 taps from Settings and deep-links to the OS subscription page.
**→ REQ-PR-3:** At most 1 paywall impression per session outside user-initiated Pro actions, and no paywall on cold start after onboarding.
**→ REQ-PR-4:** No weekly plan at launch (founder decision).

## 9. Onboarding friction
- Required email for the free version is a privacy concern (3P).
- Soft paywalls early in onboarding push the annual plan (3P screensdesign analysis of Norton Five).

**→ REQ-ON-1:** First recording without an account in < 60 s from first launch (median, measured). Account creation is optional and only needed for sync.
**→ REQ-ON-2:** Activation metric: ≥ 60% of new installs complete one recording on day 0.

## 10. Export problems
- "Paywalls for saving/exporting" is a recurring theme (3P Marlvel summary of Norton Five reviews).
- Users want platform-ready output. Competitors advertise resize to 9:16 / 1:1 / 16:9 and safe-area guides (V-STORE).

**→ REQ-EX-1:** One-tap export presets for TikTok / Reels / Shorts (9:16, 1080×1920, H.264/HEVC, 30/60 fps) plus YouTube 16:9. Export of a 60 s 1080p clip finishes in ≤ 15 s on an iPhone 13 / Pixel 7-class device.
**→ REQ-EX-2:** Exports go to Photos/Gallery and the share sheet. SRT export is separate. Captions can be burned in.

## 11. Caption accuracy and timing
- Norton Five (2022): "My captions are much slower than my voice", requiring a re-record (V-STORE review).
- CapCut help: speech-recognition captions misread words with noise, accents or fast speech (V-OFFICIAL). Tester: about 94–96% accurate on clear English, about 85% with strong accents or music (3P).

**→ REQ-CAP-1:** Because Promptly knows the script, captions align to the script text (forced alignment), not raw ASR alone. Target word error rate ≤ 3% on on-script speech, with ASR fallback for ad-libs.
**→ REQ-CAP-2:** Caption timing error ≤ 100 ms at word start (median). Editing a word does not reset styling. Burn-in render matches preview.

## 12. Cloud uploads, accounts, privacy
- Pocket Teleprompter markets "scripts and recordings saved locally" (V-STORE), which implies demand for local-first storage.
- Several AI/voice apps emphasize on-device and offline processing (VoicePrompter, Scripttie, OtterScroll, PromptSmart) (V-STORE).

**→ REQ-CL-1:** Video never leaves the device unless the user explicitly uses a cloud feature. Voice-follow runs on-device. AI Script Studio sends only script text. All of this is disclosed in onboarding and the privacy label.

## 13. Languages
- PromptSmart Pro VoiceTrack is English only (V-STORE). Competitors advertise 15–16 languages (PromptSmart+, OtterScroll) or 28+ (Teleprompter App Video Script) (V-STORE).

**→ REQ-LG-1:** At launch, voice-follow and captions in at least EN, ES, PT-BR, FR, DE, IT, plus right-to-left rendering readiness. UI localized for the same set. Accuracy per language is reported against the REQ-VT-1 benchmark before claiming support.

## 14. Update regressions
- Norton Five: an update broke the external mic (V-STORE). Telepromptr: an update removed paste and multi-script management (3P Marlvel). PromptSmart: formatting tools crash after an update (3P).

**→ REQ-QA-1:** A device-matrix regression suite covers record, mic routing, voice-follow and export before each release. Staged rollout (≤ 10% for 48 h) with crash-rate gates.

---

## Sources
https://apps.apple.com/us/app/teleprompter-for-video/id1139307843 · https://play.google.com/store/apps/details?id=norton.five.teleprompter&hl=en_IN · https://appgrooves.com/ios/1139307843/teleprompter-for-video/norton-five-ltd/negative · https://worldsapps.com/reviews-teleprompter-for-video · https://marlvel.ai/apps/teleprompter-for-video · https://sourceforge.net/software/product/PromptSmart/ · https://teleprompter.works/blog/promptsmart-pro-review/ · https://sites.duke.edu/ddmc/2015/11/19/promptsmart-automates-teleprompters-with-voice-recognition/ · https://apps.apple.com/us/app/promptsmart-pro-teleprompter/id894811756 · https://www.teleprompter.com/faq/how-to-use-voice-scrolling-with-the-teleprompter-app · https://www.teleprompter.com/faq/i-got-charged-immediately-instead-of-7-days-free-trial · https://marlvel.ai/apps/matekovacs-teleprompter · https://kimola.com/reports/unlock-insights-with-our-teleprompter-app-feedback-report-app-store-tr-154383 · https://captions.ai/help/guides/advanced/eye-contact · https://bigvu.tv/pricing/ · https://www.trustpilot.com/review/bigvu.tv · https://apps.apple.com/us/app/bigvu-teleprompter-captions-ai/id1124958568?see-all=reviews&platform=iphone · https://apps.apple.com/app/id6748080318 · https://setapp.com/apps/teleprompter-app/customer-reviews · https://apps.apple.com/us/app/teleprompter/id941620509 · https://evelize.com/blog/teleprompter-audio-sync-common-mistakes · https://steadycue.com/fix/voice-activated-teleprompter-not-working/ · https://www.capcut.com/help/auto-captions-in-capcut · https://marcandrews.com/?p=3178 · https://screensdesign.com/showcase/teleprompter-for-video · https://tool.rubadub.co.uk/7-best-teleprompter-app-iphone-i9i5.html · https://play.google.com/store/apps/details?id=com.pocketteleprompter.app&hl=en · https://apps.apple.com/app/id6449695164
