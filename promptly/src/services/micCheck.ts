/**
 * Platform wrapper for the setup-screen mic check (expo-audio).
 *
 * AUDIO SESSION ORDERING: the mic check and the camera cannot both own the
 * microphone. VisionCamera (and, for Voice Follow, expo-speech-recognition)
 * configure the audio session when the record screen opens, so the mic check
 * must be fully torn down first:
 *   1. recorder.stop()            — releases the mic (Android MediaRecorder is reset)
 *   2. delete the temporary file  — the 3-second clip is a probe, not a user recording
 *   3. allowsRecording: false     — iOS: leave .playAndRecord so the camera re-configures cleanly
 *   4. setIsAudioActiveAsync(false) — iOS: deactivate the session (notify others);
 *                                     Android: abandon audio focus
 * `releaseMicSession()` runs 3–4 and remembers the promise; the setup screen
 * awaits `whenMicReleased()` before navigating to the camera. Whether the
 * camera then records audio from the right input is device test MIC-01.
 */
import { requestRecordingPermissionsAsync, setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import { File } from 'expo-file-system';

let pendingRelease: Promise<void> = Promise.resolve();

export type MicPermission = 'granted' | 'denied' | 'blocked';

export async function ensureMicPermission(): Promise<MicPermission> {
  const res = await requestRecordingPermissionsAsync();
  if (res.granted) return 'granted';
  return res.canAskAgain === false ? 'blocked' : 'denied';
}

/** Activate a record-capable session for the check. Waits for any earlier release first. */
export async function beginMicSession(): Promise<void> {
  await pendingRelease;
  await setIsAudioActiveAsync(true);
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: 'doNotMix' });
}

/** Hand the audio session back. Safe to call more than once; never throws. */
export function releaseMicSession(): Promise<void> {
  pendingRelease = pendingRelease
    .then(async () => {
      await setAudioModeAsync({ allowsRecording: false });
      await setIsAudioActiveAsync(false);
    })
    .catch(() => {
      // A failed deactivation must not block the camera; it re-configures the session itself.
    });
  return pendingRelease;
}

/** Resolves once the last mic check released the audio session. */
export function whenMicReleased(): Promise<void> {
  return pendingRelease;
}

/** Delete the temporary mic-check clip (expo-audio writes it to the cache directory). */
export function deleteMicCheckFile(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Cache files are purged by the OS eventually; a failed delete is harmless.
  }
}
