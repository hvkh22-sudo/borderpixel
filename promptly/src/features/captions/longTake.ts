/**
 * Long-take transcription helpers (pure). On-device recognizers can stop
 * early or fail on long audio, so on Android the decoded WAV is split into
 * ~50 s chunks with a small overlap, each chunk is recognized on its own, and
 * the results are offset back onto the take's timeline and de-duplicated here.
 * On iOS a single request is kept and a premature end is reported as a gap.
 */
import { normalizeWord } from '../voice-follow/text';
import type { RecognizedSegment } from './captions';

export const CHUNK_MS = 50_000;
export const CHUNK_OVERLAP_MS = 1_000;
/** A take ending more than this after the last recognized word may have been cut short. */
export const PREMATURE_END_SLACK_MS = 3_000;

export interface ChunkPlan {
  index: number;
  startMs: number;
  endMs: number;
}

/** Chunks of `chunkMs` that each start `overlapMs` before the previous one ends. */
export function planChunks(durationMs: number, chunkMs = CHUNK_MS, overlapMs = CHUNK_OVERLAP_MS): ChunkPlan[] {
  if (durationMs <= 0) return [];
  // A short tail is folded into the last chunk rather than recognized alone.
  if (durationMs <= chunkMs + overlapMs * 2) return [{ index: 0, startMs: 0, endMs: durationMs }];
  const step = chunkMs - overlapMs;
  const plans: ChunkPlan[] = [];
  for (let start = 0; start < durationMs; start += step) {
    let end = Math.min(durationMs, start + chunkMs);
    if (durationMs - end < 5_000) end = durationMs;
    plans.push({ index: plans.length, startMs: start, endMs: end });
    if (end >= durationMs) break;
  }
  return plans;
}

/** Moves chunk-relative segment times onto the take's timeline. */
export function offsetSegments(segments: RecognizedSegment[], offsetMs: number): RecognizedSegment[] {
  return segments.map((s) => ({ ...s, startMs: s.startMs + offsetMs, endMs: s.endMs + offsetMs }));
}

export interface ChunkResult {
  startMs: number;
  endMs: number;
  /** Segments already on the take's timeline. */
  segments: RecognizedSegment[];
}

const mid = (s: RecognizedSegment) => (s.startMs + s.endMs) / 2;
const norm = (s: RecognizedSegment) => normalizeWord(s.text.replace(/[^\p{L}\p{N}'’-]/gu, ''));

/**
 * Joins chunk results. Each overlap is cut at its midpoint: a segment belongs
 * to the chunk containing its midpoint. A word repeated across the cut (both
 * engines heard it, with slightly different timing) is kept once.
 */
export function mergeChunkResults(chunks: ChunkResult[]): RecognizedSegment[] {
  const sorted = [...chunks].sort((a, b) => a.startMs - b.startMs);
  const out: RecognizedSegment[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const from = prev && prev.endMs > c.startMs ? (c.startMs + prev.endMs) / 2 : Number.NEGATIVE_INFINITY;
    const to = next && c.endMs > next.startMs ? (next.startMs + c.endMs) / 2 : Number.POSITIVE_INFINITY;
    const kept = c.segments.filter((s) => mid(s) >= from && mid(s) < to).sort((a, b) => a.startMs - b.startMs);
    const first = kept[0];
    const last = out[out.length - 1];
    if (first && last && norm(first) !== '' && norm(first) === norm(last) && first.startMs - last.endMs < 400) {
      kept.shift();
    }
    out.push(...kept);
  }
  return out;
}

export interface TranscriptGap {
  startMs: number;
  endMs: number;
  /** stopped_early: engine ended before the take did (iOS); failed: a part errored (Android). */
  reason: 'stopped_early' | 'failed';
}

/**
 * iOS single-request check: if the last recognized segment ends well before
 * the take does, the engine may have stopped early. Reported as a gap; the
 * caller tells the user instead of inventing text.
 */
export function detectPrematureEnd(segments: RecognizedSegment[], durationMs: number, slackMs = PREMATURE_END_SLACK_MS): TranscriptGap | null {
  if (segments.length === 0 || durationMs <= 0) return null;
  const lastEnd = Math.max(...segments.map((s) => s.endMs));
  return lastEnd < durationMs - slackMs ? { startMs: Math.round(lastEnd), endMs: Math.round(durationMs), reason: 'stopped_early' } : null;
}

// ---------- WAV (mono/stereo PCM) ----------

export interface WavFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Byte offset of the PCM data. */
  dataOffset: number;
  dataBytes: number;
}

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

/** Parses a RIFF/WAVE header, walking chunks until `data`. Needs the first ~100 bytes. */
export function parseWavHeader(bytes: Uint8Array, fileSize = bytes.length): WavFormat {
  if (bytes.length < 12 || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WAVE') throw new Error('Not a WAV file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 12;
  let fmt: Omit<WavFormat, 'dataOffset' | 'dataBytes'> | null = null;
  while (pos + 8 <= bytes.length) {
    const id = ascii(bytes, pos);
    const size = view.getUint32(pos + 4, true);
    if (id === 'fmt ') {
      if (size < 16 || pos + 24 > bytes.length) throw new Error('WAV fmt chunk truncated');
      fmt = { channels: view.getUint16(pos + 10, true), sampleRate: view.getUint32(pos + 12, true), bitsPerSample: view.getUint16(pos + 22, true) };
      if (fmt.channels < 1 || fmt.sampleRate < 1 || fmt.bitsPerSample < 8 || fmt.bitsPerSample % 8 !== 0) throw new Error('Unsupported WAV format');
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data before fmt');
      const dataOffset = pos + 8;
      // Streamed writers may leave size 0 / 0xFFFFFFFF; trust the file size then.
      // fileSize <= 0 means unknown (e.g. a file handle without a size): trust the header.
      const available = fileSize > 0 ? Math.max(0, fileSize - dataOffset) : Number.POSITIVE_INFINITY;
      const raw = size === 0 || size > available ? (Number.isFinite(available) ? available : size) : size;
      // Keep whole sample frames so chunk ranges stay aligned.
      const frame = (fmt.channels * fmt.bitsPerSample) / 8;
      return { ...fmt, dataOffset, dataBytes: raw - (raw % frame) };
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error('WAV data chunk not found');
}

/** Canonical 44-byte PCM WAV header. */
export function wavHeader(dataBytes: number, sampleRate: number, channels = 1, bitsPerSample = 16): Uint8Array {
  const b = new Uint8Array(44);
  const v = new DataView(b.buffer);
  const put = (at: number, s: string) => [...s].forEach((ch, i) => (b[at + i] = ch.charCodeAt(0)));
  const blockAlign = (channels * bitsPerSample) / 8;
  put(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitsPerSample, true);
  put(36, 'data');
  v.setUint32(40, dataBytes, true);
  return b;
}

/** Byte range (absolute in the file, frame-aligned) of a chunk's PCM data. */
export function chunkByteRange(chunk: ChunkPlan, fmt: WavFormat): { offset: number; length: number } {
  const frame = (fmt.channels * fmt.bitsPerSample) / 8;
  const toBytes = (ms: number) => Math.floor((ms * fmt.sampleRate) / 1000) * frame;
  const start = Math.min(fmt.dataBytes, toBytes(chunk.startMs));
  const end = Math.min(fmt.dataBytes, toBytes(chunk.endMs));
  return { offset: fmt.dataOffset + start, length: Math.max(0, end - start) };
}

export function wavDurationMs(fmt: WavFormat): number {
  return (fmt.dataBytes / ((fmt.channels * fmt.bitsPerSample) / 8) / fmt.sampleRate) * 1000;
}
