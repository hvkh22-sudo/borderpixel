/**
 * Which capabilities this device can offer, decided from explicit platform
 * facts rather than by trying and failing mid-take. Pure so it is tested.
 *
 * Rules (docs/architecture/technical-feasibility.md, DECISIONS D4/D6):
 *  - Voice Follow needs a speech recognizer. On Android it also needs the
 *    recognizer to own the mic and persist audio (EXTRA_AUDIO_SOURCE, API 33+),
 *    because the camera records video only while following.
 *  - Captions need a recognizer that accepts a file. iOS reads the movie;
 *    Android needs API 33+ plus the promptly-media module to decode audio.
 *  - Burn-in needs the promptly-media module.
 */

export type UnsupportedReason = 'flag_off' | 'no_recognizer' | 'os_too_old' | 'native_module_missing';

export type Support = { ok: true } | { ok: false; reason: UnsupportedReason };

export interface DeviceFacts {
  os: 'ios' | 'android' | 'other';
  /** Android API level; ignored elsewhere. */
  androidApiLevel: number;
  recognitionAvailable: boolean;
  /** expo-speech-recognition supportsRecording() (Android 13+). */
  recognizerCanPersistAudio: boolean;
  mediaModuleAvailable: boolean;
}

export interface FeatureFlags {
  voiceFollow: boolean;
  captions: boolean;
  burnIn: boolean;
}

export const ANDROID_MIN_API_VOICE_FOLLOW = 33;
export const ANDROID_MIN_API_CAPTIONS = 33;

const no = (reason: UnsupportedReason): Support => ({ ok: false, reason });
const yes: Support = { ok: true };

export function voiceFollowSupport(d: DeviceFacts, f: FeatureFlags): Support {
  if (!f.voiceFollow) return no('flag_off');
  if (d.os === 'other') return no('no_recognizer');
  if (d.os === 'android') {
    if (d.androidApiLevel < ANDROID_MIN_API_VOICE_FOLLOW || !d.recognizerCanPersistAudio) return no('os_too_old');
    // Muxing the recognizer's audio back into the video needs the native module.
    if (!d.mediaModuleAvailable) return no('native_module_missing');
  }
  if (!d.recognitionAvailable) return no('no_recognizer');
  return yes;
}

export function captionsSupport(d: DeviceFacts, f: FeatureFlags): Support {
  if (!f.captions) return no('flag_off');
  if (d.os === 'other') return no('no_recognizer');
  if (d.os === 'android') {
    if (d.androidApiLevel < ANDROID_MIN_API_CAPTIONS) return no('os_too_old');
    if (!d.mediaModuleAvailable) return no('native_module_missing');
  }
  if (!d.recognitionAvailable) return no('no_recognizer');
  return yes;
}

export function burnInSupport(d: DeviceFacts, f: FeatureFlags): Support {
  if (!f.burnIn) return no('flag_off');
  if (d.os === 'other') return no('native_module_missing');
  return d.mediaModuleAvailable ? yes : no('native_module_missing');
}
