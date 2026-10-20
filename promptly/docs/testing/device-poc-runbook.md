# Device PoC runbook (first build on a real phone)

Goal: run test-plan §1 (REC-01..05, VF-01..04, CAP-01) on one iPhone and one Android 13+ phone.

## 1. Accounts (founder)
- Expo account (free) — `npx eas-cli@latest login`
- iOS: Apple Developer Program membership ($99/yr — approval) for installing on a device
- Android: none needed for an internal APK

## 2. Build a development client (cloud, no Mac required)
```bash
cd promptly
npx eas-cli@latest init                    # links the project, writes the EAS projectId
npx eas-cli@latest device:create           # iOS only: register the test iPhone (opens a link on the phone)
npx eas-cli@latest build --profile development --platform android
npx eas-cli@latest build --profile development --platform ios
```
Install from the links EAS prints. The `development` profile turns caption burn-in on
(`EXPO_PUBLIC_FLAG_BURN_IN=on`) so the native module is exercised.

Expected first-build risk: `modules/promptly-media` has never been compiled. If the build fails in
that module, send the build log; the rest of the app does not depend on it at compile time except
through autolinking (temporarily removing `modules/promptly-media` unblocks the rest).

## 3. Run the app
```bash
npx expo start --dev-client     # phone and computer on the same network, or use --tunnel
```

## 4. Test order (stop at the first failure and report)
1. REC-01 record 60 s (Timed mode) → play in Takes.
2. REC-02 export to Photos → scrub the file: **no script text visible**.
3. REC-03 clap test: clap on camera at start and end; check sync in the exported file.
4. VF-01/02 Voice Follow take: script follows; resulting file has full audio.
5. VF-04 pause / repeat / skip a paragraph / tap a line.
6. CAP-01 Add captions → Generate → Save → Export with burn-in + SRT.
7. REC-04 background the app mid-take → take still saved.

Record results in `device-matrix.md` (device, OS, pass/fail, notes, screen recording link).
