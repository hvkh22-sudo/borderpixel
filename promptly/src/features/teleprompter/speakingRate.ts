/**
 * Learned speaking rate: a robust personal words-per-minute estimate built
 * from completed takes. Pure and deterministic (time is injected).
 *
 * Only takes that measure the creator's real pace are learned from:
 *  - Voice Follow: words the aligner actually advanced through, over the time
 *    between the first and the last advance (segments split at manual jumps).
 *  - Timed: only when the prompter reached the end of the script without the
 *    creator dragging it; words = whole script, time = time spent scrolling.
 * Manual-scroll takes are never learned from.
 *
 * The estimate is an exponentially weighted median of the most recent valid
 * samples, so one odd take (a long pause, a fumbled start) cannot move it much.
 */
import { DEFAULT_SPEAKING_WPM } from '../voice-follow/text';
import { clampWpm } from './scrollModel';

export const MIN_LEARNED_WPM = 80;
export const MAX_LEARNED_WPM = 240;
/** Takes shorter than this are ignored (too noisy). */
export const MIN_SAMPLE_MS = 10_000;
/** Fewer words than this cannot give a stable rate. */
export const MIN_SAMPLE_WORDS = 15;
/** Raw rates outside this band are measurement errors, not a speaking style. */
const PLAUSIBLE_MIN_WPM = 40;
const PLAUSIBLE_MAX_WPM = 400;
/** Most recent samples kept. */
export const MAX_SAMPLES = 12;
/** Valid samples needed before the estimate is shown or used. */
export const MIN_SAMPLES_FOR_ESTIMATE = 2;
/** Weight of each older sample relative to the next newer one. */
const DECAY = 0.8;

export type RateSource = 'voice' | 'timed';

export interface RateSample {
  wpm: number;
  /** Epoch ms when the take was completed. */
  at: number;
  source: RateSource;
}

export interface SpeakingRateHistory {
  version: 1;
  /** Oldest first. */
  samples: RateSample[];
}

export const EMPTY_RATE_HISTORY: SpeakingRateHistory = { version: 1, samples: [] };

/** Words over time → WPM, or null when the measurement is not trustworthy. */
export function measureWpm(words: number, durationMs: number): number | null {
  if (!Number.isFinite(words) || !Number.isFinite(durationMs)) return null;
  if (durationMs < MIN_SAMPLE_MS || words < MIN_SAMPLE_WORDS) return null;
  const raw = (words / durationMs) * 60_000;
  if (raw < PLAUSIBLE_MIN_WPM || raw > PLAUSIBLE_MAX_WPM) return null;
  return clampLearned(raw);
}

export function clampLearned(wpm: number): number {
  return Math.min(MAX_LEARNED_WPM, Math.max(MIN_LEARNED_WPM, wpm));
}

// ---------- Voice Follow pace tracking ----------

interface Segment {
  startCursor: number;
  startAt: number;
  lastCursor: number;
  lastAt: number;
}

/**
 * Accumulates aligner progress during a take. Feed it every cursor change;
 * call `breakPaceSegment` before a manual jump (tap-to-resync, restart) so the
 * jump itself is never counted as spoken words.
 */
export interface PaceTracker {
  words: number;
  ms: number;
  segment: Segment | null;
  /** The next cursor change is a manual jump: start a fresh segment there. */
  broken: boolean;
}

export function createPaceTracker(): PaceTracker {
  return { words: 0, ms: 0, segment: null, broken: false };
}

function closeSegment(t: PaceTracker): PaceTracker {
  if (!t.segment) return t;
  const s = t.segment;
  return { ...t, words: t.words + Math.max(0, s.lastCursor - s.startCursor), ms: t.ms + Math.max(0, s.lastAt - s.startAt), segment: null };
}

export function trackCursor(t: PaceTracker, cursor: number, at: number): PaceTracker {
  if (cursor < 0) return t;
  if (t.broken || !t.segment) {
    const closed = closeSegment(t);
    return { ...closed, broken: false, segment: { startCursor: cursor, startAt: at, lastCursor: cursor, lastAt: at } };
  }
  if (cursor > t.segment.lastCursor) return { ...t, segment: { ...t.segment, lastCursor: cursor, lastAt: at } };
  if (cursor < t.segment.lastCursor) {
    // Backward move without a manual jump (aligner re-anchored): restart the segment.
    const closed = closeSegment(t);
    return { ...closed, segment: { startCursor: cursor, startAt: at, lastCursor: cursor, lastAt: at } };
  }
  return t;
}

export function breakPaceSegment(t: PaceTracker): PaceTracker {
  return { ...closeSegment(t), broken: true };
}

export function paceTotals(t: PaceTracker): { words: number; ms: number } {
  const c = closeSegment(t);
  return { words: c.words, ms: c.ms };
}

export function voiceSample(t: PaceTracker, now: number): RateSample | null {
  const { words, ms } = paceTotals(t);
  const wpm = measureWpm(words, ms);
  return wpm == null ? null : { wpm, at: now, source: 'voice' };
}

export interface TimedTakeStats {
  scriptWords: number;
  /** Time the prompter was actually scrolling (pauses excluded). */
  playedMs: number;
  reachedEnd: boolean;
  /** Creator dragged or restarted the prompter during the take. */
  manualScroll: boolean;
}

export function timedSample(s: TimedTakeStats, now: number): RateSample | null {
  if (!s.reachedEnd || s.manualScroll) return null;
  const wpm = measureWpm(s.scriptWords, s.playedMs);
  return wpm == null ? null : { wpm, at: now, source: 'timed' };
}

// ---------- History + estimate ----------

export function addSample(history: SpeakingRateHistory, sample: RateSample): SpeakingRateHistory {
  return { version: 1, samples: [...history.samples, sample].slice(-MAX_SAMPLES) };
}

/** Exponentially weighted median of the samples (newest weighs most). */
export function weightedMedian(samples: readonly RateSample[]): number | null {
  if (samples.length === 0) return null;
  const n = samples.length;
  const weighted = samples.map((s, i) => ({ wpm: s.wpm, w: Math.pow(DECAY, n - 1 - i) })).sort((a, b) => a.wpm - b.wpm);
  const total = weighted.reduce((sum, x) => sum + x.w, 0);
  let acc = 0;
  for (const x of weighted) {
    acc += x.w;
    if (acc >= total / 2) return x.wpm;
  }
  return weighted[weighted.length - 1]!.wpm;
}

/** Personal estimate (rounded WPM), or null without enough data. */
export function estimateWpm(history: SpeakingRateHistory): number | null {
  if (history.samples.length < MIN_SAMPLES_FOR_ESTIMATE) return null;
  const m = weightedMedian(history.samples);
  return m == null ? null : Math.round(clampLearned(m));
}

/** WPM for duration estimates: personal pace when known, else the default. */
export function durationWpm(history: SpeakingRateHistory): number {
  return estimateWpm(history) ?? DEFAULT_SPEAKING_WPM;
}

/** Personal pace as a Timed-mode speed (steps of 10, within prompter limits). */
export function suggestedTimedWpm(history: SpeakingRateHistory): number | null {
  const e = estimateWpm(history);
  return e == null ? null : clampWpm(e);
}

/** Validates persisted data; anything malformed is dropped, never thrown. */
export function parseRateHistory(raw: unknown): SpeakingRateHistory {
  if (!raw || typeof raw !== 'object') return EMPTY_RATE_HISTORY;
  const samples = (raw as { samples?: unknown }).samples;
  if (!Array.isArray(samples)) return EMPTY_RATE_HISTORY;
  const valid = samples.filter(
    (s): s is RateSample =>
      !!s &&
      typeof s === 'object' &&
      typeof (s as RateSample).wpm === 'number' &&
      Number.isFinite((s as RateSample).wpm) &&
      typeof (s as RateSample).at === 'number' &&
      ((s as RateSample).source === 'voice' || (s as RateSample).source === 'timed'),
  );
  return { version: 1, samples: valid.map((s) => ({ ...s, wpm: clampLearned(s.wpm) })).slice(-MAX_SAMPLES) };
}
