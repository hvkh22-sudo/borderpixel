# Development plan

Last updated: 2026-10-23.

## Milestones
| Phase | Scope | Status |
|---|---|---|
| 0 Environment | Repo, Expo SDK 58 scaffold, deps | ✅ done (Linux cloud container: no Xcode, Android SDK blocked by network policy) |
| 1 Research & spec | Market, pricing, feasibility, PRD | ✅ docs written (store pages could not be fetched directly — see research caveats) |
| 2 Technical PoC | Record + overlay + Voice Follow coexistence on devices | 🟡 code written; **device PoC not run** (no devices here) |
| 3 Design system & navigation | Tokens, components, all main screens | ✅ implemented, not visually reviewed on device |
| 4 Recording engine | State machine, VisionCamera screen, finalize/recovery, preview, export | 🟡 implemented; device-untested |
| 5 AI features | Aligner + controller (tested), speech wrapper, captions pipeline, Studio + proxy | 🟡 logic tested; platform integration untested |
| 6 Monetization | Entitlements, paywall, restore, manage | 🟡 implemented; store products not configured |
| 7 Stabilization | Device matrix, profiling, accessibility audit | ⬜ |
| 8 Beta | TestFlight / Play internal testing | ⬜ needs accounts + approval |
| 9 Launch prep | Store assets, policy, review notes | 🟡 drafts in docs/launch |

## Session 2 (done)
- Explicit platform support gate (Android 13+ for Voice Follow/captions; native module presence).
- `eas.json` build profiles + `docs/testing/device-poc-runbook.md` (cloud builds, no Mac needed).
- Recovered takes: duration via native module, Home notice.
- Original app icon generated from code (`scripts/generate-icons.py`).
- AI model comparison harness `server/eval` (dry run only; real run needs approval, ≤ $1.46).

## Night session (2026-10-20/21, autonomous; founder asleep)
Merged into `claude/youthful-volta-vdsr0x`, each with tests (375+ app tests, 50+ server tests), none device-verified:
- Script folders, scripts backup export + import (merge without overwrite)
- Learned speaking rate; recording presets (vertical/landscape/60 fps)
- Microphone check sheet (expo-audio metering, verdicts, input name)
- Captions: long takes (Android chunked recognition), word-by-word highlight (Pro, preview + native burn-in), Soft Box + Pop styles
- Recording reliability: session controller, races, records directly into documents dir, watchdogs
- Performance: per-paragraph teleprompter rendering, faster aligner, memoized lists, debounced search, faster startup
- Accessibility pass (labels/actions/contrast/targets/announcements)
- Bluetooth/keyboard remote (native key capture iOS + Android; record toggle opt-in)
- AI proxy device integrity (App Attest / Play Integrity, mode `report`)
- Maestro E2E flows (Android device + iOS simulator), Hebrew founder checklist
- iOS permission prompts localized (en/he); landing page (en/he) at apps/promptly/
- Three bug reviews (9 + 10 + 2 fixes); two native-module reviews
- iOS 'separate' audio fallback for Voice Follow + Diagnostics screen (overrides, local log)
- First-take guidance (Home checklist, setup/record/take tips); Hebrew copy polish + glossary in he.ts
- GitHub Actions CI (`.github/workflows/promptly-ci.yml`): JS checks + Android `assembleDebug` +
  iOS simulator build (unsigned). First time the native code is compiled; results tracked in QUALITY_CHECKLIST.md

## CI + emulator/simulator session (2026-10-21/23)
- `.github/workflows/promptly-ci.yml`: JS checks; Android release APK (sideloadable test build);
  Android emulator + iOS Simulator Maestro runs (English 01/02/06 gating; camera 03–05 and Hebrew 07
  reported); failure screenshots printed into the job log (`.github/scripts/`).
- Native code compiles on both platforms; 4 Kotlin compile errors and 7 runtime issues fixed.
- Found and fixed on the emulator/simulator: RTL text in TextInputs sat on the left edge (both OSes);
  English sample script in a Hebrew UI; Hebrew missing from speech languages; bare "he" locale (iOS).
- All screens reviewed in Hebrew on both platforms (screenshots); app cold start ≈0.8–0.9 s on the
  emulator (relative only).

## Next actions (in order)
1. **Android now:** sideload the CI test APK (`docs/testing/founder-checklist-he.md` §0) and run the
   founder checklist (REC-01..05, VF-01..04). **iOS:** needs a signed build (EAS + `EXPO_TOKEN`, or TestFlight).
2. ✅ Native code compiles on both platforms in CI (2026-10-21); emulator Maestro run added (`android-e2e`).
   ✅ 2026-10-23: CI screen tours green on emulator + simulator — English core flows, Hebrew/RTL (07),
   dark mode and large text (08); layout fixes from the screenshots are in. Remaining large-text notes
   (iOS AX sizes: Create sheet, paywall footer, editor bar over word count) are listed in QUALITY_CHECKLIST.
3. Verify overlay absence in the exported file on both platforms (REC-02) — release blocker.
4. Measure Voice Follow latency/accuracy with the scripted protocol; set thresholds from baseline.
5. **Founder decision (2026-10-20): API key and model eval are deferred to the END** — continue all
   work without a key; connect the key and run `server/eval` (approved, ≤ $1.46) as a final step. Other founder decisions: name, prices, AI model, enabling AI spend, analytics provider.
6. Configure RevenueCat + store products; sandbox purchase test matrix (PUR-*).
7. Add device attestation to the AI proxy before free-tier AI goes live.

## Code review of recording → export (2026-10-28)
Fixed (unit-tested where JS; native compiled in CI, behaviour **not tested on a device**): Android back
mid-take saved a silent take; mux reported success with no audio placed and the WAVs were deleted;
Android mux placed unreadable segments untrimmed (shifting later audio); "saved without sound" was
shown as a generic message; export double tap / cancel race; recording could start before the script loaded.
Open (need a device or a design call):
- Android Voice Follow: a recognizer error (e.g. `network`) or a failed `vf.start()` leaves the rest of
  the take silent — the camera records video only. Options: keep the recognizer capturing audio after
  errors, or stop the take and tell the user. Verify behaviour on a device first (VF-03).
- Recognizer WAVs live in the cache dir until finalize; a crash mid-take loses the link (and the OS may
  purge them). Fix: `recordingOptions.outputDirectory` under documents with a take-derived name — needs a
  device check of the path format the library expects.
- ✅ "Saved without sound" is stored on the recording row (`audio_missing`) and shown when reopened.
- ✅ Camera error before recording: "Try again" remounts the camera, and a camera that comes back by itself returns to ready. `muxAudio` now times out (max(2 min, 3× take length)) and is handled as a merge failure.
- ✅ Android `muxAudio`/`burnInCaptions` read durations off the main thread; a cancel before the Transformer starts is honoured.
- Device-only: Media3 audio sequence starting with a gap; iOS caption text layer width slack.

## Code review: AI proxy, purchases, captions (2026-10-29)
Fixed (unit-tested; AI stays disabled): AI proxy budget reservation (concurrency/timeouts can't overshoot), free-tier budget
share, IPv6 /64 rate limit, IP limits on balance/integrity, byte-capped body, prompt tag escape, no SDK retry, hook token cap,
no-expiry entitlement = lifetime. Purchases: access applied as soon as it loads; gates don't downgrade/paywall before it
loads; purchase listener registered even if the first fetch failed; refunded lifetime no longer unlocks Pro (the lifetime
product must be attached to the `pro` entitlement in RevenueCat). Captions: trailing space while typing, unsaved-changes
prompt, shift-all no longer drops cues, empty cues not burned in, regenerate; RTL lines that start with a Latin word keep RTL
in the preview and SRT (RLM).
Open: free Voice Follow counter resets on reinstall (needs Keychain/Keystore or a server-side counter — design call); mixed Hebrew/English cues now get an RLM in the burn-in payload too — verify the rendering on a device.

## Code review: Voice Follow engine, scripts & data (2026-10-30)
Fixed (unit-tested, **not tested on a device**): tap-to-resync / Restart no longer undone by words the recognizer still
holds; the tapped word counts as unread; Hebrew niqqud / decomposed accents tokenized as one word (vocalized scripts were
never followed); Android busy/client/too-many-requests retried with backoff; late errors of a stopped session ignored; no
"lost" flash after a pause. Data: "Delete all my data" also removes export copies, imported-backup copies, scratch files and
leftover take files, and reports failures; deleting a muxed take removes its leftover original; re-importing a backup never
duplicates; restoring over a deleted script keeps the newer text as a version; favoriting no longer counts as an edit;
far-future timestamps rejected on import; deleted scripts purged after 30 days; the editor saves when the screen loses focus.
Search now ignores case, accents and niqqud for every script, and title sort uses the locale collator (done in JS after the SQL filter). Number words (13–19, tens,
hyphenated compounds, "1,000") now match digits in Voice Follow.

## Code review: teleprompter, remote, AI Studio (2026-10-30)
Fixed with tests (unit/screen tests only; none verified on a device): text reflow (rotation, font size, width) keeps the
reading line on the same text instead of the same pixel, which could jump to the end and log a false "end of script";
Timed word count treats Chinese/Japanese characters and Thai/Lao/Khmer/Burmese letters as word equivalents (a CJK script
scrolled its whole length in ~1 s); the remote no longer acts on the record screen while the paywall is on top; a timed
take started with the prompter already moved doesn't teach a speaking rate; Studio applies a draft once on a double tap,
cancels Generate when the screen closes (no paywall over another screen), names a refusal (charged, retry won't help) and
an over-long script, and keeps Run disabled until the script has loaded. Open (low): a script with no line breaks renders
as one text block, so Voice Follow re-measures all of it on every word (not measured on a device).

## Code review: native media module (2026-10-30, code reading only)
Fixed (compile-checked by CI only, not run on a device): iOS caption layers drew at 4x the pixels
(`contentsScale` 2 on a pixel-sized render) — now 1, which also cuts burn-in memory; iOS remote keys
come back after the keyboard hides; remote keys are reference-counted in JS so an old record screen's
late cleanup can't switch them off for a new one; Android rejects an export that would start after
the JS runtime was torn down; a mux output that lands in scratch after the timeout is deleted.
Open, need device checks or a larger change: HDR/10-bit input re-encoded as 8-bit H.264 on both
platforms (camera HDR setting unknown); iOS mux re-encodes video instead of passthrough (slow, quality
loss); iOS burn-in inserts tracks with the file's length, not each track's; very long cues have no
line cap; Android audio extract ignores the AAC start offset (~20–50 ms caption shift) (its per-sample boxing
is fixed: primitive buffer, output checked identical by a simulation of the loop); iOS reports no key repeat; Android may press a focused button on Enter/Space after keyboard use;
iOS stroke is about half as thick as Android's.

## Blockers
- No macOS/Xcode and no Android SDK in this container → native builds run in GitHub Actions instead; device tests need the founder's phones.
- Store/developer accounts, RevenueCat project, Anthropic key: founder-owned.

## Candidate P1 work suggested by research (needs founder prioritization)
- "Take mode": record line by line with auto-advance and stitching.
- Segmented recording for crash safety (VisionCamera persistent recorder evaluation).
- Microphone pre-flight check (Bluetooth / external mic level test).
