# Quality checklist

Legend: ✅ verified · 🟡 implemented, not verified on device · ⬜ not started · ❌ failing

## Automated verification (this session, Linux CI-like container)
| Check | Result |
|---|---|
| TypeScript typecheck (app) | ✅ `npm run typecheck` clean |
| Unit tests (app) | ✅ see `npx jest` (merged: aligner, controller, scroll model, speaking rate, recording presets, captions, entitlements, recording machine, studio, storage + folders + backup merge on real SQLite, i18n en/he parity, platform support) |
| Screen render tests (Node, mocked native modules, real SQLite) | ✅ Home, Library, Editor (autosave, duration from learned pace), Prepare (Teleprompter, Voice Follow trial, presets → Custom, “Use my pace”), Paywall, Settings, Studio (history restore), Takes, Subscription, Captions (generate → script correction → edit → save; no-speech; Pro style gate; word highlight toggle + Pro gate + edit drops highlight; long-take “Part n of m” + cancel; gap / stopped-early notices), Folders (create, move, filter + search, rename, delete keeps scripts, editor chip), Scripts export + import |
| JS bundle iOS / Android (`expo export`) | ✅ both bundle (Hermes bytecode) |
| `expo prebuild` (config plugins, permissions) | ✅ generates projects; Info.plist + manifest permissions verified by inspection |
| Server typecheck + tests | ✅ 18 tests (incl. eval metrics) (quotas, budget cap, refunds, IP limit, entitlement mapping, validation, prompt wrapping) |
| Worker bundle (`wrangler deploy --dry-run`) | ✅ |
| Native iOS build (Xcode) | ⬜ not possible here |
| Native Android build (Gradle) | ⬜ not possible here (Google Maven blocked) |
| `modules/promptly-media` Swift/Kotlin | ⬜ **never compiled** |
| Lint (`npm run lint`, eslint-config-expo) | ✅ clean |

## Features
| Feature | Status | Notes |
|---|---|---|
| Script library, editor, autosave, undo/redo, search, favorites, duplicate, soft delete | 🟡 | repository layer ✅ tested |
| Script folders (one optional folder per script; chip row All · Favorites · folders · New folder; move from script menu and editor chip; rename/delete via long-press; delete moves scripts to No folder) | 🟡 | migration 3 + repository ✅ tested on real SQLite (incl. upgrade from a pre-folder DB); screen flows ✅ tested in Node; bottom sheet, keyboard and long-press not checked on a device; VoiceOver/TalkBack long-press action untested |
| Export my scripts (Settings › Privacy & data → one versioned JSON: scripts + versions + folders, via share sheet) | 🟡 | serialize/parse/merge ✅ tested (format version check, malformed input rejected, round-trip without loss, re-import adds nothing, never overwrites); share sheet and file hand-off not tried on a device |
| Import scripts from a backup file | ⬜ | merge logic implemented and tested (`importBackup` in `src/storage/backup.ts`), **no UI**: `expo-document-picker` is not installed (installing needs approval/network); add a picker + Settings row when it is |
| Teleprompter manual / timed / display settings / mirror / reading line | 🟡 | geometry ✅ tested; 60 fps unmeasured |
| Recording (VisionCamera v5), countdown, timer, flip, interruptions, low storage | 🟡 | state machine ✅ tested; lifecycle races (stop while starting, double finish, recorder error salvage, stop watchdog, VF failure/timeout, unmount) ✅ unit-tested in `recordingSession.test.ts` — see docs/architecture/recording-reliability.md. Interruptions/background/size limit **not tested on a device** |
| Learned speaking rate (P1) | 🟡 | `speakingRate.ts` ✅ unit-tested (weighted median, clamp 80–240, ≥ 10 s, manual jumps excluded); learns from Voice Follow cursor progress and Timed takes that reached the end untouched; used for editor/home/library estimates and “Your pace” in setup. Live measurement accuracy not checked on a device (VF-05) |
| Recording presets + landscape (P1) | 🟡 | `presets.ts` ✅ unit-tested; setup screen ✅ screen-tested. Landscape camera layout, interface-driven output orientation, landscape target size and 60 fps fallback **not tested on a device** (REC-07, REC-10..12) |
| Mic check on setup screen (P1 mic pre-flight) | 🟡 | `micCheck.ts` verdicts ✅ unit-tested; sheet ✅ screen-tested with expo-audio mocked (verdicts, input name, Bluetooth note, permission denied, stop → delete clip → release session before camera). Thresholds are initial estimates; real meter levels, input names and camera audio after the check **not tested on a device** (MIC-01) |
| Overlay absent from recording | ⬜ | **release blocker until proven per platform** |
| A/V sync (iOS native, Android muxed) | ⬜ | Android mux offset needs clap test |
| Voice Follow | 🟡 | aligner ✅ (15 scenario tests); live recognition untested |
| Captions (transcribe, script correction, edit, styles, SRT) | 🟡 | pipeline ✅ tested; transcription untested on a device |
| Long-take captions (≤ ~10 min) | 🟡 | Android: WAV cut in JS into 50 s parts (1 s overlap) via expo-file-system FileHandle, recognized sequentially, merged/de-duplicated (`longTake.ts` ✅ unit-tested; service flow ✅ tested with a fake recognizer + in-memory files). A failed part is reported as a gap, never filled. iOS: single request; takes > 60 s whose last word ends > 3 s before the end show a “captions stop at …” notice (heuristic; trailing silence also triggers it). **No real long take recognized on any device**; Android recognizer restart between parts and FileHandle reads on a 20 MB WAV unverified (CAP-05/06) |
| Word-by-word highlight (Pro) | 🟡 | per-cue word timing kept only with engine word timing, preserved through split/merge/shift, dropped on text edit; preview ✅ screen-tested. Burn-in: Swift (per-word CATextLayer overlays with discrete opacity) and Kotlin (bitmap per cue+active word, span on fill pass only) **written, never compiled or run** (CAP-07) |
| Caption styles: Clean, Soft Box (free), Creator Bold, Pop, High Contrast (Pro) | 🟡 | registry ✅ tested; burn-in parity with preview not checked on a device |
| Caption burn-in | 🟡 | behind `EXPO_PUBLIC_FLAG_BURN_IN=on`; native code uncompiled |
| AI Script Studio | 🟡 | proxy ✅ tested with mock LLM; no live API call made (no key, approval needed) |
| Paywall / purchases / restore / lifetime | 🟡 | entitlement logic ✅ tested; no store products |
| Recording recovery (orphan files) | 🟡 | duration restored via native module when available; Home shows a recovered-takes notice. Recorder now writes into documents, so a take survives an app kill; single-flight dedupe ✅ unit-tested. Partial-file playability **not tested on a device** |
| Accessibility (labels, roles, adjustable steppers, live regions, reduced motion) | 🟡 | VoiceOver/TalkBack pass not done |
| Localization framework (en) + RTL flag | 🟡 | English + Hebrew (folder and export strings included); Hebrew pending native-speaker review on device |

## Known issues / risks
- iOS audio-session coexistence (camera audio + recognizer) unproven — fallback designed (DECISIONS D4).
- Android < 13: Voice Follow and captions are hidden by an explicit API-level gate (`src/features/platform/support.ts`), with the reason shown to the user.
- Android media library permission flow with READ_MEDIA_* blocked must be verified on API 33+.
- Front camera mirroring of the saved file uses VisionCamera `mirrorMode: auto` default — verify
  creators get the expected (non-mirrored/mirrored) output.
- Free-tier AI abuse: App Attest / Play Integrity verification implemented server + client, unit-tested (Apple's published attestation example, fake ES256 assertions, Play verdict fixtures) and run in local workerd; **not tested on devices or against the live Google API**. `INTEGRITY_MODE=report` (log only) until verified; switch to `enforce` before free-tier AI goes live.

## Store readiness
⬜ name · 🟡 original icon generated (`scripts/generate-icons.py`), not reviewed on a home screen · 🟡 listing drafts · 🟡 privacy policy draft ·
⬜ products configured · ⬜ privacy labels/data safety form · ⬜ support channel.
