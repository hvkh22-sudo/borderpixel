# Development plan

Last updated: 2026-10-21 (night session, continued).

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

## Next actions (in order)
1. **Android now:** sideload the CI test APK (`docs/testing/founder-checklist-he.md` §0) and run the
   founder checklist (REC-01..05, VF-01..04). **iOS:** needs a signed build (EAS + `EXPO_TOKEN`, or TestFlight).
2. ✅ Native code compiles on both platforms in CI (2026-10-21); emulator Maestro run added (`android-e2e`).
3. Verify overlay absence in the exported file on both platforms (REC-02) — release blocker.
4. Measure Voice Follow latency/accuracy with the scripted protocol; set thresholds from baseline.
5. **Founder decision (2026-10-20): API key and model eval are deferred to the END** — continue all
   work without a key; connect the key and run `server/eval` (approved, ≤ $1.46) as a final step. Other founder decisions: name, prices, AI model, enabling AI spend, analytics provider.
6. Configure RevenueCat + store products; sandbox purchase test matrix (PUR-*).
7. Add device attestation to the AI proxy before free-tier AI goes live.

## Blockers
- No macOS/Xcode and no Android SDK in this container → native builds run in GitHub Actions instead; device tests need the founder's phones.
- Store/developer accounts, RevenueCat project, Anthropic key: founder-owned.

## Candidate P1 work suggested by research (needs founder prioritization)
- "Take mode": record line by line with auto-advance and stitching.
- Segmented recording for crash safety (VisionCamera persistent recorder evaluation).
- Microphone pre-flight check (Bluetooth / external mic level test).
