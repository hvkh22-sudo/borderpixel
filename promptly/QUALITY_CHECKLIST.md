# Quality checklist

Legend: ✅ verified · 🟡 implemented, not verified on device · ⬜ not started · ❌ failing

## Automated verification (this session, Linux CI-like container)
| Check | Result |
|---|---|
| TypeScript typecheck (app) | ✅ `npm run typecheck` clean |
| Unit tests (app) | ✅ 74 tests / 9 suites (aligner, controller, scroll model, captions, entitlements, recording machine, studio, storage on real SQLite, i18n) |
| JS bundle iOS / Android (`expo export`) | ✅ both bundle (Hermes bytecode) |
| `expo prebuild` (config plugins, permissions) | ✅ generates projects; Info.plist + manifest permissions verified by inspection |
| Server typecheck + tests | ✅ 16 tests (quotas, budget cap, refunds, IP limit, entitlement mapping, validation, prompt wrapping) |
| Worker bundle (`wrangler deploy --dry-run`) | ✅ |
| Native iOS build (Xcode) | ⬜ not possible here |
| Native Android build (Gradle) | ⬜ not possible here (Google Maven blocked) |
| `modules/promptly-media` Swift/Kotlin | ⬜ **never compiled** |
| Lint (`npm run lint`, eslint-config-expo) | ✅ clean |

## Features
| Feature | Status | Notes |
|---|---|---|
| Script library, editor, autosave, undo/redo, search, favorites, duplicate, soft delete | 🟡 | repository layer ✅ tested |
| Teleprompter manual / timed / display settings / mirror / reading line | 🟡 | geometry ✅ tested; 60 fps unmeasured |
| Recording (VisionCamera v5), countdown, timer, flip, interruptions, low storage | 🟡 | state machine ✅ tested |
| Overlay absent from recording | ⬜ | **release blocker until proven per platform** |
| A/V sync (iOS native, Android muxed) | ⬜ | Android mux offset needs clap test |
| Voice Follow | 🟡 | aligner ✅ (15 scenario tests); live recognition untested |
| Captions (transcribe, script correction, edit, styles, SRT) | 🟡 | pipeline ✅ tested; transcription untested |
| Caption burn-in | 🟡 | behind `EXPO_PUBLIC_FLAG_BURN_IN=on`; native code uncompiled |
| AI Script Studio | 🟡 | proxy ✅ tested with mock LLM; no live API call made (no key, approval needed) |
| Paywall / purchases / restore / lifetime | 🟡 | entitlement logic ✅ tested; no store products |
| Recording recovery (orphan files) | 🟡 | |
| Accessibility (labels, roles, adjustable steppers, live regions, reduced motion) | 🟡 | VoiceOver/TalkBack pass not done |
| Localization framework (en) + RTL flag | 🟡 | only English strings |

## Known issues / risks
- iOS audio-session coexistence (camera audio + recognizer) unproven — fallback designed (DECISIONS D4).
- Android ≤ 12: Voice Follow hidden only if recognizer reports unavailable; explicit API-level gate TODO.
- Android media library permission flow with READ_MEDIA_* blocked must be verified on API 33+.
- Front camera mirroring of the saved file uses VisionCamera `mirrorMode: auto` default — verify
  creators get the expected (non-mirrored/mirrored) output.
- Free-tier AI abuse: needs App Attest / Play Integrity before production.

## Store readiness
⬜ name · ⬜ icon/brand assets (template icons in use) · 🟡 listing drafts · 🟡 privacy policy draft ·
⬜ products configured · ⬜ privacy labels/data safety form · ⬜ support channel.
