# Product Opportunities: Ranked → Requirements

Research date: 2026-10-20. The ranking scores **Evidence of pain** (E), **Gap vs free built-ins and incumbents** (G), **Fit with the Promptly core** (F), and **Effort**, where a lower score means more effort. Scores are 1–5. The ranking is a judgment (ASSUMPTION) built on the evidence in user-pain-points.md and competitor-matrix.md.

| Rank | Opportunity | E | G | F | Effort | Why |
|---|---|---|---|---|---|---|
| 1 | **Voice-follow that survives real speech** (ad-libs, pauses, repeated phrases, going back, BT/wireless mics, multilingual, on-device) | 5 | 4 | 5 | 2 | Most-cited failure across PromptSmart and Norton Five; not documented in CapCut or IG; PromptSmart Pro is English-only |
| 2 | **"Never lose a take" recording reliability** | 4 | 3 | 5 | 3 | Crash and lost-recording reports across several apps; incumbents ship fixes for start/stop crashes; trust is the precondition for paying |
| 3 | **Script-aligned captions** (forced alignment to the known script, burn-in + SRT) | 3 | 4 | 5 | 3 | Captions slower than voice (Norton Five); ASR misreads (CapCut help); Promptly uniquely has the script at record time |
| 4 | **Fair, transparent monetization** (trial reminder, 2-tap cancel, lifetime, no watermark on short free clips) | 5 | 4 | 4 | 5 | Billing and trial complaints for Norton Five, Teleprompter.com and BIGVU; lifetime absent at the three big creator players |
| 5 | **Short-form Script Studio** (hook variants, fit-to-duration, platform adapt, CTA) | 2 | 3 | 5 | 4 | Generic AI rewrite is everywhere; short-form constraint tooling is less visible (ASSUMPTION) |
| 6 | **Take mode**: record line by line or section by section, auto-advance, keep best take, auto-stitch | 3 | 3 | 4 | 3 | Reduces the need to read long scripts perfectly; Cue already offers section merge, so it is a parity-plus feature |
| 7 | **Mic pre-flight and routing** | 4 | 4 | 4 | 4 | External/BT mic regressions and AirPods routing confusion; PromptSmart says "NO Bluetooth" |
| 8 | **Eye-contact-first layout** (+ later gaze check) | 3 | 2 | 4 | 4 / 2 | Paid features at BIGVU and Norton Five; Prompty has a gaze tracker; layout is cheap, AI gaze correction is expensive |
| 9 | **Multi-platform export presets** (TikTok / Reels / Shorts / YT) with safe zones | 2 | 3 | 4 | 4 | Edits is Instagram-locked; competitors advertise resize and safe areas |
| 10 | **Remote control** (BT clicker, keyboard, Apple Watch) | 2 | 3 | 3 | 4 | Norton Five supports it; CapCut does not (COMPETITOR-CLAIM) |
| 11 | **Floating prompter over other apps** (Android overlay; iOS PiP where feasible) | 2 | 3 | 2 | 2 | Norton Five Premium, VoicePrompter, ScrollVox; lets creators record inside TikTok/IG. It conflicts with "our camera" focus, so treat it as a later option |

## Requirements by opportunity

### O1. Voice-follow
- **REQ-VT-1:** ≥ 95% current-line accuracy (quiet room) and ≥ 85% (60 dB noise) on a 50-script benchmark that includes ad-libs, repeated phrases and 3 s pauses.
- **REQ-VT-2:** No forward jump of more than 1 line without 2 or more confirming words. Backward re-anchoring is supported.
- **REQ-VT-3:** Tap-to-re-anchor in under 200 ms. "Not hearing you" indicator within 500 ms. Fully on-device and offline.
- **REQ-VT-4:** Latency from spoken word to highlight ≤ 300 ms (p90) on iPhone 12 / Pixel 6-class devices.
- **REQ-LG-1:** EN, ES, PT-BR, FR, DE, IT at launch, with each language passing the benchmark before it is marketed.
- **KPI:** share of takes where the user manually scrolls or re-anchors ≤ 10%.

### O2. Reliability
- **REQ-RL-1:** Crash-free sessions ≥ 99.8%; crash-free recording sessions ≥ 99.9%.
- **REQ-RL-2:** Crash/kill recovery keeps ≥ 95% of footage up to the last 2 s.
- **REQ-RL-3:** Optional auto-save to Photos/Gallery; scripts survive reinstall via backup; low-storage warning under 2 GB.
- **REQ-AV-1:** A/V offset ≤ 40 ms; constant frame rate.
- **REQ-QA-1:** Device-matrix regression suite; staged rollout with crash gates.

### O3. Captions
- **REQ-CAP-1:** On-script WER ≤ 3% via forced alignment; ASR fallback for ad-libs.
- **REQ-CAP-2:** Word-start timing error ≤ 100 ms median; burn-in render identical to preview; SRT export valid (passes YouTube upload).
- **REQ-CAP-3:** Caption editor: fixing a word takes ≤ 2 taps; styles persist.

### O4. Monetization trust
- **REQ-PR-1:** Paywall shows the trial end date; reminder 24 h before conversion; refund rate < 2%.
- **REQ-PR-2:** Cancel/manage reachable in ≤ 2 taps.
- **REQ-PR-3:** ≤ 1 unsolicited paywall per session; none on cold start post-onboarding.
- **REQ-FT-1:** Free export of ≤ 60 s at 1080p without a watermark (founder approval).
- **REQ-FT-2:** Never block export of footage already recorded.

### O5. Script Studio
- **REQ-AI-1:** Generate 3–5 hook variants for any script in ≤ 5 s (p90).
- **REQ-AI-2:** "Fit to N seconds" shortens to within ±10% of the target read time at the user's measured WPM.
- **REQ-AI-3:** Platform adapt (TikTok / Reels / Shorts / YouTube) changes length, CTA and on-screen text suggestions; tone presets.
- **REQ-AI-4:** Only script text is sent to the AI provider; disclosed; per-user fair-use quota enforced server-side.
- **KPI:** ≥ 40% of recorded scripts touched by Script Studio.

### O6. Take mode
- **REQ-TK-1:** Record per line or section; retake a single line without re-recording the rest; auto-stitch with ≤ 1 frame gap and audio crossfade ≤ 20 ms.
- **KPI:** median time from script to exported video ≤ 5 min for a 45 s script.

### O7. Mic pre-flight
- **REQ-MIC-1:** Input picker with live meter; remembers the last device.
- **REQ-MIC-2:** Voice-follow on Bluetooth within 5 points of wired accuracy, or an explicit warning.
- **REQ-MIC-3:** Block or warn on silent input before recording starts.

### O8. Eye contact
- **REQ-EC-1:** Text window within 15% of screen height from the front lens by default; ≤ 6 words/line default.
- **REQ-EC-2 (later):** Post-record gaze-off-lens percentage.

### O9. Export
- **REQ-EX-1:** Presets for 9:16 1080×1920 (30/60 fps) and 16:9. Export of 60 s 1080p in ≤ 15 s on iPhone 13 / Pixel 7-class.
- **REQ-EX-2:** Safe-zone overlays per platform (preview only, never baked in).
- **REQ-OV-1:** The prompter overlay is never present in the exported video (verified by automated frame test).

### O10–11. Remotes / floating prompter
- **REQ-RC-1:** BT HID clicker and keyboard (space/arrow keys) control start/stop/scroll.
- **REQ-FP-1 (post-MVP, Android first):** overlay prompter over other camera apps.

## Explicit non-goals for MVP (to stay focused)
AI avatars, AI dubbing, background replace, B-roll generation, team workspaces. These are BIGVU/Captions territory, carry high cost, and are off-core.
