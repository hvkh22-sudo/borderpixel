/** Contract shared by the iOS (AVFoundation) and Android (Media3) implementations. */

export interface NativeCue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface NativeCaptionStyle {
  fontWeight: '600' | '800' | '900';
  fontSizeRatio: number;
  textColor: string;
  backgroundColor: string | null;
  strokeColor: string | null;
  strokeWidthRatio: number;
  uppercase: boolean;
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

export interface PromptlyMediaNativeModule {
  getVideoInfo(uri: string): Promise<VideoInfo>;
  /** Renders captions onto a copy of the video. Never modifies the input. */
  burnInCaptions(jobId: string, inputUri: string, outputUri: string, cues: NativeCue[], style: NativeCaptionStyle): Promise<string>;
  /** Android: decode the audio track to mono 16-bit PCM WAV. */
  extractAudioToWav(inputUri: string, outputUri: string, sampleRate: number): Promise<WavResult>;
  /**
   * Combine a video-only file with audio recorded separately (Android Voice
   * Follow). Segments are placed at `offsetMs` relative to the video start;
   * gaps are filled with silence.
   */
  muxAudio(jobId: string, videoUri: string, segments: AudioSegment[], outputUri: string): Promise<string>;
  cancel(jobId: string): void;
  addListener(event: 'onProgress', cb: (e: ProgressEvent) => void): { remove(): void };
}
