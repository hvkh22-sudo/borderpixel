/**
 * Timing of a take's separately recorded audio (Voice Follow on Android / iOS "separate"), kept next
 * to the video as `take_X_audio.json`. It is written while recording (each recognizer session's
 * start) and again by finalizeTake when the merge fails, so a take saved without sound can have its
 * audio merged later with the right offsets. No speech, text or personal data: file names and times.
 */

export interface AudioTimingSegment {
  /** File name in the recordings directory (`take_X_audio_N.wav`). */
  file: string;
  /** Epoch ms when capture of this file started. */
  startedAt: number;
}

export interface AudioTiming {
  version: 1;
  /** Epoch ms when the video started recording. */
  recordingStartedAt: number;
  segments: AudioTimingSegment[];
}

/** `take_X.mp4` / `take_X_av.mp4` → `take_X_audio.json`. */
export function audioTimingFileName(takeFileName: string): string {
  return `${takeFileName.replace(/(_av)?\.(mp4|mov)$/i, '')}_audio.json`;
}

export function serializeAudioTiming(t: AudioTiming): string {
  return JSON.stringify(t);
}

/** Null for anything that is not a well-formed timing file (never throws). */
export function parseAudioTiming(raw: string): AudioTiming | null {
  try {
    const v = JSON.parse(raw) as Partial<AudioTiming>;
    if (v?.version !== 1 || typeof v.recordingStartedAt !== 'number' || !Array.isArray(v.segments)) return null;
    const segments = v.segments.filter(
      (s): s is AudioTimingSegment =>
        !!s && typeof s.file === 'string' && /^[\w.-]+\.wav$/i.test(s.file) && !s.file.includes('..') && typeof s.startedAt === 'number' && Number.isFinite(s.startedAt),
    );
    return { version: 1, recordingStartedAt: v.recordingStartedAt, segments };
  } catch {
    return null;
  }
}

/** Adds or updates one segment (by file), keeping them in capture order. */
export function withSegment(t: AudioTiming, seg: AudioTimingSegment): AudioTiming {
  const others = t.segments.filter((s) => s.file !== seg.file);
  return { ...t, segments: [...others, seg].sort((a, b) => a.startedAt - b.startedAt) };
}

/** Mux input: each existing segment with its offset from the video start (ms, may be negative). */
export function muxSegments(t: AudioTiming, exists: (file: string) => boolean): { file: string; offsetMs: number }[] {
  return t.segments.filter((s) => exists(s.file)).map((s) => ({ file: s.file, offsetMs: s.startedAt - t.recordingStartedAt }));
}
