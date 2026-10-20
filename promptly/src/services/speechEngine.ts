/**
 * SpeechEngine implementation over expo-speech-recognition (SFSpeechRecognizer
 * on iOS, android.speech.SpeechRecognizer on Android).
 *
 * IMPORTANT (see docs/architecture/voice-follow.md): running this while the
 * camera records audio is the project's main technical risk. On iOS we keep
 * the shared AVAudioSession in playAndRecord + mixWithOthers so the capture
 * session and the recognizer can share the microphone. On Android, concurrent
 * capture behaviour depends on OS version and recognizer service; Voice Follow
 * must stay behind the `voiceFollow` feature flag until the on-device PoC
 * matrix (docs/testing/device-matrix.md) passes.
 */
import {
  AVAudioSessionCategory,
  AVAudioSessionCategoryOptions,
  AVAudioSessionMode,
  ExpoSpeechRecognitionModule,
} from 'expo-speech-recognition';
import { Platform } from 'react-native';

import type { PersistedAudio, SpeechEngine, SpeechErrorCode, SpeechStartOptions } from '../features/voice-follow/voiceFollowController';

const KNOWN_ERRORS: ReadonlySet<SpeechErrorCode> = new Set([
  'not-allowed',
  'language-not-supported',
  'audio-capture',
  'network',
  'interrupted',
  'service-not-allowed',
]);

/** Errors that are part of normal operation and should restart silently. */
const BENIGN_ERRORS = new Set(['no-speech', 'speech-timeout', 'aborted', 'nomatch']);

export class ExpoSpeechEngine implements SpeechEngine {
  private running = false;
  private lastOptions: SpeechStartOptions | null = null;
  private audioStartedAt = new Map<string, number>();
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  async start(options: SpeechStartOptions): Promise<void> {
    this.lastOptions = options;
    this.running = true;
    this.startNative();
  }

  private startNative(): void {
    const o = this.lastOptions;
    if (!o) return;
    ExpoSpeechRecognitionModule.start({
      lang: o.locale,
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
      // Short, distinctive phrases from the script bias recognition.
      contextualStrings: o.contextualStrings.slice(0, 100),
      requiresOnDeviceRecognition: o.onDevice,
      addsPunctuation: false,
      recordingOptions: o.persistAudio ? { persist: true } : undefined,
      iosTaskHint: 'dictation',
      iosCategory: {
        category: AVAudioSessionCategory.playAndRecord,
        categoryOptions: [
          AVAudioSessionCategoryOptions.mixWithOthers,
          AVAudioSessionCategoryOptions.allowBluetooth,
          AVAudioSessionCategoryOptions.defaultToSpeaker,
        ],
        mode: AVAudioSessionMode.videoRecording,
      },
      androidIntentOptions: {
        EXTRA_LANGUAGE_MODEL: 'free_form',
        // Keep the session open across natural pauses.
        EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 10_000,
        EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 10_000,
      },
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    // stop() (not abort) lets the recognizer finalize persisted audio files.
    ExpoSpeechRecognitionModule.stop();
  }

  onResult(cb: Parameters<SpeechEngine['onResult']>[0]): () => void {
    const sub = ExpoSpeechRecognitionModule.addListener('result', (e) => {
      const best = e.results[0];
      if (best) cb({ transcript: best.transcript, isFinal: e.isFinal });
    });
    return () => sub.remove();
  }

  onError(cb: Parameters<SpeechEngine['onError']>[0]): () => void {
    const sub = ExpoSpeechRecognitionModule.addListener('error', (e) => {
      if (BENIGN_ERRORS.has(e.error)) return;
      const code = KNOWN_ERRORS.has(e.error as SpeechErrorCode) ? (e.error as SpeechErrorCode) : 'unknown';
      this.running = false;
      cb(code, e.message);
    });
    return () => sub.remove();
  }

  onEnd(cb: () => void): () => void {
    const sub = ExpoSpeechRecognitionModule.addListener('end', () => {
      cb();
      // Android (and iOS on long sessions) end sessions on their own; restart
      // quickly so following continues. Position is kept by the aligner.
      if (this.running) {
        this.restartTimer = setTimeout(() => this.running && this.startNative(), Platform.OS === 'android' ? 50 : 150);
      }
    });
    return () => sub.remove();
  }

  onAudioPersisted(cb: (a: PersistedAudio) => void): () => void {
    const start = ExpoSpeechRecognitionModule.addListener('audiostart', (e) => {
      if (e.uri) this.audioStartedAt.set(e.uri, e.timestamp);
    });
    const end = ExpoSpeechRecognitionModule.addListener('audioend', (e) => {
      if (!e.uri) return;
      const startedAt = this.audioStartedAt.get(e.uri);
      this.audioStartedAt.delete(e.uri);
      if (startedAt != null) cb({ uri: e.uri, startedAt });
    });
    return () => {
      start.remove();
      end.remove();
    };
  }
}

export async function ensureSpeechPermission(): Promise<boolean> {
  const current = await ExpoSpeechRecognitionModule.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const res = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  return res.granted;
}

export interface SpeechCapabilities {
  available: boolean;
  onDevice: boolean;
}

export function getSpeechCapabilities(): SpeechCapabilities {
  try {
    return {
      available: ExpoSpeechRecognitionModule.isRecognitionAvailable(),
      onDevice: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
    };
  } catch {
    return { available: false, onDevice: false };
  }
}

/** Distinctive words/phrases from the script to bias the recognizer. */
export function contextualStringsFor(script: string): string[] {
  const words = script.match(/[\p{L}\p{N}'’-]{6,}/gu) ?? [];
  return Array.from(new Set(words.map((w) => w.toLowerCase()))).slice(0, 100);
}
