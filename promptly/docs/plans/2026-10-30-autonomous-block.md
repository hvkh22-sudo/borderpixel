# Autonomous work block — 2026-10-30 (no founder input needed)

Rules: no spend, `AI_ENABLED` stays false, no store/publishing, no production credentials, no
final name/prices, no destructive git. Every change: typecheck + jest (app and server), commit,
push to `claude/youthful-volta-vdsr0x`. Nothing here is claimed as device-tested.

| # | Block | Done when |
|---|-------|-----------|
| 1 | Export / Take review fixes: captioned copies deleted after save/share and on cancel; saved-to-Photos not reported as failed when only the DB write fails; cancelled share not counted as an export; no progress flash after Cancel; SRT share guarded; take delete errors shown; take file existence memoized; "not found" state; Retake hidden when the script is gone; language names instead of codes | Fixed with screen/unit tests, pushed |
| 2 | CI: latest run green on js / android / android-e2e / ios; fix or document any failure | Green on the newest head |
| 3 | Native code review (Swift/Kotlin: burn-in, mux, audio extract, remote keys) for leaks, threading, cancellation | Findings verified; fixes pushed with CI build green |
| 4 | Performance: render/measure cost of long scripts in the prompter and library (jest profiling); a 10k-word script stays responsive | Numbers recorded in docs; regressions fixed |
| 5 | E2E: Maestro flows for rotation-free paths touched today (Studio not configured state, Delete all, Settings language) | Flows pass in CI |
| 6 | Founder device checklist (Hebrew) updated with every behavior changed today that only a phone can confirm | `docs/testing/founder-checklist-he.md` updated |
| 7 | Store readiness drafts (marked DRAFT, need founder approval): privacy-label inventory from code, permission strings review, screenshot shot list | Drafts in `docs/store/` |

Check-ins: a self-scheduled wake-up about every 60 minutes resumes the next unfinished block.
