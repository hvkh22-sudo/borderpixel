/**
 * Caption pipeline (pure stages):
 *   recognizer output → TimedWord[] → (optional) script-aware correction
 *   → segmentation into Cue[] → user edits → SRT / burn-in.
 *
 * A transcript is not a subtitle file: timing, segmentation and readability
 * rules live here, independent of the speech engine.
 */

import { normalizeWord, tokenize, wordSimilarity } from '../voice-follow/text';

export interface TimedWord {
  text: string;
  startMs: number;
  endMs: number;
  /** Recognizer confidence 0..1, or -1 when unavailable. */
  confidence: number;
}

/** Measured timing of one word inside a cue (absolute ms in the take). */
export interface CueWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface Cue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  /**
   * Per-word timing, present only when the recognizer reported real word
   * timing (never for estimated timing). One entry per space-separated token
   * of `text`; editing the text drops it. Optional: older saved captions have none.
   */
  words?: CueWord[];
}

/** Recognizer segment as delivered by platform engines (may be a word or a phrase). */
export interface RecognizedSegment {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface SegmentationOptions {
  /** Max characters per cue (single line, vertical video). */
  maxChars: number;
  maxWords: number;
  maxDurationMs: number;
  minDurationMs: number;
  /** A pause longer than this always starts a new cue. */
  pauseBreakMs: number;
}

export const VERTICAL_SEGMENTATION: SegmentationOptions = {
  maxChars: 28,
  maxWords: 5,
  maxDurationMs: 2800,
  minDurationMs: 600,
  pauseBreakMs: 450,
};

export const LANDSCAPE_SEGMENTATION: SegmentationOptions = {
  maxChars: 42,
  maxWords: 9,
  maxDurationMs: 4500,
  minDurationMs: 800,
  pauseBreakMs: 600,
};

/**
 * Recognizers return either word-level or phrase-level segments. Phrase
 * segments are split into words with time distributed by character length —
 * an approximation flagged by `confidence = -1` so the UI can avoid offering
 * word-by-word highlighting on estimated timings.
 */
export function segmentsToWords(segments: RecognizedSegment[]): TimedWord[] {
  const words: TimedWord[] = [];
  for (const seg of segments) {
    const parts = seg.text.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    if (parts.length === 1) {
      words.push({ text: parts[0]!, startMs: seg.startMs, endMs: seg.endMs, confidence: seg.confidence });
      continue;
    }
    const totalChars = parts.reduce((s, p) => s + p.length, 0);
    const span = Math.max(0, seg.endMs - seg.startMs);
    let t = seg.startMs;
    for (const p of parts) {
      const d = (span * p.length) / totalChars;
      words.push({ text: p, startMs: Math.round(t), endMs: Math.round(t + d), confidence: -1 });
      t += d;
    }
  }
  return words.sort((a, b) => a.startMs - b.startMs);
}

export function hasWordLevelTiming(words: TimedWord[]): boolean {
  return words.length > 0 && words.every((w) => w.confidence !== -1);
}

const SENTENCE_END = /[.!?…]["')\]]?$/;
const CLAUSE_END = /[,;:—–]$/;

export function segmentWords(words: TimedWord[], opts: SegmentationOptions = VERTICAL_SEGMENTATION): Cue[] {
  const cues: Cue[] = [];
  let current: TimedWord[] = [];
  // Word timings are kept only when every word was timed by the engine.
  const keepWords = hasWordLevelTiming(words) && words.every((w) => !/\s/.test(w.text.trim()) && w.text.trim().length > 0);

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;
    const cue: Cue = {
      id: `c${cues.length + 1}`,
      startMs: first.startMs,
      endMs: Math.max(last.endMs, first.startMs + opts.minDurationMs),
      text: current.map((w) => w.text).join(' '),
    };
    if (keepWords) cue.words = current.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs }));
    cues.push(cue);
    current = [];
  };

  for (const w of words) {
    if (current.length > 0) {
      const prev = current[current.length - 1]!;
      const first = current[0]!;
      const text = current.map((x) => x.text).join(' ');
      const wouldBeChars = text.length + 1 + w.text.length;
      const pause = w.startMs - prev.endMs;
      const breakNow =
        pause >= opts.pauseBreakMs ||
        SENTENCE_END.test(prev.text) ||
        current.length >= opts.maxWords ||
        wouldBeChars > opts.maxChars ||
        w.endMs - first.startMs > opts.maxDurationMs ||
        (CLAUSE_END.test(prev.text) && current.length >= 2);
      if (breakNow) flush();
    }
    current.push(w);
  }
  flush();
  return fixOverlaps(cues);
}

/** Ensures cues are ordered and non-overlapping (min-duration padding can overlap). */
export function fixOverlaps(cues: Cue[]): Cue[] {
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (a.endMs > b.startMs) sorted[i] = { ...a, endMs: Math.max(a.startMs + 1, b.startMs) };
  }
  return sorted;
}

/**
 * Script-aware correction: when the creator read from a known script, replace
 * recognized words with the script's spelling where they align confidently.
 * Uses global alignment (Needleman–Wunsch) between transcript and script.
 * Words the speaker ad-libbed (no aligned script word) are kept as recognized —
 * we never invent dialogue that was not spoken.
 */
export function correctWithScript(words: TimedWord[], script: string, minSimilarity = 0.6): TimedWord[] {
  const scriptTokens = tokenize(script);
  if (words.length === 0 || scriptTokens.length === 0) return words;
  const spoken = words.map((w) => normalizeWord(w.text.replace(/[^\p{L}\p{N}'’-]/gu, '')));
  const target = scriptTokens.map((t) => t.norm);
  const m = spoken.length;
  const n = target.length;
  const GAP = -1;
  const width = n + 1;
  const dp = new Float64Array((m + 1) * width);
  const back = new Uint8Array((m + 1) * width); // 0 diag, 1 up (skip spoken), 2 left (skip script)
  for (let i = 1; i <= m; i++) {
    dp[i * width] = i * GAP;
    back[i * width] = 1;
  }
  // Leading script words the speaker never said are free (they may have started mid-script).
  for (let j = 1; j <= n; j++) {
    dp[j] = 0;
    back[j] = 2;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sim = wordSimilarity(spoken[i - 1]!, target[j - 1]!);
      const diag = dp[(i - 1) * width + j - 1]! + (sim >= minSimilarity ? 2 * sim : -1);
      const up = dp[(i - 1) * width + j]! + GAP;
      // Skipped script words cost less than inserted speech (speakers skip lines).
      const left = dp[i * width + j - 1]! + (i === m ? 0 : GAP * 0.5);
      let best = diag;
      let dir = 0;
      if (up > best) {
        best = up;
        dir = 1;
      }
      if (left > best) {
        best = left;
        dir = 2;
      }
      dp[i * width + j] = best;
      back[i * width + j] = dir;
    }
  }
  const out = words.map((w) => ({ ...w }));
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const dir = back[i * width + j];
    if (dir === 0) {
      const sim = wordSimilarity(spoken[i - 1]!, target[j - 1]!);
      if (sim >= minSimilarity) {
        const tok = scriptTokens[j - 1]!;
        const scriptWord = script.slice(tok.start, tok.end);
        out[i - 1] = { ...out[i - 1]!, text: preservePunctuation(words[i - 1]!.text, scriptWord, script, tok.end) };
      }
      i--;
      j--;
    } else if (dir === 1) {
      i--;
    } else {
      j--;
    }
  }
  return out;
}

/** Keep the script's trailing punctuation (it drives segmentation). */
function preservePunctuation(recognized: string, scriptWord: string, script: string, endOffset: number): string {
  const trailing = /^[.,!?;:…]+/.exec(script.slice(endOffset))?.[0] ?? '';
  if (trailing) return scriptWord + trailing;
  const recognizedTrailing = /[.,!?;:…]+$/.exec(recognized)?.[0] ?? '';
  return scriptWord + recognizedTrailing;
}

// ---------- Editing operations (immutable) ----------

/** Editing a cue's text invalidates its word timings (no highlight for that cue). */
export function updateCueText(cues: Cue[], id: string, text: string): Cue[] {
  return cues.map((c) => {
    if (c.id !== id) return c;
    // Whitespace is collapsed but not trimmed while typing: a trailing space is how the next word
    // starts (trimming it would glue words together). normalizeCueTexts trims on save.
    const next = text.replace(/\s+/g, ' ');
    if (next === c.text) return c;
    const { words: _dropped, ...rest } = c;
    return { ...rest, text: next };
  });
}

/** True when the cue's word timings still line up 1:1 with its text tokens. */
export function cueHasWordTiming(cue: Cue): cue is Cue & { words: CueWord[] } {
  return !!cue.words && cue.words.length > 0 && cue.words.length === cue.text.split(' ').length;
}

/**
 * Index of the word to highlight at `timeMs`: the last word that has started.
 * Between words the previous one stays lit (avoids flicker). -1 before the
 * first word or when the cue has no valid word timing.
 */
export function activeWordIndex(cue: Cue, timeMs: number): number {
  if (!cueHasWordTiming(cue)) return -1;
  let idx = -1;
  for (let i = 0; i < cue.words.length; i++) {
    if (cue.words[i]!.startMs <= timeMs) idx = i;
    else break;
  }
  return idx;
}

/** Drops malformed word timing from untrusted (saved) cue JSON. */
export function sanitizeCue(raw: Cue): Cue {
  const { words, ...rest } = raw;
  const ok =
    Array.isArray(words) &&
    words.every((w) => w && typeof w.text === 'string' && Number.isFinite(w.startMs) && Number.isFinite(w.endMs));
  const cue: Cue = { ...rest };
  if (ok && words!.length > 0) cue.words = words!.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs }));
  return cueHasWordTiming(cue) ? cue : { ...rest };
}

export function deleteCue(cues: Cue[], id: string): Cue[] {
  return cues.filter((c) => c.id !== id);
}

/** Shift a single cue's timing while keeping it inside its neighbours. */
export function retimeCue(cues: Cue[], id: string, startMs: number, endMs: number): Cue[] {
  const i = cues.findIndex((c) => c.id === id);
  if (i < 0) return cues;
  const prevEnd = i > 0 ? cues[i - 1]!.endMs : 0;
  const nextStart = i < cues.length - 1 ? cues[i + 1]!.startMs : Number.POSITIVE_INFINITY;
  const s = Math.max(prevEnd, Math.round(startMs));
  const e = Math.min(nextStart, Math.round(endMs));
  if (e - s < 100) return cues;
  const next = [...cues];
  const old = cues[i]!;
  const d = s - old.startMs;
  next[i] = { ...old, startMs: s, endMs: e, ...(old.words ? { words: shiftWords(old.words, d) } : {}) };
  return next;
}

/**
 * Shift every cue by a constant offset (fixes global A/V caption drift). An earlier shift stops when
 * the first cue reaches 0, so cues are never dropped or squashed and a shift back restores them.
 */
export function shiftAll(cues: Cue[], deltaMs: number): Cue[] {
  if (cues.length === 0) return cues;
  const earliest = Math.min(...cues.map((c) => c.startMs));
  const d = Math.max(deltaMs, -earliest);
  if (d === 0) return cues;
  return cues.map((c) => ({ ...c, startMs: c.startMs + d, endMs: c.endMs + d, ...(c.words ? { words: shiftWords(c.words, d) } : {}) }));
}

/** Trims cue text for saving (editing keeps a trailing space so the next word can be typed). */
export function normalizeCueTexts(cues: Cue[]): Cue[] {
  return cues.map((c) => (c.text === c.text.trim() ? c : { ...c, text: c.text.trim() }));
}

function shiftWords(words: CueWord[], deltaMs: number): CueWord[] {
  return words.map((w) => ({ ...w, startMs: Math.max(0, w.startMs + deltaMs), endMs: Math.max(0, w.endMs + deltaMs) }));
}

export function mergeWithNext(cues: Cue[], id: string): Cue[] {
  const i = cues.findIndex((c) => c.id === id);
  if (i < 0 || i >= cues.length - 1) return cues;
  const a = cues[i]!;
  const b = cues[i + 1]!;
  const merged: Cue = { id: a.id, startMs: a.startMs, endMs: b.endMs, text: `${a.text} ${b.text}` };
  if (cueHasWordTiming(a) && cueHasWordTiming(b)) merged.words = [...a.words, ...b.words];
  return [...cues.slice(0, i), merged, ...cues.slice(i + 2)];
}

/** Split a cue at a word boundary; time is divided proportionally to characters. */
export function splitCue(cues: Cue[], id: string, atWord: number): Cue[] {
  const i = cues.findIndex((c) => c.id === id);
  if (i < 0) return cues;
  const c = cues[i]!;
  const words = c.text.split(' ');
  if (atWord <= 0 || atWord >= words.length) return cues;
  const left = words.slice(0, atWord).join(' ');
  const right = words.slice(atWord).join(' ');
  const timed = cueHasWordTiming(c);
  // With measured word timing, split exactly where the right-hand word starts.
  const splitMs = timed
    ? Math.min(c.endMs - 1, Math.max(c.startMs + 1, c.words[atWord]!.startMs))
    : Math.round(c.startMs + ((c.endMs - c.startMs) * left.length) / (left.length + right.length));
  const usedIds = new Set(cues.map((x) => x.id));
  let n = cues.length + 1;
  while (usedIds.has(`c${n}`)) n++;
  const { words: _w, ...base } = c;
  const leftCue: Cue = { ...base, endMs: splitMs, text: left };
  const rightCue: Cue = { id: `c${n}`, startMs: splitMs, endMs: c.endMs, text: right };
  if (timed) {
    leftCue.words = c.words.slice(0, atWord);
    rightCue.words = c.words.slice(atWord);
  }
  return [...cues.slice(0, i), leftCue, rightCue, ...cues.slice(i + 1)];
}

export function cueAt(cues: Cue[], timeMs: number): Cue | undefined {
  return cues.find((c) => timeMs >= c.startMs && timeMs < c.endMs);
}

// ---------- SRT ----------

export function formatSrtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const msPart = total % 1000;
  const pad = (v: number, l = 2) => String(v).padStart(l, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(msPart, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return (
    cues
      .filter((c) => c.text.trim().length > 0)
      .map((c, i) => `${i + 1}\n${formatSrtTime(c.startMs)} --> ${formatSrtTime(c.endMs)}\n${c.text.trim()}\n`)
      .join('\n')
  );
}

const SRT_TIME = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

function parseSrtTime(s: string): number {
  const m = SRT_TIME.exec(s);
  if (!m) throw new Error(`Invalid SRT timestamp: ${s}`);
  return Number(m[1]) * 3_600_000 + Number(m[2]) * 60_000 + Number(m[3]) * 1000 + Number(m[4]);
}

export function parseSrt(srt: string): Cue[] {
  const blocks = srt.replace(/\r/g, '').trim().split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx < 0) continue;
    const [a, b] = lines[timeLineIdx]!.split('-->');
    cues.push({
      id: `c${cues.length + 1}`,
      startMs: parseSrtTime(a!.trim()),
      endMs: parseSrtTime(b!.trim()),
      text: lines.slice(timeLineIdx + 1).join(' ').trim(),
    });
  }
  return cues;
}

/** Quality signal shown to the user instead of silently presenting bad captions. */
export interface TranscriptQuality {
  wordCount: number;
  lowConfidenceRatio: number;
  hasSpeech: boolean;
}

export function assessTranscript(words: TimedWord[]): TranscriptQuality {
  const known = words.filter((w) => w.confidence >= 0);
  const low = known.filter((w) => w.confidence < 0.5).length;
  return {
    wordCount: words.length,
    lowConfidenceRatio: known.length ? low / known.length : 0,
    hasSpeech: words.length > 0,
  };
}

/**
 * Fallback when the engine returns a transcript without segment timing:
 * spread words evenly over the speech span. Marked as estimated (-1).
 */
export function estimateWordsFromTranscript(transcript: string, startMs: number, endMs: number): TimedWord[] {
  const parts = transcript.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || endMs <= startMs) return [];
  return segmentsToWords([{ text: parts.join(' '), startMs, endMs, confidence: -1 }]).map((w) => ({ ...w, confidence: -1 }));
}
