/**
 * JS facade for the local `promptly-media` Expo module. Uses an optional
 * require so the JS bundle (and tests) work when the native module is not
 * present; callers check isAvailable() and degrade with a clear message.
 */
import { requireOptionalNativeModule } from 'expo';

import type {
  AudioSegment,
  NativeCaptionStyle,
  NativeCue,
  ProgressEvent,
  PromptlyMediaNativeModule,
  RemoteKeyNativeEvent,
  VideoInfo,
  WavResult,
} from '../../modules/promptly-media';
import { exportsDir } from './files';

const native = requireOptionalNativeModule<PromptlyMediaNativeModule>('PromptlyMedia');

function mod(): PromptlyMediaNativeModule {
  if (!native) throw new Error('promptly-media native module is not available in this build');
  return native;
}

let jobCounter = 0;
const newJobId = () => `job${Date.now()}_${++jobCounter}`;

export interface Job<T> {
  id: string;
  promise: Promise<T>;
  cancel(): void;
}

function job<T>(run: (id: string) => Promise<T>, onProgress?: (p: number) => void): Job<T> {
  const id = newJobId();
  const sub = onProgress ? mod().addListener('onProgress', (e: ProgressEvent) => e.jobId === id && onProgress(e.progress)) : null;
  const promise = run(id).finally(() => sub?.remove());
  return { id, promise, cancel: () => mod().cancel(id) };
}

let remoteListeners = 0;

export const PromptlyMedia = {
  isAvailable: () => native != null,

  /** True when this build's native module can forward hardware remote keys. */
  remoteKeysAvailable: () => typeof native?.setRemoteKeysEnabled === 'function',

  /**
   * Forward hardware remote / keyboard keys to `onKey` until the returned
   * function is called. No-op (returns a no-op) when the build lacks support.
   */
  listenRemoteKeys(onKey: (e: RemoteKeyNativeEvent) => void): () => void {
    const m = native;
    if (!m || typeof m.setRemoteKeysEnabled !== 'function') return () => {};
    // iOS returns void, Android a promise; a failure only means the remote stays inactive.
    const setEnabled = (on: boolean) => {
      try {
        void Promise.resolve(m.setRemoteKeysEnabled?.(on)).catch(() => {});
      } catch {
        // Remote control is best effort.
      }
    };
    const sub = m.addListener('onRemoteKey', onKey);
    // Native has one switch: an old screen's late cleanup must not turn keys off for a newer one.
    remoteListeners += 1;
    if (remoteListeners === 1) setEnabled(true);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      sub.remove();
      remoteListeners -= 1;
      if (remoteListeners === 0) setEnabled(false);
    };
  },

  getVideoInfo: (uri: string): Promise<VideoInfo> => mod().getVideoInfo(uri),

  burnInCaptions(inputUri: string, cues: NativeCue[], style: NativeCaptionStyle, onProgress?: (p: number) => void): Job<string> {
    const output = `${exportsDir().uri.replace(/\/$/, '')}/captioned_${Date.now()}.mp4`;
    return job((id) => mod().burnInCaptions(id, inputUri, output, cues, style), onProgress);
  },

  async extractAudioToWav(inputUri: string, sampleRate: number): Promise<WavResult> {
    const output = `${exportsDir().uri.replace(/\/$/, '')}/audio_${Date.now()}.wav`;
    return mod().extractAudioToWav(inputUri, output, sampleRate);
  },

  muxAudio(videoUri: string, segments: AudioSegment[], outputUri: string, onProgress?: (p: number) => void): Job<string> {
    return job((id) => mod().muxAudio(id, videoUri, segments, outputUri), onProgress);
  },
};
