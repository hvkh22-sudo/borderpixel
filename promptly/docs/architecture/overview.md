# Architecture overview

```
src/app (Expo Router screens)
   │ uses
   ▼
src/features ── pure, unit-tested domain logic
   voice-follow/  text.ts, aligner.ts, voiceFollowController.ts, useVoiceFollow.ts (React binding)
   teleprompter/  scrollModel.ts (geometry), Teleprompter.tsx (Reanimated renderer)
   recording/     recordingMachine.ts (state machine), finalizeTake.ts
   captions/      captions.ts (segment, correct, edit, SRT), captionStyles.ts, CaptionPreview.tsx
   ai-script-studio/ studio.ts (validation, version history, diff)
   monetization/  entitlements.ts (access derivation, gates, paywall plan)
src/services ── platform adapters
   speechEngine.ts (expo-speech-recognition) · transcription.ts · purchases.ts (RevenueCat)
   ai.ts (proxy client) · files.ts (expo-file-system) · db.ts (expo-sqlite) · nativeMedia.ts
   analytics.ts (typed allow-list) · config.ts (env + feature flags)
src/storage ── migrations + repositories over SqlExecutor (tested with node:sqlite)
src/state ── zustand stores: settings (persisted), access
modules/promptly-media ── local Expo module: Swift (AVFoundation) + Kotlin (Media3)
server/ ── Cloudflare Worker AI proxy (Anthropic SDK, Durable Object counters)
```

## Data flow: a take with Voice Follow
1. `record/[id]` creates a VisionCamera `Recorder` (audio on iOS, off on Android+VF).
2. After `RECORDING_STARTED`, `useVoiceFollow.start` starts the recognizer (Android: `persist: true`).
3. Recognizer partials → `VoiceFollowController.handleResult` → `ScriptAligner.update` → snapshot
   (`charOffset`) → `Teleprompter` animates to the line on the UI thread.
4. Stop → recorder file → `finalizeTake`: copy into documents, (Android) mux WAV segments, DB row.

## Threading / performance
- Scroll position is a Reanimated shared value; timed mode uses `useFrameCallback`; Voice Follow uses
  `withTiming`. React re-renders only on discrete changes (highlight offset), throttled by the
  controller's snapshot de-duplication.
- Alignment cost is bounded by window size (≈ 8 × 120 cells per update).

## Feature flags (`src/services/config.ts`)
`voiceFollow`, `captions`, `burnIn` (off by default until native module verified), `aiStudio`.

## Security
No secrets in the app (only public RevenueCat SDK keys). AI provider key + RevenueCat secret only on
the Worker. Scripts are sent only on explicit AI actions; logs contain no content.
