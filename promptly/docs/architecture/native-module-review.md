# promptly-media native module review

Static review of `modules/promptly-media` before its first native build. No Xcode, Android SDK or Google Maven was available, so nothing was compiled. Every API was checked against the installed `expo-modules-core` 58.0.23 sources, other installed Expo modules, and the Media3 `1.11.1` tag of `androidx/media` on GitHub.

Status key: **VERIFIED**: matches the source named. **FIXED**: was wrong or risky and has been changed. **UNVERIFIED**: could only be checked by reasoning, not against a source.

## Module packaging

| API / file | Status | Notes |
|---|---|---|
| `expo-module.config.json` (`platforms`, `apple.modules`, `android.modules`) | VERIFIED | Same shape as expo-keep-awake and expo-localization. `publication` is only needed for prebuilt Maven artifacts. |
| `PromptlyMedia.podspec` (16.4, swift 5.9, static_framework, DEFINES_MODULE, wholemodule) | VERIFIED | Matches expo-keep-awake and expo-haptics. `source = { git: '' }` is fine for a local pod. |
| `android/build.gradle` plugins `com.android.library` + `expo-module-gradle-plugin`, `namespace`, `defaultConfig` | VERIFIED | Matches expo-keep-awake. The plugin supplies compileSdk 36 and minSdk 24, which meet Media3's minSdk 23. |
| `kotlinx-coroutines-android:1.10.2` dependency | FIXED | Removed. The module never uses coroutines, and expo-modules-core already exposes it as `api`. |
| `androidx.core.os.bundleOf` | VERIFIED | `core-ktx:1.17.0` is an `api` dependency of expo-modules-core. |
| Guava `ImmutableList` / `androidx.annotation.OptIn` | VERIFIED | media3-common declares `api(guava)` and `api(annotation-experimental)`. |

## Expo Modules API: Kotlin

| API | Status | Notes |
|---|---|---|
| `Record` + `@Field val` with defaults | VERIFIED | `records/Field.kt` and `Record.kt`. expo-crypto uses `@Field val` the same way. |
| `AsyncFunction` with a trailing `Promise` (3 args + Promise, 4 args + Promise, 5 args + Promise) | VERIFIED | `ObjectDefinitionBuilder.kt` has `@JvmName("AsyncFunctionWithPromise")` overloads up to 7 args. |
| `.runOnQueue(Queues.MAIN)` | VERIFIED | `BaseAsyncFunctionComponent.kt`. `Queues.MAIN` exists. |
| `Function("cancel")` | FIXED | The lambda returned the `Boolean` from `Handler.post`. It now returns `Unit`, matching the TS `void`. |
| `Events`, `sendEvent(name, Bundle)` | VERIFIED | `Module.kt` has `sendEvent(String, Bundle?)` and a `Map` overload. |
| `CodedException(code, message, cause)` | VERIFIED | `exception/CodedException.kt` secondary constructor. |
| `Promise.resolve(String)` / `reject(CodedException)` | VERIFIED | `Promise.kt`. |
| `appContext.reactContext` (`Context?`) | VERIFIED | `AppContext.kt:227`. |
| `@UnstableApi` on module class | FIXED | Replaced with `@OptIn(UnstableApi::class)` (androidx). Annotating with `@UnstableApi` would spread the opt-in requirement into the generated `ExpoModulesPackageList`, which fails lint. |

## Media3 1.11.1 (Kotlin)

| API | Status | Notes |
|---|---|---|
| `BitmapOverlay.getBitmap(long)` (abstract) | VERIFIED | `BitmapOverlay.java:141`. Re-uploads only when the bitmap instance or generation ID changes, so caching is effective. |
| `getOverlaySettings(long)` returns `OverlaySettings` | VERIFIED | `TextureOverlay.java:76`. Kotlin's covariant override returning `StaticOverlaySettings` (which `implements OverlaySettings`) is legal. Settings are now built once instead of on every frame. |
| `StaticOverlaySettings.Builder().setBackgroundFrameAnchor(x, y)` | FIXED | The API is verified. The builder calls `checkArgument(-1..1)`, so the y value is now clamped to stay in range. |
| `OverlayEffect(List<TextureOverlay>)` | VERIFIED | `OverlayEffect.java:44`. It takes a `List`, not `ImmutableList`; passing an `ImmutableList` is fine. |
| `Effects(List<AudioProcessor>, List<Effect>)` | VERIFIED | `Effects.java:63`. |
| `EditedMediaItem.Builder(MediaItem)`, `setRemoveAudio`, `setRemoveVideo`, `setEffects` | VERIFIED | `EditedMediaItem.java`. |
| `EditedMediaItemSequence.Builder(Set<Int>)`, `addItem`, `addGap(durationUs)` | VERIFIED | `EditedMediaItemSequence.java:121/178/218`. `addGap` takes microseconds; its Javadoc saying "milliseconds" is a typo, because it calls `setDurationUs`. |
| `EditedMediaItemSequence.Builder(EditedMediaItem...)` | FIXED | Deprecated in 1.11. Now `Builder(setOf(C.TRACK_TYPE_VIDEO)).addItem(video)`. |
| Empty audio sequence in `muxAudio` | FIXED | A sequence must not be empty. When there are no segments, the composition is now video only. |
| `Composition.Builder(seq, vararg seqs)` | VERIFIED | `Composition.java:70`. |
| `Transformer.Builder(context).setVideoMimeType/setAudioMimeType/addListener` | VERIFIED | `Transformer.java:144/222/254/477`. |
| `Listener.onCompleted(Composition, ExportResult)`, `onError(Composition, ExportResult, ExportException)` | VERIFIED | `Transformer.java:769/781`. |
| `getProgress(ProgressHolder)`, `PROGRESS_STATE_AVAILABLE`, `ProgressHolder.progress` (0–100) | VERIFIED | `Transformer.java:825/1139`, `ProgressHolder.java`. |
| Looper threading | VERIFIED | The builder captures `Util.getCurrentOrMainLooper()`, and `start`, `getProgress` and `cancel` call `verifyApplicationThread()`. Build, start, poll and cancel all run on the main looper (`Queues.MAIN` plus `mainHandler`). |
| `Transformer.cancel()` | FIXED | It does not call the listener, so the JS promise used to hang forever. `cancel` now rejects with `Cancelled` and deletes the partial file. A synchronous `start()` failure now rejects too, and the job no longer leaks in the job table. |

## Expo Modules API: Swift

| API | Status | Notes |
|---|---|---|
| `struct …: Record` with `@Field var` | VERIFIED | Standard pattern. Structs get an implicit `init()`. |
| `AsyncFunction` with `async throws` closures (1–5 args, `[CueRecord]`, `[[String: Any]]`) | VERIFIED | `ConcurrentFunctionFactories.swift` uses parameter packs (`repeat each A: AnyArgument`). `Array` and `Dictionary` conform to `AnyArgument`. The closure is `@Sendable` with a `sending R` result. In Swift 5.9 mode, capturing a non-Sendable `self` only warns. |
| `Function("cancel") { (jobId: String) in … }` | VERIFIED | `SyncFunctionFactories.swift`. |
| `sendEvent(_:_: [String: Any?])` | VERIFIED | `Core/Modules/Module.swift:28`. |
| `Exception(name:description:)` | VERIFIED | `Core/Exceptions/Exception.swift:39`. |
| Subclass stored properties and `init` | VERIFIED | `BaseModule.init()` is unavailable, and `required init(appContext:)` is inherited because every stored property has a default value. |
| `NSLock.lock()/unlock()` inside an `async` function | FIXED | `lock`/`unlock` are `noasync` in current SDKs (warning in Swift 5, error in Swift 6). The code now uses `lock.withLock {}`. |

## AVFoundation / Core Animation (iOS 16.4)

| API | Status | Notes |
|---|---|---|
| `asset.loadTracks(withMediaType:)`, `asset.load(.duration)`, `track.load(.naturalSize, .preferredTransform)`, `.nominalFrameRate` | UNVERIFIED (high confidence) | Async loading APIs from iOS 15. The variadic `load` returns a tuple. |
| `AVMutableComposition` / `addMutableTrack` / `insertTimeRange`, `AVMutableVideoComposition`, layer instruction `setTransform` | UNVERIFIED (high confidence) | Long-standing APIs. They may show deprecation warnings on the iOS 26 SDK; these are not errors. |
| `await session.export()` | FIXED | This is the iOS 15–18 async export, deprecated in 18. `export(to:as:)` needs iOS 18, and `export()` raises Sendable diagnostics. Replaced with `exportAsynchronously` plus a checked continuation and an `@unchecked Sendable` box, which is the pattern used in installed `expo-media-library/ios/next/objects/asset/UriExtractor.swift`. The progress timer also reads through the box now. |
| `CAKeyframeAnimation` discrete visibility | FIXED | Discrete mode needs keyTimes from 0 to 1 with one more entry than values. It was `[s,s,e,e]` for 4 values, which made visibility undefined. It is now `values [0,1,0]` and `keyTimes [0,s,e,1]`. |
| `isGeometryFlipped = true` on parent + `positionY` from top | UNVERIFIED (reasoned) | Animation-tool layers use a bottom-left origin. Flipping the parent makes `y = H·positionY − h/2` measure from the top, which is correct. Apple documents that the flag does not affect content rendering, so the video layer is not mirrored. |
| `CATextLayer` with `NSAttributedString` (UIFont/UIColor, `.strokeWidth` negative) | UNVERIFIED (reasoned) | Common AVFoundation overlay pattern. A negative stroke width draws both stroke and fill. |
| `UIColor(hex:)` extension | FIXED | Made `fileprivate` so it cannot clash with another pod's `init?(hex:)`. |

## Remaining compile and runtime risks

1. **No real build yet.** The first `expo prebuild` plus Xcode/Gradle build is still needed. Likely warnings: `exportAsynchronously` is deprecated on iOS 18, `AVMutableVideoComposition` initialisers may be deprecated on the iOS 26 SDK, and Sendable captures in `@Sendable` closures warn in Swift 5 mode.
2. **Swift 6 mode.** The podspec pins Swift 5.9. Moving to Swift 6 would turn the non-Sendable `self` captures in `AsyncFunction` closures and the timer handler into errors.
3. **Media3 resolution.** `1.11.1` must exist on Google Maven; it was confirmed only as a GitHub tag. Media3's Guava (33.x-android) may need conflict resolution with the app's other dependencies.
4. **Lint.** `ActiveExport` and the use sites rely on class-level `@OptIn`. If lint still flags `UnsafeOptInUsageError`, add `@OptIn(UnstableApi::class)` at the reported site.
5. **Runtime, Android `extractWav`.** It assumes 16-bit PCM decoder output. Some decoders emit float PCM (`KEY_PCM_ENCODING`), which would produce garbage audio.
6. **Runtime, multi-sequence `muxAudio`.** Exporting a video sequence together with an audio-only sequence that contains gaps, or a leading gap, needs a device test. Media3 has historically restricted gaps in some sequence configurations.
7. **Runtime, main thread.** `burnInCaptions` reads `MediaMetadataRetriever` on the main queue before starting, which is brief but blocks the UI.
