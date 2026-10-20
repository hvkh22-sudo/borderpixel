# Development plan

Last updated: 2026-10-20 (session 1).

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

## Next actions (in order)
1. **Build dev clients** (EAS or a Mac/Android workstation) and run the PoC checklist in
   `docs/testing/test-plan.md` §1 on at least one iPhone and one Pixel/Samsung (REC-01..05, VF-01..04).
2. Fix native compile errors in `modules/promptly-media` (never compiled yet).
3. Verify overlay absence in the exported file on both platforms (REC-02) — release blocker.
4. Measure Voice Follow latency/accuracy with the scripted protocol; set thresholds from baseline.
5. Founder decisions: name, prices, AI model, enabling AI spend, analytics provider.
6. Configure RevenueCat + store products; sandbox purchase test matrix (PUR-*).
7. Add device attestation to the AI proxy before free-tier AI goes live.

## Blockers
- No macOS/Xcode and no Android SDK download in this environment → no native builds, no device tests.
- Store/developer accounts, RevenueCat project, Anthropic key: founder-owned.

## Candidate P1 work suggested by research (needs founder prioritization)
- "Take mode": record line by line with auto-advance and stitching.
- Segmented recording for crash safety (VisionCamera persistent recorder evaluation).
- Microphone pre-flight check (Bluetooth / external mic level test).
