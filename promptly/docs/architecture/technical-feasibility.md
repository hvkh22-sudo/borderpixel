# Promptly — Technical Feasibility (React Native / Expo, iOS + Android)

Research date: **2026-10-20**. Covers an AI teleprompter: scroll a script while recording front-camera video, follow the speaker's voice with live speech recognition, add captions to the recording, and generate scripts with an LLM.

## How to read this document

| Label | Meaning |
| --- | --- |
| **VERIFIED** | Read directly from a primary source during this research: the npm registry (`npm view`, `npm pack` tarball contents and source code), official docs fetched from developer.apple.com / developer.android.com / platform.claude.com, or the expo/expo GitHub repo through raw.githubusercontent.com. |
| **VERIFIED (index)** | The claim comes from an official vendor page (expo.dev, revenuecat.com, openai.com, deepgram.com, assemblyai.com, cloudflare.com, supabase.com, ai.google.dev), but that page was blocked from direct fetch here (egress proxy 403 / DNS failure). The content was read through the search engine's index of the page. Re-check before committing money. |
| **UNVERIFIED** | Third-party source, or an engineering inference that needs a device spike. |

Note on access: in this environment expo.dev, docs.expo.dev, revenuecat.com, openai.com, deepgram.com, assemblyai.com, ai.google.dev, developers.cloudflare.com, supabase.com, docs.swmansion.com and visioncamera.margelo.com were not reachable. The GitHub API was also blocked for third-party repos. Expo docs were read from the expo/expo repo (`docs/pages/versions/v58.0.0/...`), and library behaviour was read from the published npm tarballs (source code).

---

## 0. Executive summary

- **Expo SDK 58 is a sound base.** It ships React Native 0.88.0 and React 19.3.0, runs only on the New Architecture, and supports iOS 16.4+ and Android 7+ (API 24). It needs Xcode 26.4 or later. Everything Promptly needs runs in an **Expo dev build** (not Expo Go).
- **Recording and recognizing speech at the same time works, but only if one component owns the microphone.**
  - **iOS:** the cheapest path is to let the camera record its own audio track while `expo-speech-recognition` taps the mic through `AVAudioEngine`, with one shared `AVAudioSession` configuration. This needs a device spike. The robust fallback is a small custom Swift Expo module that feeds the camera's own audio buffers to `SFSpeechAudioBufferRecognitionRequest` (iOS 16.4–25) or `SpeechAnalyzer`/`SpeechTranscriber` (iOS 26+).
  - **Android:** never let the system `SpeechRecognizer` open the mic while CameraX records. Instead, the app owns the mic (`AudioRecord`) and feeds the recognizer through `EXTRA_AUDIO_SOURCE` (API 33+). `expo-speech-recognition` already does this when `continuous` or `recordingOptions.persist` is set. On Android 13+, record the camera **without audio** and mux the app-owned audio afterwards. On API ≤ 32 there is no live voice-follow during recording: fall back to manual or timer scroll, or to an on-device engine (sherpa-onnx) fed from our own `AudioRecord`.
- **Captions:** transcribe on-device after recording, with word timings.
  - iOS: `SFSpeechRecognizer` segments (iOS 16.4+), or `SpeechTranscriber` with `audioTimeRange` (iOS 26+).
  - Android 14+: on-device recognizer with `EXTRA_REQUEST_WORD_TIMING`.
  - Cloud fallback: Deepgram, AssemblyAI or OpenAI `whisper-1`.
- **Burning captions into the video:** FFmpegKit is officially retired. Build a small native Expo module ("PromptlyExport") on AVFoundation (`AVMutableComposition` + `AVVideoCompositionCoreAnimationTool`) and Media3 Transformer (`TextOverlay` / `BitmapOverlay`). The same export pass also muxes in separately recorded audio.
- **LLM:** Claude Haiku 5.5 (`claude-haiku-5-5`) costs $0.10 / $0.50 per MTok for prompts up to 100k tokens, which makes AI script generation almost free per request. Put it behind a Cloudflare Worker proxy secured by App Attest / Play Integrity (`@expo/app-integrity`) plus RevenueCat entitlement checks.

---

## 1. Expo SDK 58

| Claim | Status | Source |
| --- | --- | --- |
| `expo` latest = **58.0.16** (published 2026-10-19). SDK 58.0.0 was published 2026-09-29; SDK 57.0.0 on 2026-06-30. | VERIFIED | `npm view expo version time` |
| SDK 58 bundles **react-native 0.88.0** and **react 19.3.0** (58.0.0 shipped with `0.88.0-rc.3`; RN 0.88.0 final was published 2026-10-15, and later patches bumped it). | VERIFIED | `expo@58.0.16/bundledNativeModules.json` (npm tarball); `npm view react-native time` |
| SDK 58 platform matrix: Android min 7 (API 24), compileSdk 37, targetSdk 36, build-tools 37.0.0; iOS min **16.4**; Xcode **>= 26.4.0**; Node >= 22.13.0. | VERIFIED | https://raw.githubusercontent.com/expo/expo/main/packages/@expo/sdk-compatibility/src/sdk-compatibility.json |
| The New Architecture is always on from SDK 55 onward and cannot be disabled. Expo Go supports only the New Architecture. | VERIFIED | https://raw.githubusercontent.com/expo/expo/main/docs/pages/guides/new-architecture.mdx |
| The SDK 58 beta post says SDK 58 targets iOS 27 and switches to the scene-based app lifecycle, which matters for any custom `AppDelegate` code. | VERIFIED (index) | https://expo.dev/changelog/sdk-58-beta |
| **Dev builds required.** VisionCamera, expo-speech-recognition, RevenueCat (real purchases), whisper.rn and any custom native module need a dev build (`expo-dev-client ~58.0.14`). In Expo Go, RevenueCat runs in "Preview API Mode" with JS mocks. | VERIFIED | react-native-purchases@10.15.0 README (tarball) |
| **Config plugins.** `expo-camera`, `expo-speech-recognition` (`app.plugin.js`) and `expo-sqlite` ship config plugins. **VisionCamera 5.2.3 ships no Expo config plugin**: add the camera and mic usage strings and Android permissions manually in `app.json` (`ios.infoPlist`, `android.permissions`). | VERIFIED | tarball contents of each package |
| `expo-router` **~58.0.24** | VERIFIED | bundledNativeModules.json |
| `expo-sqlite` **~58.0.13**. 58.0.0 **removed libSQL support** (`syncLibSQL`, `libSQLOptions`; the `useLibSQL` plugin option no longer has any effect). | VERIFIED | expo-sqlite CHANGELOG (tarball) |
| `expo-file-system` **~58.0.10**. The default export is the object API (`File`, `Directory`, `Paths`, `File.preview()` added in 58.0.7). Old functions (`readAsStringAsync`, …) **throw at runtime** unless imported from `expo-file-system/legacy`. | VERIFIED | `build/legacyWarnings.d.ts`, CHANGELOG (tarball) |
| `expo-sharing` **~58.0.19**; `expo-video` **~58.0.12**; `expo-media-library` **~58.0.11**. In media-library 58.0.0 (breaking), `Asset.getUri()` on iOS returns the *edited* rendition unless `version: AssetUriVersion.ORIGINAL` is passed. 57.0.3 fixed saving videos larger than 2 GB on Android. | VERIFIED | bundledNativeModules.json; expo-media-library CHANGELOG |
| **expo-camera ~58.0.11** `recordAsync` options: `maxDuration`, `maxFileSize`, `progressUpdateInterval` (new in 58), `codec` (iOS only: `avc1`/`hvc1`/`jpeg`/`apcn`/`ap4h`). View props: `videoQuality` (`2160p`/`1080p`/`720p`/`480p`/`4:3`), `videoBitrate` (on iOS it needs `codec` set), `mute`, `mirror`, `mode="video"`. Audio is recorded through `AVCaptureMovieFileOutput` with a mic input on the **same** `AVCaptureSession` (iOS), and through CameraX `withAudioEnabled()` (Android). Apps never get audio buffers. Android uses CameraX **1.6.0**. | VERIFIED | `build/Camera.types.d.ts`, `ios/Current/CameraSessionManager.swift`, `android/build.gradle` (tarball) |
| Whether expo-camera audio stays reliable while another component uses the mic: no doc found. iOS lets one app run `AVCaptureSession` with audio alongside `AVAudioEngine` input on the same `AVAudioSession`, but a later category or mode change can interrupt capture. | UNVERIFIED (needs device spike) | inference from Apple `automaticallyConfiguresApplicationAudioSession` doc: https://developer.apple.com/documentation/avfoundation/avcapturesession/automaticallyconfiguresapplicationaudiosession |

## 2. react-native-vision-camera v5

| Claim | Status | Source |
| --- | --- | --- |
| Latest **5.2.3** (2026-08-20), MIT. v5.0.x shipped in April–May 2026. The v4 line is archived and no longer maintained. | VERIFIED | `npm view react-native-vision-camera`; repo README https://raw.githubusercontent.com/mrousavy/react-native-vision-camera/main/README.md |
| **Built on Nitro Modules.** Peer dependencies: `react-native-nitro-modules` and `react-native-nitro-image` (current: 0.37.1 and 0.15.2). All specs are `*.nitro.ts` HybridObjects in Swift and Kotlin. | VERIFIED | package.json, `src/specs/**` (tarball) |
| **Project issue:** `promptly/.npmrc` sets `legacy-peer-deps=true`, and `react-native-nitro-modules` / `react-native-nitro-image` are **not installed** in `node_modules`. The native build will fail until both are added. | VERIFIED | local `node_modules` check |
| Video API: `useVideoOutput({ targetResolution, enableAudio (default false), enablePersistentRecorder, targetBitRate, fileType: 'mp4'|'mov' (iOS), enableHigherResolutionCodecs (Android) })` → `createRecorder({ filePath, maxDuration, maxFileSize, location })` → `Recorder.startRecording/pause/resume/stop`. `setOutputSettings({ codec })` and `getSupportedVideoCodecs()` are iOS only. | VERIFIED | `src/specs/outputs/CameraVideoOutput.nitro.ts`, `Recorder.nitro.ts` |
| iOS recording uses `AVCaptureMovieFileOutput` by default. With `enablePersistentRecorder` it uses `AVCaptureVideoDataOutput` + `AVAssetWriter`. Audio for that path comes from a **separate internal `AVCaptureSession`** with an `AVCaptureAudioDataOutput` (`ios/Hybrid Objects/Audio/AudioSession.swift`). | VERIFIED | tarball source |
| **Mic audio buffers are NOT exposed to JS.** Frame outputs (`useFrameOutput`, worklets via `react-native-vision-camera-worklets` 5.2.3 + `react-native-worklets`) carry video frames only. Natively, the public Swift protocols `NativeCameraOutput` (with `requiresAudioInput`) and `RecorderDelegate` look like extension points for a custom audio-tap output, but they are not documented as a plugin API. | VERIFIED (no JS audio API); UNVERIFIED (native extension path) | `ios/Public/NativeCameraOutput.swift`, `ios/Public/RecorderDelegate.swift` |
| Audio session: VisionCamera does not set an `AVAudioSession` category itself (it leaves `AVCaptureSession.automaticallyConfiguresApplicationAudioSession` at its default, `true`). It exposes `allowHapticsAndSystemSoundsPlayback` and (iOS 18+) `allowBackgroundAudioPlayback` → `configuresApplicationAudioSessionToMixWithOthers`. Interruption reason `audio-device-in-use-by-another-client` is surfaced. | VERIFIED | `HybridCameraSession.swift`, `CameraSessionConfiguration.ts`, `CameraSession.nitro.ts` |
| Android uses **CameraX 1.7.0-alpha03** (stable CameraX is 1.6.2). Recording uses `Recorder` + `PendingRecording.withAudioEnabled()`. Codec and output settings are not configurable on Android. | VERIFIED | `android/build.gradle`, `HybridVideoOutput.kt`; https://developer.android.com/jetpack/androidx/releases/camera |
| Compatibility with RN 0.88: no explicit peer range (`react-native: *`). The last release (2026-08-20) predates RN 0.88.0 (2026-10-15). | UNVERIFIED (build-test in spike) | npm metadata |
| Known audio-session conflicts with speech libraries: no specific VisionCamera v5 issue found. Generic iOS reports show camera SDKs overriding the category or mode and causing silent audio or failed `setActive`. | UNVERIFIED | https://developer.apple.com/forums/thread/765509 ; https://community.snap.com/snapar/discussion/6941/ |
| Do **not** install expo-camera and VisionCamera together: CameraX 1.6.0 and 1.7.0-alpha03 would collide in Gradle resolution. | VERIFIED (versions); inference (conflict) | both build.gradle files |

## 3. Simultaneous recording + live speech recognition

### 3.1 iOS facts

| Claim | Status | Source |
| --- | --- | --- |
| `SFSpeechAudioBufferRecognitionRequest.appendAudioSampleBuffer(_:)` accepts `CMSampleBuffer` (from `AVCaptureAudioDataOutput`), iOS 10+. "The audio must be in a native format." | VERIFIED | https://developer.apple.com/documentation/speech/sfspeechaudiobufferrecognitionrequest/appendaudiosamplebuffer(_:) |
| `requiresOnDeviceRecognition` (iOS 13+) only takes effect when `supportsOnDeviceRecognition` is true. | VERIFIED | https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition |
| `SFTranscriptionSegment.timestamp` = seconds from the start of the audio (word level). | VERIFIED | https://developer.apple.com/documentation/speech/sftranscriptionsegment/timestamp |
| `SpeechAnalyzer` + `SpeechTranscriber`: **iOS 26.0+**. On-device models are managed through `AssetInventory` (downloaded and shared system-wide; per-locale reservations). `SpeechTranscriber.isAvailable` / `supportedLocales` must be checked at runtime (the list is empty on unsupported hardware). `DictationTranscriber` is the fallback for older devices. | VERIFIED | https://developer.apple.com/documentation/speech/speechanalyzer ; .../speechtranscriber ; .../assetinventory ; .../dictationtranscriber |
| Input: `AnalyzerInput(buffer:bufferStartTime:)` (iOS 26). The analyzer does **not** convert formats: use `SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith:)` and convert with `AVAudioConverter`. `AnalyzerInputConverter`, `CaptureInputSequenceProvider` and `AssetInputSequenceProvider` are **iOS 27+**. `analyzeSequence(from: AVAudioFile)` is iOS 26. | VERIFIED | https://developer.apple.com/documentation/speech/analyzerinput ; .../analyzerinputconverter ; .../captureinputsequenceprovider |
| Results: `.volatileResults` reporting option gives tentative results; `.audioTimeRange` attribute option adds per-run time ranges to the `AttributedString`. | VERIFIED | https://developer.apple.com/documentation/speech/speechtranscriber/reportingoption/volatileresults ; .../resultattributeoption/audiotimerange |
| Exact SpeechTranscriber locale list and latency figures are not published as a static list; query at runtime. | UNVERIFIED | — |

### 3.2 Android facts

| Claim | Status | Source |
| --- | --- | --- |
| Android 10+ input sharing: when two ordinary apps capture, only one gets audio and the other gets silence. A **privacy-sensitive** source (`CAMCORDER`, `VOICE_COMMUNICATION`) wins. The Google recognizer service is a separate process, so if it opens the mic while CameraX records (CAMCORDER), one side gets silence. | VERIFIED (rules); inference (recognizer = separate client) | https://developer.android.com/media/platform/sharing-audio-input |
| `SpeechRecognizer.createOnDeviceSpeechRecognizer` / `isOnDeviceRecognitionAvailable`: API 31. `checkRecognitionSupport` / `triggerModelDownload` handle model download. | VERIFIED | https://developer.android.com/reference/android/speech/SpeechRecognizer |
| `RecognizerIntent.EXTRA_AUDIO_SOURCE` (ParcelFileDescriptor) + `_CHANNEL_COUNT` / `_ENCODING` / `_SAMPLING_RATE` (default 16 kHz PCM16): **API 33**. If unset or unsupported, "the recognizer will open the mic". `EXTRA_SEGMENTED_SESSION` gives continuous segments. `EXTRA_REQUEST_WORD_TIMING`: **API 34**. | VERIFIED | https://developer.android.com/reference/android/speech/RecognizerIntent |
| Two `AudioRecord`s in the **same** app at once (CameraX audio + our own): behaviour is not documented on that page. | UNVERIFIED (spike) | — |

### 3.3 expo-speech-recognition 58.0.0 (jamsch), MIT, published 2026-10-16, iOS 16.4+

| Feature | Status | Source (tarball README + source) |
| --- | --- | --- |
| Options `continuous`, `interimResults`, `requiresOnDeviceRecognition`, `addsPunctuation`, `contextualStrings`, `iosTaskHint`, `iosVoiceProcessingEnabled`, `androidIntentOptions`, `androidRecognitionServicePackage`, `volumeChangeEventOptions`. | VERIFIED | README "Direct module API" |
| **`iosCategory: { category, categoryOptions, mode }`**. Defaults to `playAndRecord` / `measurement` / `[defaultToSpeaker, allowBluetooth]`. `videoRecording` mode and `mixWithOthers` are available. `setCategoryIOS()` and `getAudioSessionCategoryAndOptionsIOS()` exist. The README warns that it modifies the audio session. | VERIFIED | README; `ios/ExpoSpeechRecognizer.swift` `setupAudioSession`; `src/constants.ts` |
| iOS engine: `SFSpeechRecognizer` + `AVAudioEngine` input tap. It does **not** use SpeechAnalyzer, and it cannot accept external buffers from JS. | VERIFIED | `ios/ExpoSpeechRecognizer.swift` |
| **`audioSource.uri`** file transcription (Android 13+, iOS). iOS reads the file with `AVAudioFile` and streams buffers into `SFSpeechAudioBufferRecognitionRequest` (chunk delay 15 ms on-device / 50 ms network). Verified formats: 16 kHz WAV PCM16, MP3 (and OGG on Android). Video containers are not listed, so **extract audio to WAV first**. | VERIFIED | README "Transcribing audio files"; source |
| **Word timings (`segments[]` with `startTimeMillis`, `endTimeMillis`, `segment`, `confidence`)**: iOS supported. Android only on 14+ with on-device recognition (`com.google.android.as`); only in the final result and only for the first transcript. | VERIFIED | `src/ExpoSpeechRecognitionModule.types.ts`; README compat table |
| `recordingOptions.persist` writes the mic audio to WAV (Android 16 kHz mono PCM16 only; iOS 44.1/48 kHz float32, configurable `outputSampleRate` / `outputEncoding`). `audiostart` / `audioend` events carry the `uri` and an epoch-ms `timestamp`. | VERIFIED | README "Persisting Audio Recordings" |
| **Android mic ownership:** with `continuous` or `persist` on API 33+, the library opens its own `AudioRecord(VOICE_RECOGNITION, 16 kHz)` and pipes it to the recognizer through `EXTRA_AUDIO_SOURCE` + `EXTRA_SEGMENTED_SESSION`. `createOnDeviceSpeechRecognizer` is used when on-device is requested. | VERIFIED | `android/.../ExpoSpeechService.kt`, `ExpoAudioRecorder.kt` |
| Continuous recognition is not supported on Android 12 and below. | VERIFIED | README compat table |

### 3.4 On-device alternatives

| Engine | Package / version | License | Model size | Realtime | Status / source |
| --- | --- | --- | --- | --- | --- |
| whisper.cpp | `whisper.rn` **0.7.4** (whisper.cpp 1.9.3; TurboModule; needs prebuild) | MIT | tiny 75 MiB, base 142 MiB, small 466 MiB (whisper.cpp README); Parakeet TDT 0.6b q4 356 MB | `RealtimeTranscriber` + Silero VAD; Core ML encoder on iOS. `tokenTimestamps`; word-level via `maxLen: 1` ("experimental" upstream). | VERIFIED: tarball README/`NativeRNWhisper.ts`; https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/README.md. Realtime latency on mid-range Android: UNVERIFIED |
| sherpa-onnx | `react-native-sherpa-onnx` **0.4.4** (third-party, TurboModule; peers `@dr.pogodin/react-native-fs`, background-downloader) | MIT wrapper; sherpa-onnx Apache-2.0 | depends on model (Zipformer, Paraformer, NeMo, Moonshine) | Streaming STT + native PCM live capture | VERIFIED: tarball README; https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/LICENSE |
| Vosk | `react-native-vosk` **2.1.7** (last publish 2025-11-17) | MIT wrapper; Vosk Apache-2.0 | ~50 MB small models | Streaming, zero-latency | VERIFIED: npm; https://raw.githubusercontent.com/alphacep/vosk-api/master/README.md. Accuracy below Whisper or Apple: UNVERIFIED |
| Apple SpeechAnalyzer wrapper | `react-native-nitro-speech` 0.4.9 (single maintainer; uses SpeechAnalyzer on iOS 26+ with SFSpeechRecognizer fallback) | MIT | system | yes | VERIFIED (npm README); maturity UNVERIFIED |

### 3.5 Recommended approach

**Principle: one microphone owner per platform. Recognition gets audio from that owner, never from a second capture client.**

**iOS (min 16.4):**
1. **Phase-0 spike (2–3 days), "shared session" path:** VisionCamera `useVideoOutput({ enableAudio: true, fileType: 'mp4' })` records A/V with perfect lip-sync. `expo-speech-recognition.start({ continuous: true, interimResults: true, requiresOnDeviceRecognition: true, iosCategory: { category: 'playAndRecord', mode: 'videoRecording', categoryOptions: ['mixWithOthers','allowBluetooth','defaultToSpeaker'] } })` runs at the same time. Before the camera session starts, set the category once (via `setCategoryIOS`) so neither side changes the mode mid-recording. Test on iPhone 12, 15 and 17-class devices, with AirPods, with calls and Siri interruptions, and with takes of 10 minutes or more. **UNVERIFIED.**
2. **Fallback / target architecture: custom Expo module `PromptlyCapture` (Swift).** One `AVCaptureSession` with video + `AVCaptureAudioDataOutput` → `AVAssetWriter`. The same audio `CMSampleBuffer`s go to `SFSpeechAudioBufferRecognitionRequest.appendAudioSampleBuffer` (iOS 16.4–25), or are converted to `AVAudioPCMBuffer` → `AnalyzerInput(buffer:bufferStartTime:)` for `SpeechTranscriber` with `.volatileResults` (iOS 26+). Recognition timing then matches the video timeline exactly. Estimate: 1–2 engineer-weeks. Use it if the spike shows interruptions.

**Android (min API 24):**
1. **API 33+ (recommended):** VisionCamera video output with `enableAudio: false`. `expo-speech-recognition.start({ continuous: true, requiresOnDeviceRecognition: <model installed>, recordingOptions: { persist: true } })` owns the mic and feeds the recognizer through `EXTRA_AUDIO_SOURCE`. After stop, **mux** the persisted WAV with the video in the PromptlyExport pass (Media3 Transformer composition). Align using the `audiostart` timestamp against the recorder start callback.
   - Caveat: the persisted audio is 16 kHz mono, which is acceptable for voice but low-fidelity.
   - v1.1 target: fork into `PromptlyCapture` (Kotlin), recording `AudioRecord` at 48 kHz, encoding AAC for the file, and downsampling to 16 kHz for the recognizer pipe.
2. **API 24–32:** no `EXTRA_AUDIO_SOURCE`, so live recognition would fight CameraX for the mic. Options: record with camera audio and use timer or manual scroll (default), or run sherpa-onnx streaming fed from our own `AudioRecord` (camera muted, mux later).
3. Check `isOnDeviceRecognitionAvailable` and installed locales up front. Offer `androidTriggerOfflineModelDownload()` during onboarding.

**Voice-follow does not need perfect word timing.** It only needs "which script word is being spoken now". Use fuzzy matching of interim results against script tokens, which tolerates the 200–800 ms recognizer latency (estimate; **UNVERIFIED**).

## 4. Captions from the recorded video

| Option | Word timings | Status / source |
| --- | --- | --- |
| iOS `SFSpeechRecognizer` (on-device) via `expo-speech-recognition` `audioSource.uri` (16 kHz WAV extracted from the MP4) → `segments` | yes (`timestamp`, `duration`) | VERIFIED (lib + Apple docs above) |
| iOS 26+ `SpeechTranscriber` + `analyzeSequence(from: AVAudioFile)` + `.audioTimeRange` (custom module, or `react-native-nitro-speech`) | yes (time ranges on text runs) | VERIFIED (Apple docs) |
| Android 14+ on-device recognizer with `audioSource.uri` + `EXTRA_REQUEST_WORD_TIMING` | yes (first transcript, final result only) | VERIFIED (lib + Android docs) |
| Android 13 / older, or no on-device model: `whisper.rn` with `tokenTimestamps` and `maxLen: 1` on a `ggml-base` model (142 MiB download) | yes (experimental) | VERIFIED (API exists); quality and speed UNVERIFIED |
| Cloud: Deepgram Nova-3 pre-recorded ~$0.0043/min PAYG | word timings in response | VERIFIED (index) https://deepgram.com/pricing |
| Cloud: AssemblyAI Universal-2 $0.15/hr; Universal-3.5 Pro $0.21/hr | word timings | VERIFIED (index) https://www.assemblyai.com/pricing |
| Cloud: OpenAI `whisper-1` $0.006/min; `timestamp_granularities[]=word` **only on whisper-1** with `verbose_json`. `gpt-4o-mini-transcribe` (~$0.003/min est.) has no word timestamps. | — | VERIFIED (index) https://developers.openai.com/api/docs/guides/speech-to-text ; https://developers.openai.com/api/docs/pricing |

Recommendation: on-device first (free, private). Offer cloud transcription (Deepgram or AssemblyAI through the proxy) as a Pro feature for Android devices with no on-device model, and for re-caption accuracy. Full price table: `docs/business/ai-cost-inputs.md`.

## 5. Burning captions into the video

| Claim | Status | Source |
| --- | --- | --- |
| **FFmpegKit is officially retired** (README update July 2026). The continuation "FFmpegKitNext" is **source-only**, so you build FFmpeg yourself. The `ffmpeg-kit-react-native` npm package (6.0.2, last modified 2025-01) is LGPL-3.0, and many unofficial forks exist on npm. | VERIFIED | https://raw.githubusercontent.com/arthenica/ffmpeg-kit/main/README.md ; `npm view ffmpeg-kit-react-native` |
| iOS: `AVVideoCompositionCoreAnimationTool` (iOS 4+) incorporates Core Animation layers into an `AVVideoComposition`. Animations run on the video timeline, so use `beginTime = AVCoreAnimationBeginTimeAtZero`. | VERIFIED | https://developer.apple.com/documentation/avfoundation/avvideocompositioncoreanimationtool |
| Android: Media3 **1.11.1** (stable, 2026-09-10). `androidx.media3.effect.TextOverlay` (SpannableString, per-timestamp `getText(presentationTimeUs)`) / `BitmapOverlay` with Transformer. | VERIFIED | https://developer.android.com/jetpack/androidx/releases/media3 ; https://developer.android.com/reference/androidx/media3/effect/TextOverlay |
| RN libraries: no mature, widely used RN library for burn-in. `expo-pro-video-editor` 0.2.14 (BSD-3, created 2026-09-02, single maintainer; AVFoundation + Media3 1.10.1; timed text overlays) is a usable reference but brings UI peer deps (uniwind, tailwindcss). `@hortemo/expo-media3-transformer` 1.0.1 is Android only. | VERIFIED (npm) / maturity UNVERIFIED | `npm view expo-pro-video-editor`; tarball README |

**Recommendation:** write a local Expo module `modules/promptly-export` (Swift + Kotlin, roughly 600–900 LOC) with one function: `exportCaptioned({ videoUri, audioUri?, audioOffsetMs?, captions: [{startMs,endMs,text,style}], style, outputUri })`.
- iOS: `AVMutableComposition` (video track + optional external audio track) → `AVMutableVideoComposition` + `AVVideoCompositionCoreAnimationTool` (one `CATextLayer` per caption with opacity keyframes) → `AVAssetExportSession` (HEVC or H.264).
- Android: Transformer `Composition` (video `EditedMediaItemSequence` + audio sequence) + an `OverlayEffect` with a custom `TextOverlay` subclass whose `getText(presentationTimeUs)` returns the active caption.
- The same module also does the Android audio mux from §3.5 and the WAV extraction for transcription.
- Also emit a sidecar `.srt`/`.vtt` for platforms that accept soft captions.

## 6. RevenueCat

| Claim | Status | Source |
| --- | --- | --- |
| `react-native-purchases` **10.15.0** (2026-10-19), MIT, RN >= 0.73. Native core `PurchasesHybridCommon` 19.12.0. `react-native-purchases-ui` 10.15.0 for paywalls. | VERIFIED | npm; tarball podspec/build.gradle |
| Expo: install with `npx expo install react-native-purchases`. Needs a dev build. In Expo Go it runs in Preview API Mode (mocks). | VERIFIED | tarball README |
| Subscriptions and a non-consumable "lifetime" product can unlock the **same entitlement** (e.g. `pro`). Check `customerInfo.entitlements.active.pro`, not `activeSubscriptions`. | VERIFIED (index) | https://www.revenuecat.com/docs/getting-started/entitlements ; https://www.revenuecat.com/docs/platform-resources/non-subscriptions |
| **Test Store**: built into every project, uses a separate API key, and shows a simulated purchase modal. If a release build is configured with the Test Store key, the SDK alerts and crashes, so use platform keys in preview and production builds. Platform sandboxes (StoreKit sandbox / TestFlight, Play license testers) are still required. | VERIFIED (index) | https://www.revenuecat.com/docs/test-and-launch/sandbox ; https://www.revenuecat.com/blog/company/revenuecat-test-store |
| Pricing: free until $2,500 MTR, then 1% of **total** MTR (gross, before store fees). | VERIFIED (index) | https://www.revenuecat.com/pricing ; https://www.revenuecat.com/docs/welcome/set-up-revenuecat/account-management |
| App user IDs: use an anonymous RevenueCat ID or our own UUID (`Purchases.logIn`). The proxy server checks entitlements through the RevenueCat REST API, or caches them from webhooks keyed by app user ID. | design recommendation | — |

## 7. LLM for script AI + proxy + abuse protection

| Claim | Status | Source |
| --- | --- | --- |
| Claude Haiku 5.5 (`claude-haiku-5-5`): $0.10 in / $0.50 out per MTok for prompts ≤100k tokens ($0.50/$2.50 above that); 1M context; cache hits $0.01. Sonnet 5.5 (`claude-sonnet-5-5`): $2 / $10. Batch is 50% off. | VERIFIED | https://platform.claude.com/docs/en/about-claude/pricing ; https://platform.claude.com/docs/en/models/overview |
| OpenAI GPT-5.4 mini $0.75/$4.50; GPT-5.4 nano $0.20/$1.25 per MTok (GPT-5 mini and nano now marked deprecated). | VERIFIED (index) | https://openai.com/index/introducing-gpt-5-4-mini-and-nano/ ; https://developers.openai.com/api/docs/models/gpt-5.4-mini |
| Gemini 3.1 Flash-Lite $0.25/$1.50; 2.5 Flash-Lite $0.10/$0.40; 3.6 Flash prices conflict between Google pages. | VERIFIED (index) | https://ai.google.dev/gemini-api/docs/pricing |
| Apple **Foundation Models** framework (iOS 26+): `SystemLanguageModel` on-device. Needs an Apple Intelligence-capable device and a supported region; check `availability`, `supportedLanguages` and `contextSize` at runtime. Guided generation via `@Generable`. RN wrappers exist (`expo-foundation-models` 1.0.2, `@react-native-ai/apple` 0.12.0), maturity unverified. | VERIFIED (Apple docs); wrappers UNVERIFIED | https://developer.apple.com/documentation/foundationmodels ; .../systemlanguagemodel |
| Android **ML Kit GenAI Prompt API** (Gemini Nano): Beta (from 2026-01-28; `genai-prompt 1.0.0-beta4`, 2026-07-21). Device support is limited to the nano-v2/v3/v4 device lists (Pixel 9–11, Galaxy S26, some OnePlus/OPPO/Xiaomi). No first-party RN wrapper found. | VERIFIED (index) | https://developers.google.com/ml-kit/genai ; https://developers.google.com/ml-kit/release-notes |
| Cloudflare Workers Paid: $5/mo minimum; 10M requests included then $0.30/M; 30M CPU-ms included then $0.02/M CPU-ms. KV reads $0.50/M after 10M; D1 and Durable Objects included tiers. | VERIFIED (index) | https://developers.cloudflare.com/workers/platform/pricing/ ; https://developers.cloudflare.com/durable-objects/platform/pricing/ |
| Supabase Edge Functions: Free 500k invocations; Pro 2M included then $2/M (Pro base fee not re-checked). | VERIFIED (index) | https://supabase.com/docs/guides/platform/billing-on-supabase |
| **App Attest** (`DCAppAttestService`, iOS 14+) and **Play Integrity** (default quota 10,000 requests/day, can be raised). `@expo/app-integrity` **58.0.2** (Expo first-party, MIT) wraps both: `generateKeyAsync` / `attestKeyAsync` / `generateAssertionAsync` (iOS) and `prepareIntegrityTokenProviderAsync` / `requestIntegrityCheckAsync` (Android). It is not in bundledNativeModules, so pin it explicitly. | VERIFIED | https://developer.apple.com/documentation/devicecheck/dcappattestservice ; https://developer.android.com/google/play/integrity/overview ; tarball `build/AppIntegrity.d.ts` |

**Recommendation:**
- **Proxy:** a Cloudflare Worker (TypeScript) holds the Anthropic key. Request flow:
  1. Verify the App Attest assertion or Play Integrity token. Keep per-device key state in D1 or KV.
  2. Look up the RevenueCat entitlement by app user ID (cached in KV with a 5-minute TTL, refreshed by RevenueCat webhooks).
  3. Enforce a per-user quota with a Durable Object counter.
  4. Call `claude-haiku-5-5`, use `claude-sonnet-5-5` for "pro rewrite", and stream the response back.
- **On-device:** use Apple Foundation Models where available, for free and offline "tighten / shorten" edits. Treat Gemini Nano as optional later.

## 8. Teleprompter smooth scroll

| Claim | Status | Source |
| --- | --- | --- |
| `react-native-reanimated` **4.7.1** peers: `react-native 0.86 – 0.88`, `react-native-worklets 0.13.x`. Expo SDK 58 bundles reanimated 4.7.1 + worklets 0.13.0. | VERIFIED | `npm view react-native-reanimated@4.7.1 peerDependencies`; bundledNativeModules.json |
| `useFrameCallback`, `scrollTo`, `useAnimatedRef`, `useScrollOffset`, `useSharedValue` are exported. | VERIFIED | tarball `lib/typescript/index.d.ts` |

**Approach:** run a UI-thread worklet in `useFrameCallback`: `offset.value += speedPxPerSec * dt`. Apply it either through `scrollTo(animatedRef, 0, offset.value, false)` or, smoother, as `transform: translateY(-offset)` on a pre-laid-out text container in `useAnimatedStyle`, which avoids ScrollView layout. Gesture Handler 3.3 handles pause, nudge and speed control. Voice-follow sets a target offset from JS (recognized word index → line y), and the worklet eases toward it with a spring. The JS thread is never on the per-frame path. Use `expo-keep-awake` while recording.

---

## 9. Recommended stack (Expo SDK 58 compatible, exact versions)

Versions marked `~` are the SDK 58 `bundledNativeModules.json` ranges (install with `npx expo install`). Pinned versions are the latest on npm as of 2026-10-20.

| Area | Package | Version |
| --- | --- | --- |
| Core | `expo` | ~58.0.16 |
| | `react` / `react-native` | 19.3.0 / 0.88.0 |
| | `expo-dev-client` | ~58.0.14 |
| | `expo-router` | ~58.0.24 |
| | `react-native-screens` / `react-native-safe-area-context` | ~4.30.0 / ~5.10.1 |
| | `react-native-gesture-handler` | ~3.3.0 |
| Animation | `react-native-reanimated` | 4.7.1 |
| | `react-native-worklets` | 0.13.0 |
| Camera | `react-native-vision-camera` | 5.2.3 |
| | `react-native-nitro-modules` (**missing in project, add**) | 0.37.1 |
| | `react-native-nitro-image` (**missing in project, add**) | 0.15.2 |
| Speech | `expo-speech-recognition` | 58.0.0 |
| | `whisper.rn` (optional fallback, Android ≤13 captions) | 0.7.4 |
| Storage / files | `expo-sqlite` | ~58.0.13 |
| | `expo-file-system` (new `File`/`Directory` API) | ~58.0.10 |
| | `expo-secure-store` | ~58.0.2 |
| Media | `expo-video` (playback/review) | ~58.0.12 |
| | `expo-media-library` (save to Photos/Gallery) | ~58.0.11 |
| | `expo-sharing` | ~58.0.19 |
| | `expo-keep-awake` | ~58.0.3 |
| | `expo-haptics` | ~58.0.7 |
| Monetization | `react-native-purchases` | 10.15.0 |
| | `react-native-purchases-ui` (optional paywalls) | 10.15.0 |
| Integrity | `@expo/app-integrity` | 58.0.2 |
| Native (local Expo modules) | `modules/promptly-export` (AVFoundation / Media3 1.11.1 caption burn-in + mux + audio extract) | in-repo |
| | `modules/promptly-capture` (only if the iOS spike fails, or for the Android 48 kHz path) | in-repo |
| Server | Cloudflare Workers + KV + D1 + Durable Objects; Anthropic `claude-haiku-5-5` / `claude-sonnet-5-5` | — |

Do **not** add: `expo-camera` alongside VisionCamera (CameraX version clash); `ffmpeg-kit-react-native` (retired, LGPL); `expo-av` (superseded by expo-video and expo-audio). Remove `legacy-peer-deps=true` once the nitro peer deps are installed, so peer mismatches surface again. **UNVERIFIED:** whether any other package needs that flag.

## 10. Risks

| # | Risk | Likelihood / impact | Mitigation |
| --- | --- | --- | --- |
| R1 | **iOS audio-session conflict.** The camera's audio capture and `expo-speech-recognition`'s `AVAudioEngine` each configure the shared `AVAudioSession`. Mode changes or `setActive` can interrupt capture (silent audio track, `audio-device-in-use-by-another-client`). | Medium / High | Phase-0 device spike. One fixed category (`playAndRecord` + `videoRecording`) set before both start. Fallback is the `PromptlyCapture` module (single `AVCaptureSession`, buffers shared to the recognizer). |
| R2 | **Android mic contention.** The system recognizer opening the mic while CameraX records means silence for one side. Below API 33 there is no `EXTRA_AUDIO_SOURCE`. | High (if done naively) / High | App-owned mic plus `EXTRA_AUDIO_SOURCE`, camera muted, mux later. Disable voice-follow during recording on API ≤ 32, or use sherpa-onnx. |
| R3 | **A/V sync when muxing separately captured audio (Android)**, plus 16 kHz audio fidelity from expo-speech-recognition persist. | Medium / High | Align by capture timestamps and verify with clap tests. Move to a 48 kHz `AudioRecord` in PromptlyCapture. |
| R4 | **VisionCamera 5.2.3 vs RN 0.88**: no release since 2026-08-20; Android uses CameraX **alpha**; missing nitro peer deps in the repo. | Medium / Medium | Build-test in the spike. Pin versions. Keep expo-camera ~58.0.11 as plan B (CameraView with `mute`, `videoQuality`, `codec`). |
| R5 | On-device recognition availability differs by device and locale. Android needs a Google on-device model download (`com.google.android.as`, `com.google.android.tts`). SpeechTranscriber is unavailable on some hardware. | High / Medium | Capability check at onboarding. Fall back to network recognition (with consent), then whisper.rn, then manual scroll. |
| R6 | Recognition session limits and interruptions during long takes (calls, Siri, route changes; library emits `interrupted` / `audio-capture`). | Medium / Medium | Auto-restart the recognizer while the recording continues. Voice-follow tolerates gaps. |
| R7 | Caption burn-in is custom native code (two platforms); no maintained RN library; FFmpegKit retired. | Certain / Medium | Budget about 2 weeks. Use `expo-pro-video-editor` as a reference. Ship SRT/VTT export first if needed. |
| R8 | LLM proxy abuse and cost spikes. | Medium / Medium | App Attest / Play Integrity, RevenueCat entitlement checks, per-user Durable Object quotas, Haiku by default, `max_tokens` caps. |
| R9 | Pricing drift. Several vendor pages could only be read through search index snapshots, and Google Play fees changed on 2026-06-30. | Medium / Low | Re-verify `docs/business/ai-cost-inputs.md` before setting prices. |
| R10 | Expo SDK 58 scene-based lifecycle and iOS 27 changes affect any custom `AppDelegate` code from native modules. | Low / Medium | Write native code as Expo Modules (lifecycle subscribers), not AppDelegate edits. |
| R11 | Store review: mic, camera and speech permission strings; Speech Recognition permission is needed on iOS for network recognition. | Low / Medium | Clear purpose strings. Prefer `requiresOnDeviceRecognition` with `requestMicrophonePermissionsAsync()` where possible. |

## 11. Spike plan (before building features)

1. Install the nitro peers, run `npx expo prebuild`, and do dev builds on iOS 16.4, iOS 26 and Android 10/13/14 devices.
2. iOS: VisionCamera (`enableAudio: true`) + expo-speech-recognition (continuous, on-device, fixed `iosCategory`). Record ten 10-minute takes. Measure: an audio track is present, there are no interruptions, recognition latency, and battery and thermal behaviour.
3. Android 13+: VisionCamera (`enableAudio: false`) + expo-speech-recognition (`continuous` + `persist`). Mux with a Media3 prototype and measure A/V offset with a clap test. Also try VisionCamera with `enableAudio: true` plus the library's own `AudioRecord` (same-app concurrency, UNVERIFIED) to see whether both get audio.
4. Caption pipeline: extract a 16 kHz WAV, transcribe with `audioSource.uri`, get segments, burn in on both platforms, and compare against Deepgram output.
