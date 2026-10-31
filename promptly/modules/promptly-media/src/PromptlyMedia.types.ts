/** Contract shared by the iOS (AVFoundation) and Android (Media3) implementations. */

/** Timing of the i-th space-separated token of `NativeCue.text`. */
export interface NativeWordTiming {
  startMs: number;
  endMs: number;
}

export interface NativeCue {
  startMs: number;
  endMs: number;
  text: string;
  /**
   * Optional per-word timing (one per space-separated token of `text`). When
   * present and the style has a highlightColor, the word being spoken is drawn
   * in that colour. Natives ignore it when the counts do not match.
   */
  words?: NativeWordTiming[];
}

export interface NativeCaptionStyle {
  fontWeight: '600' | '800' | '900';
  fontSizeRatio: number;
  textColor: string;
  backgroundColor: string | null;
  strokeColor: string | null;
  strokeWidthRatio: number;
  uppercase: boolean;
  /** Colour of the active word when cues carry word timing; null/absent = no highlight. */
  highlightColor?: string | null;
  /** Vertical centre of the caption block, as a fraction of video height. */
  positionY: number;
}

export interface VideoInfo {
  width: number;
  height: number;
  durationMs: number;
  /** Display rotation in degrees applied by the container metadata. */
  rotation: number;
  hasAudio: boolean;
}

export interface AudioSegment {
  uri: string;
  offsetMs: number;
}

export interface WavResult {
  uri: string;
  sampleRate: number;
  durationMs: number;
}

export interface ProgressEvent {
  jobId: string;
  progress: number;
}

/**
 * A hardware key from a Bluetooth page-turner or keyboard (record screen only).
 * `key` is a W3C-style name: ArrowUp/Down/Left/Right, PageUp, PageDown, Space,
 * Enter, and on Android also MediaPlayPause, MediaTrackNext, MediaTrackPrevious.
 */
export interface RemoteKeyNativeEvent {
  key: string;
  /** Auto-repeat while held (Android `repeatCount > 0`; always false on iOS). */
  repeat: boolean;
}

export interface PromptlyMediaNativeModule {
  getVideoInfo(uri: string): Promise<VideoInfo>;
  /** Renders captions onto a copy of the video. Never modifies the input. */
  burnInCaptions(jobId: string, inputUri: string, outputUri: string, cues: NativeCue[], style: NativeCaptionStyle): Promise<string>;
  /** Android: decode the audio track to mono 16-bit PCM WAV. */
  extractAudioToWav(inputUri: string, outputUri: string, sampleRate: number): Promise<WavResult>;
  /**
   * Combine a video-only file with audio recorded separately (Voice Follow:
   * always on Android, iOS with the 'separate' audio strategy). Segments are
   * placed at `offsetMs` relative to the video start (negative = the head of the
   * WAV is trimmed); overlaps are trimmed, gaps are filled with silence. Output
   * is .mp4 with AAC audio. With no segments the video is exported as-is.
   */
  muxAudio(jobId: string, videoUri: string, segments: AudioSegment[], outputUri: string): Promise<string>;
  cancel(jobId: string): void;
  /**
   * Start/stop forwarding hardware keys as `onRemoteKey`. While enabled the
   * forwarded keys are consumed (iOS: a hidden first responder; Android: the
   * Activity's unhandled-key callbacks). Absent in builds older than this API.
   */
  setRemoteKeysEnabled?(enabled: boolean): Promise<void> | void;
  /**
   * iOS: whether Apple's recognizer for `locale` can run on the device. Without it, a request that
   * asks for on-device recognition silently uses Apple's servers (expo-speech-recognition applies
   * `requiresOnDeviceRecognition` only when the recognizer supports it). Absent on Android.
   */
  supportsOnDeviceSpeech?(locale: string): boolean;
  addListener(event: 'onProgress', cb: (e: ProgressEvent) => void): { remove(): void };
  addListener(event: 'onRemoteKey', cb: (e: RemoteKeyNativeEvent) => void): { remove(): void };
}
