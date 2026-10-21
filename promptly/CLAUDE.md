# Promptly — project context for Claude Code

Promptly (working name, **not final**) is an AI teleprompter + video app for short-form creators
(TikTok / Reels / Shorts / YouTube), iOS + Android, Expo SDK 58 / React Native 0.88. Read
`DEVELOPMENT_PLAN.md` for current state and `QUALITY_CHECKLIST.md` for what is verified.
Also follow `AGENTS.md` (Expo conventions).

## Fixed founder decisions (do not re-ask)
1. Audience: creators speaking to their phone camera (secondary: educators, coaches, marketers).
2. Three AI capabilities are strategic: Voice Follow, automatic captions, AI Script Studio.
3. Business model: free tier + monthly + annual + lifetime. No unlimited cloud AI for lifetime.
4. iOS and Android from the start; each tested on its own.
5. Focused, polished v1 — not a video editor.

## Architecture (see docs/architecture/overview.md)
- `src/app/` Expo Router screens only. Logic lives in `src/features/*` (pure, unit-tested) and
  `src/services/*` (platform wrappers). Storage: `src/storage` (SQLite via `SqlExecutor`).
- Camera: react-native-vision-camera v5. Speech: expo-speech-recognition. Purchases: RevenueCat.
- Native media (burn-in, Android audio extract + mux): local module `modules/promptly-media`.
- AI: `server/` Cloudflare Worker proxy (Anthropic SDK). No provider key in the app, ever.
- Android Voice Follow: camera records video only, recognizer owns the mic and persists audio,
  `finalizeTake` muxes. iOS: camera records audio, recognizer shares the audio session (`shared`,
  default); `separate` (EXPO_PUBLIC_IOS_VF_AUDIO or Diagnostics override) = the Android path (D4).

## Rules
- Run before committing: `npm run typecheck && npm test` (root) and `cd server && npm run typecheck && npm test`.
  Also `npx expo export --platform ios` / `android` to verify bundling when touching imports.
- Never claim device behavior that was not tested on a device. Update QUALITY_CHECKLIST.md honestly.
- All visible strings via `t()` (`src/localization/en.ts`). No hardcoded UI text.
- Analytics events carry no script text, transcripts, audio, video or personal data.
- Never delete user recordings automatically; recordings live in documents dir, exports in cache.
- Keep the overlay out of the recording: never use view-capture/screen-recording to produce video.
- Do not edit `ios/` or `android/` (generated). Configure through `app.json` / config plugins.
- Install deps with versions from `node_modules/expo/bundledNativeModules.json` (api.expo.dev is
  blocked in the cloud environment, so `npx expo install` fails there). `.npmrc` sets legacy-peer-deps.

## Approval boundaries (stop and ask the founder)
Paid infrastructure or API spend (including setting `AI_ENABLED=true`), final name, final prices,
sending private content to a new processor, material scope changes, publishing/store submission,
production credentials, legal representations, destructive git operations.

## Communication
Talk to the founder **only in Hebrew** (explicit request); code, comments and docs in English. Separate Implemented / Tested /
Not tested / Blocked / Planned in every report.
