# Promptly

AI teleprompter for creators: write a script, read it naturally over the camera (manual, timed or
voice-following scroll), add on-device captions, export. iOS + Android, Expo SDK 58.

## Requirements
- Node 22+, npm 10+
- iOS builds: macOS with Xcode 26.4+ (Expo SDK 58 minimum), or EAS Build
- Android builds: Android Studio / SDK (API 36), JDK 17, or EAS Build
- A physical device for camera, microphone and speech features (simulators lack them)

## Setup
```bash
npm install            # .npmrc sets legacy-peer-deps (Expo SDK 58 peer ranges)
cp .env.example .env   # fill in public keys as needed; all optional for local dev
```

## Development
This app uses native modules (VisionCamera, speech recognition, RevenueCat, promptly-media), so it
needs a **development build** — Expo Go will not work.
```bash
npx expo prebuild          # generates ios/ and android/ (git-ignored)
npx expo run:ios --device  # or: npx expo run:android --device
npx expo start --dev-client
```
Cloud builds: `npx eas-cli@latest build --profile development --platform ios|android`
(requires an Expo account and, for iOS devices, an Apple Developer account).

## Checks
```bash
npm run typecheck
npm test                                   # unit tests (jest-expo)
npx expo export --platform ios             # verifies the JS bundle builds
cd server && npm install && npm run typecheck && npm test
```

## AI proxy (server/)
Cloudflare Worker that calls Claude via the official SDK, enforces quotas and a daily budget.
```bash
cd server
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put REVENUECAT_SECRET_KEY
npx wrangler deploy          # billable — founder approval required
```
`AI_ENABLED` defaults to `"false"` in `wrangler.toml` (kill switch).

## Purchases
Create products in App Store Connect / Play Console (`promptly_pro_monthly`, `promptly_pro_annual`,
`promptly_lifetime`, `promptly_ai_credits_100`), attach them to a RevenueCat entitlement `pro` and an
offering with monthly/annual/lifetime packages, then set `EXPO_PUBLIC_RC_IOS_KEY` /
`EXPO_PUBLIC_RC_ANDROID_KEY`. Test with sandbox accounts in a development build.

## Troubleshooting
- `npx expo install` fails with "HTTP Proxy Network Error" in restricted networks: install the
  version listed in `node_modules/expo/bundledNativeModules.json` with npm directly.
- Voice Follow shows "not available": the device has no speech recognizer for the selected
  language. Change Settings › Speech language or use Timed mode.

## Release preparation
See `docs/launch/` and `QUALITY_CHECKLIST.md`. Store submission requires founder approval.

## Docs map
`docs/research` market · `docs/product` PRD · `docs/architecture` technical design ·
`docs/design` design system · `docs/testing` test plan + device matrix · `docs/business` pricing and
costs · `docs/launch` store and policy drafts.
