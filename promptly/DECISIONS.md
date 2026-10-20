# Decisions log

## Founder decisions (fixed, 2026-10-20)
F1 audience: talking-head creators · F2 AI pillars: Voice Follow, captions, Script Studio ·
F3 free + monthly + annual + lifetime · F4 iOS + Android from day one · F5 focused v1.

## Technical decisions

### D1 — React Native + Expo SDK 58 (dev builds) with native modules where needed
- Chosen over fully native (2× code for a solo team) and Flutter (camera/speech plugins for this
  workflow are less mature; RevenueCat/Expo ecosystem fits better).
- Constraint accepted: New Architecture mandatory; no Expo Go.
- Evidence: docs/architecture/technical-feasibility.md §1.

### D2 — Camera: react-native-vision-camera 5.2.3 (not expo-camera)
- Needs control over audio enable/disable per take (Android Voice Follow), resolution targets, fps
  constraints, interruption callbacks. Do not install expo-camera alongside (CameraX version clash risk).
- Risk: v5 Android uses a CameraX alpha. Mitigation: device matrix before beta.

### D3 — Overlay separation by architecture
- The prompter is a normal RN view above the preview; recording comes from the capture pipeline
  (AVCaptureMovieFileOutput / CameraX Recorder). No screen capture anywhere. Needs device proof (REC-02).

### D4 — Microphone ownership for Voice Follow
- iOS: VisionCamera records audio; recognizer runs on the shared AVAudioSession
  (playAndRecord + mixWithOthers + videoRecording mode). Fallback if PoC fails: Swift module that feeds
  the capture session's sample buffers to SFSpeechAudioBufferRecognitionRequest / SpeechAnalyzer.
- Android 13+: VisionCamera `enableAudio:false`; expo-speech-recognition owns the mic
  (`continuous`, `recordingOptions.persist`); WAV segments muxed into the video with Media3.
  Avoids Android's concurrent-capture silencing. Android ≤12: Voice Follow unavailable (Timed/Manual).
- Rejected: a second independent mic capture next to the camera recorder (destabilizes recording).

### D5 — Alignment algorithm: local fuzzy alignment over a sliding window
- Smith–Waterman on the last 8 spoken words vs. ~120 script words around the cursor, fuzzy word match
  (edit distance). Large jumps/back moves require confirmation on two consecutive updates.
- Rejected: plain "find last word" matching (erratic on repeated words), ML models (unnecessary).
- Measured in CI: ~2 ms per update on a 4,600-word script (Node, CI hardware; device TBD).

### D6 — Captions: on-device transcription + script-aware correction
- iOS reads the movie file directly; Android decodes audio to WAV (promptly-media) first.
- Recognized words are aligned to the script (Needleman–Wunsch) to fix spelling; ad-libs are kept.
- Export: SRT + burn-in via AVFoundation / Media3 (FFmpegKit retired; avoids GPL/LGPL concerns).

### D7 — Local-first storage
- SQLite (expo-sqlite) for scripts, versions, recording metadata, settings; video files in the
  documents directory. No account, no cloud sync in v1.

### D8 — AI proxy: Cloudflare Worker + Durable Objects, official Anthropic TypeScript SDK
- Smallest backend that gives atomic per-user counters, a global spend cap and secret isolation.
- Identity: RevenueCat anonymous app user ID; entitlement fetched server-side (secret key).
- Known gap: IDs can be minted freely → per-IP limit + daily budget now; App Attest / Play Integrity
  required before enabling free-tier AI in production.
- Model: `claude-opus-5-5` configured as default; **model choice is a founder cost decision**
  (see docs/business/ai-unit-economics.md — Haiku 5.5 is ~40× cheaper; quality eval pending).

### D9 — Monetization via RevenueCat
- One entitlement `pro`; lifetime is a non-consumable; credit packs consumable. Access is always derived
  from CustomerInfo (SDK caches it for offline). Paywall hides overlapping purchases.

### D10 — Removed nested git repo created by create-expo-app; app lives in `promptly/` of the
existing repository (which also hosts an unrelated BorderPixel static site, left untouched).

## Business decisions pending founder approval
- Final name (conflict: an App Store app "Promptly Pro Teleprompter" exists — see research).
- Prices ($6.99 / $34.99 / $59.99 proposed) and trial.
- AI model and allowances; enabling billable AI.
- Analytics provider (none wired; events go to a no-op sink in release).
