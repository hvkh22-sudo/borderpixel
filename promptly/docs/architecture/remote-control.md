# Remote control (Bluetooth page-turners and hardware keyboards)

Status: implemented, **never compiled natively, never tested on a device** (device test RC-01).

## What the user gets
On the record screen, a paired Bluetooth page-turner or keyboard drives the prompter:

| Key | Manual / Voice Follow | Timed |
|---|---|---|
| ↓ → PageDown, Media Next (Android) | forward 3 lines | forward 3 lines |
| ↑ ← PageUp, Media Previous (Android) | back 3 lines | back 3 lines |
| Space | forward 3 lines | play / pause |
| Media Play/Pause (Android) | — | play / pause |
| Enter | nothing, unless “Remote can start/stop recording” is on → start/stop (1.5 s cooldown) | same |

Settings › Remote control: “Use a Bluetooth remote or keyboard” (default **on**) and
“Remote can start/stop recording” (default **off**: Enter is the key a stray press is most likely
to send, and ending a take by accident is costly). Held keys repeat scrolling (Android) but never
repeat a toggle. Shortcuts with Cmd/Ctrl/Alt/Meta are left to the system. In Voice Follow a
nudge is temporary: the prompter glides back to the speaker on the next recognized word.

Code: mapping `src/features/teleprompter/remoteKeys.ts` (pure, unit-tested), bridge
`PromptlyMedia.listenRemoteKeys` in `src/services/nativeMedia.ts`, wiring in
`src/app/record/[id].tsx` (subscribed only while the record screen is mounted, the app is
active and the setting is on), natives in `modules/promptly-media`.

## Why not React Native `onKeyDown` (research, RN 0.88.0 sources in node_modules)
`View` declares `onKeyDown/onKeyUp` in `types_generated/Libraries/Components/View/ViewPropTypes.d.ts`,
but at runtime:

**Android — delivered only behind a feature flag that is off.**
- `ReactRootView.dispatchKeyEvent` → `dispatchJSKeyEvent`, which returns immediately when
  `ReactNativeFeatureFlags.enableKeyEvents()` is false (`ReactAndroid/.../react/ReactRootView.java`
  ~L430). The bridgeless `runtime/ReactSurfaceView.kt` (~L199) has the same guard and only creates
  its `JSKeyDispatcher` when the flag is on (~L75).
- The flag defaults to `false` in `ReactNativeFeatureFlagsDefaults.kt` (L96),
  `ReactCommon/react/featureflags/ReactNativeFeatureFlagsDefaults.h` and
  `src/private/featureflags/ReactNativeFeatureFlags.js` (L358), and none of the
  `ReactNativeFeatureFlagsOverrides_RNOSS_{Stable,Canary,Experimental}_Android.kt` turns it on.
  Overriding it needs native code in `MainApplication` before RN starts (generated `android/`)
  and would flip an experimental flag app-wide.
- Even with the flag, `JSKeyDispatcher` (`uimanager/JSKeyDispatcher.kt`) targets the focused
  view, so a `focusable` view must hold Android focus, and `events/KeyEvent.kt`'s `CODE_MAP` has
  no PageUp/PageDown (they arrive as `Unidentified`) — the most common page-turner keys.
- `ReactAndroidHWInputDeviceHelper.kt` emits a TV-style `onHWKeyEvent` device event (arrows,
  select, media keys; no PageUp/Down) regardless of the flag, but only from
  `ReactRootView.dispatchKeyEvent`, which Android calls only when focus is inside the root view —
  in touch mode usually nothing is focused. It is an undocumented TV path; not relied on.

**iOS — not delivered at all.** `BaseViewConfig.ios.js` registers no `topKeyDown/topKeyUp`
(only TextInput's `topKeyPress`), and `React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm`
implements no `pressesBegan`/`keyCommands` (only `canBecomeFocused` for `focusable`).
`React/Base/RCTKeyCommands.m` is the dev-menu shortcut swizzle (private API, dev only).

Conclusion: no pure-JS path works on either platform, so both are native.

## iOS implementation
`modules/promptly-media/ios/RemoteKeyResponder.swift`: while enabled, a hidden, zero-size,
non-interactive `UIView` with `canBecomeFirstResponder = true` is added to the key window and
made first responder. `pressesBegan` reads `UIPress.key` (iOS 13.4+; pod minimum is 16.4) and
maps `UIKeyboardHIDUsage` arrows, PageUp/Down, Space, Return/Enter, keypad Enter; other presses
go to `super`. It does not adopt `UIKeyInput`, so no software keyboard appears. It re-claims
first responder on `UIWindow.didBecomeKeyNotification` / `didBecomeActiveNotification` (alerts
and sheets take it away) and never steals it from an active text input. No swizzling.

Limitations: consumer-page media keys (play/pause, next) are routed by iOS to
`MPRemoteCommandCenter` / Now Playing, not to `UIPress`, and taking Now Playing would interfere
with the recording audio session — not supported on iOS. iPadOS Full Keyboard Access may claim
arrows for its own focus navigation (untested).

## Android implementation
`modules/promptly-media/android/.../PromptlyMediaPackage.kt`: an Expo `Package` (autolinked
because the file ends in `Package.kt` and imports `expo.modules.core.interfaces.Package`)
returns a `ReactActivityHandler`. Expo's `ReactActivityDelegateWrapper.onKeyDown/onKeyUp`
(`node_modules/expo/android/.../ReactActivityDelegateWrapper.kt` ~L264) calls every handler
before RN's delegate, and returns `true` if any consumes the key. The handler forwards DPAD
arrows, DPAD_CENTER/Enter/NumpadEnter, Space, PageUp/Down and media play-pause/next/previous
(with `repeatCount > 0` as `repeat`) and consumes them only while the record screen listens.

Limitations (to verify in RC-01):
- `Activity.onKeyDown` receives only keys the focused view did not consume. If a remote's arrow
  press makes Android leave touch mode and focus a button (e.g. Close), a following
  Space/Enter clicks that button instead of reaching us. Arrows themselves are not consumed by
  buttons, so they still reach us (and we consume them, so focus does not move further).
- The first arrow press after touching the screen may be consumed by the framework to leave
  touch mode.

## Volume buttons — not implemented (deliberate)
Many cheap “selfie” remotes send Volume Up. Not supported because:
- iOS has no public API to intercept volume buttons; the known workaround (observe
  `AVAudioSession.outputVolume` and reset it via a hidden `MPVolumeView` slider) changes the
  user's volume, shows the HUD, is App-Review-sensitive, and fights the recording audio session.
  (iOS 17.2+ `AVCaptureEventInteraction` maps volume/camera-shutter presses to capture events,
  but VisionCamera owns capture and would need integration — revisit later.)
- Android delivers volume keys to `onKeyDown`, but consuming them disables volume control
  in the app and conflicts with the system volume UI and accessibility shortcuts
  (both volume keys = TalkBack shortcut).
- A volume key looks like any other volume press, so false triggers would scroll mid-take.

## Privacy
Only the key name is sent to JS; nothing is logged or sent to analytics.
