package expo.modules.promptlymedia

// Hardware remote / keyboard keys for the teleprompter (docs/architecture/remote-control.md).
//
// React Native 0.88 only sends `onKeyDown` to JS when the `enableKeyEvents` feature flag is on
// (default false in every OSS release channel; ReactRootView.dispatchJSKeyEvent returns early),
// so keys are taken from the Activity instead: Expo's ReactActivityDelegateWrapper forwards
// Activity.onKeyDown/onKeyUp to every ReactActivityHandler before RN's own delegate. Activity
// callbacks only see keys the focused view did not consume (e.g. Enter on a focused button
// clicks that button first).
//
// Autolinking registers this class because the file name ends in `Package.kt` and it imports
// expo.modules.core.interfaces.Package (expo-modules-autolinking android resolver).
//
// NOTE: not compiled in CI.

import android.content.Context
import android.view.KeyEvent
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler

/** Bridge between the Activity key callbacks and the JS-facing module. Main thread only. */
internal object RemoteKeys {
  /** Set while the record screen listens; null otherwise (keys pass through untouched). */
  @Volatile var emitter: ((String, Boolean) -> Unit)? = null

  fun keyName(keyCode: Int): String? = when (keyCode) {
    KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
    KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
    KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
    KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
    KeyEvent.KEYCODE_PAGE_UP -> "PageUp"
    KeyEvent.KEYCODE_PAGE_DOWN -> "PageDown"
    KeyEvent.KEYCODE_SPACE -> "Space"
    KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_DPAD_CENTER -> "Enter"
    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "MediaPlayPause"
    KeyEvent.KEYCODE_MEDIA_NEXT -> "MediaTrackNext"
    KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "MediaTrackPrevious"
    // Volume keys are deliberately not handled (see remote-control.md).
    else -> null
  }

  private fun forwarded(keyCode: Int, event: KeyEvent?): String? {
    if (emitter == null) return null
    // Leave shortcuts (Ctrl/Alt/Meta + key) to the system.
    if (event != null && (event.isCtrlPressed || event.isAltPressed || event.isMetaPressed)) return null
    return keyName(keyCode)
  }

  fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    val name = forwarded(keyCode, event) ?: return false
    emitter?.invoke(name, (event?.repeatCount ?: 0) > 0)
    return true
  }

  /** Consume the key-up of keys we forwarded so nothing else acts on half a press. */
  fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean = forwarded(keyCode, event) != null
}

private class RemoteKeyActivityHandler : ReactActivityHandler {
  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean = RemoteKeys.onKeyDown(keyCode, event)

  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean = RemoteKeys.onKeyUp(keyCode, event)
}

class PromptlyMediaPackage : Package {
  override fun createReactActivityHandlers(activityContext: Context?): List<ReactActivityHandler> =
    listOf(RemoteKeyActivityHandler())
}
