# Overnight plan — 2026-11-21 (no founder input; up to ~20 h)

Rules: no spend, `AI_ENABLED` stays false, no store submission, no production credentials, no
final name/prices, no destructive git. Every change: typecheck + lint + jest (app and server), commit,
push to `claude/youthful-volta-vdsr0x`, CI must stay green. Nothing is claimed as device-tested.
Native changes stay small: the first device test has not happened yet, so stability beats features.

| # | Block | Why | Done when |
|---|-------|-----|-----------|
| A | TestFlight pipeline: bundle id from config, `eas.json` submit via App Store Connect API key, a manual GitHub workflow that builds and uploads with repo secrets | The founder's next step is TestFlight; make it one click once secrets exist | Workflow + Hebrew guide pushed; dry-run checks pass without secrets |
| B | iOS privacy manifest (`expo.ios.privacyManifests`) | Uploads without required-reason declarations are rejected by Apple | Manifest in app.json, prebuild in CI shows it in PrivacyInfo.xcprivacy |
| C | Fresh Android APK in CI (the last one expired) | Android testing can start any day | New `promptly-android-test-apk` artifact on the latest green run |
| D | Recovered Voice Follow take: store segment offsets, re-merge audio on recovery | A force-closed take is currently silent (audio kept, not merged) | JS + tests; uses the existing mux |
| E | AI quota protection: per-install token issued after a verified request (server + client) | Security review finding #1 (spoofed user IDs) | Server + client + tests; AI stays disabled |
| F | More E2E flows (prepare/mic-check sheet, takes list, help) and an accessibility pass on the record screen | Catch regressions before the founder sees them | Flows green in CI |
| G | Morning report (Hebrew) + docs refresh | Founder starts the day with exact next steps | Report written |

## Result (2026-11-22)
- A done: `promptly-testflight` workflow + `scripts/testflightConfig.js` (tests) + Hebrew guide. Not run yet:
  needs the five repository secrets and the bundle id.
- B already done earlier (manifest in app.json); verified by an iOS prebuild.
- C done: run 88 built a new Android test APK (expires 2026-11-28).
- D done: segment timing kept next to the take; "Restore sound" on the take screen (on request).
- E done: `PAID_REQUIRES_INTEGRITY` switch (off by default) + app signs the balance only when asked.
- F not done: the hourly check-in that would have continued was delivered ~22 h late, after the window.
- CI: run 88 — every job and step passed; the iOS job was marked cancelled at its 90-min limit after
  finishing (limit raised to 120 min).
