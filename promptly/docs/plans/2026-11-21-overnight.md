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
