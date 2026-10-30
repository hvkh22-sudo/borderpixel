/**
 * ScriptAligner — maps a streaming speech-recognition hypothesis onto a
 * position in the script.
 *
 * Design goals (see docs/architecture/voice-follow.md):
 *  - Forward progress is smooth and conservative: small steps need little
 *    evidence, large jumps (skipped sentences) need strong, repeated evidence.
 *  - Backward movement is suppressed unless the speaker clearly restarted an
 *    earlier passage (strong match confirmed by two consecutive updates).
 *  - Recognition errors are tolerated through fuzzy word matching inside a
 *    local (Smith–Waterman style) alignment of the hypothesis tail against a
 *    window of the script around the current cursor.
 *
 * The aligner is pure and synchronous; it knows nothing about audio, React or
 * scrolling. That keeps it fully unit-testable.
 */

import { Token, tokenize, wordSimilarity } from './text';

export interface AlignerConfig {
  /** Number of most recent spoken words used for matching. */
  tailWords: number;
  /** How many script words behind the cursor are searched. */
  backWindow: number;
  /** How many script words ahead of the cursor are searched locally. */
  forwardWindow: number;
  /** Word similarity required for a fuzzy match. */
  minWordSimilarity: number;
  /** Forward moves larger than this are treated as jumps. */
  jumpThreshold: number;
  /** Matched words required to accept a jump. */
  jumpMinMatches: number;
  /** Matched words required to accept a backward move. */
  backMinMatches: number;
  /** Backward moves smaller than this are ignored (repeated words). */
  backIgnoreDistance: number;
}

export const DEFAULT_ALIGNER_CONFIG: AlignerConfig = {
  tailWords: 8,
  backWindow: 40,
  forwardWindow: 80,
  minWordSimilarity: 0.7,
  jumpThreshold: 6,
  jumpMinMatches: 3,
  backMinMatches: 5,
  backIgnoreDistance: 3,
};

export type AlignmentKind = 'advance' | 'jump' | 'back' | 'hold';

export interface AlignmentResult {
  kind: AlignmentKind;
  /** Index of the last script word the speaker has reached (-1 = not started). */
  cursor: number;
  /** Character offset in the script just after the cursor word (for highlighting). */
  charOffset: number;
  /** Fraction of tail words that matched, 0..1. */
  confidence: number;
}

interface Candidate {
  end: number;
  matches: number;
  score: number;
  tailLen: number;
}

const MATCH_WEIGHT = 2;
const MISMATCH = -1;
const GAP = -1;
/** Spoken words whose similarity rows are kept (a tail is 8 words; speech repeats). */
const SIM_CACHE_SIZE = 64;

export class ScriptAligner {
  readonly tokens: Token[];
  private readonly config: AlignerConfig;
  private cursorIndex = -1;
  private pendingJump: { end: number; kind: 'jump' | 'back' } | null = null;
  private lastHypothesisKey = '';
  /** Spoken word count of the previous hypothesis in this utterance. */
  private lastSpokenCount = 0;
  /**
   * Words at the start of the current hypothesis said before a manual resync: the recognizer
   * keeps them in its transcript, and they must not pull the cursor back to where they matched.
   */
  private ignoreSpoken = 0;

  /**
   * Performance (see docs/architecture/performance.md): script words are
   * interned into a vocabulary so each spoken word is compared once per
   * distinct script word (cached), and the alignment inner loop is a table
   * lookup instead of an edit-distance call per cell.
   */
  private readonly vocab: string[] = [];
  /** Vocabulary id of every script token. */
  private readonly tokenIds: Int32Array;
  /** spoken norm → similarity (0 when below the threshold) against each vocabulary word. */
  private readonly simCache = new Map<string, Float32Array>();
  private readonly spokenOf = new WeakMap<Float32Array, string>();

  constructor(script: string, config: Partial<AlignerConfig> = {}) {
    this.tokens = tokenize(script);
    this.config = { ...DEFAULT_ALIGNER_CONFIG, ...config };
    const ids = new Map<string, number>();
    this.tokenIds = new Int32Array(this.tokens.length);
    this.tokens.forEach((t, i) => {
      let id = ids.get(t.norm);
      if (id === undefined) {
        id = this.vocab.length;
        ids.set(t.norm, id);
        this.vocab.push(t.norm);
      }
      this.tokenIds[i] = id;
    });
  }

  get cursor(): number {
    return this.cursorIndex;
  }

  get wordCount(): number {
    return this.tokens.length;
  }

  get isComplete(): boolean {
    return this.tokens.length > 0 && this.cursorIndex >= this.tokens.length - 1;
  }

  /** Manual override (user dragged the script, tapped a section, restarted). */
  setCursor(index: number): void {
    this.cursorIndex = Math.max(-1, Math.min(index, this.tokens.length - 1));
    this.pendingJump = null;
  }

  /** Cursor index of the script word that contains the given character offset. */
  wordIndexAtChar(charOffset: number): number {
    let lo = 0;
    let hi = this.tokens.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.tokens[mid]!.start <= charOffset) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  charOffsetForCursor(cursor = this.cursorIndex): number {
    if (cursor < 0) return 0;
    return this.tokens[Math.min(cursor, this.tokens.length - 1)]?.end ?? 0;
  }

  /**
   * Feed the recognizer's current hypothesis (partial or final) for the
   * current utterance. Returns the alignment decision.
   */
  update(hypothesis: string): AlignmentResult {
    const all = tokenize(hypothesis);
    this.ignoreSpoken = Math.min(this.ignoreSpoken, all.length);
    const spoken = this.ignoreSpoken > 0 ? all.slice(this.ignoreSpoken) : all;
    const tail = spoken.slice(-this.config.tailWords).map((t) => t.norm);
    const key = tail.join(' ');
    if (tail.length === 0 || this.tokens.length === 0 || key === this.lastHypothesisKey) {
      this.lastSpokenCount = all.length;
      return this.result('hold', 0);
    }
    this.lastHypothesisKey = key;
    // Recognizers may deliver many words at once (final-only results); a step
    // as large as the number of newly spoken words is normal progress.
    // A revision to fewer words (iOS resends the whole transcript) is not new
    // speech: count it as one word so large moves still need confirmation.
    // Only resetUtterance() (lastSpokenCount = 0) grants a full-size step.
    const newWords = all.length >= this.lastSpokenCount ? all.length - this.lastSpokenCount : 1;
    this.lastSpokenCount = all.length;

    const { backWindow, forwardWindow } = this.config;
    const from = Math.max(0, this.cursorIndex - backWindow);
    const to = Math.min(this.tokens.length, this.cursorIndex + 1 + forwardWindow);
    const sims = tail.map((w) => this.similarities(w));
    let best = this.align(sims, from, to);
    if (!best || best.matches < this.config.jumpMinMatches) {
      // Nothing convincing nearby; look further ahead for a skipped section.
      // Skipped entirely when too few spoken words occur anywhere in the script
      // to ever reach the far-jump threshold (the common "unrelated speech" case).
      const needed = this.config.jumpMinMatches + 1;
      const far = to < this.tokens.length && this.matchableWords(sims) >= needed ? this.align(sims, to, this.tokens.length) : null;
      if (far && far.matches >= needed) best = far;
    }
    if (!best) return this.result('hold', 0);
    return this.decide(best, newWords);
  }

  /** Call when the recognizer starts a fresh utterance/session. */
  resetUtterance(): void {
    this.lastHypothesisKey = '';
    this.lastSpokenCount = 0;
    this.ignoreSpoken = 0;
  }

  /**
   * Manual resync mid-utterance: the words recognized so far stay in the transcript but no longer
   * count; only speech after this point moves the cursor.
   */
  ignoreSpokenSoFar(): void {
    this.ignoreSpoken = this.lastSpokenCount;
    this.lastHypothesisKey = '';
  }

  /** Cursor for "start reading at this character": the word before the one that starts there. */
  cursorBeforeChar(charOffset: number): number {
    const i = this.wordIndexAtChar(charOffset);
    if (i < 0) return -1;
    return this.tokens[i]!.start >= charOffset ? i - 1 : i;
  }

  private decide(c: Candidate, newWords: number): AlignmentResult {
    const confidence = c.matches / c.tailLen;
    const delta = c.end - this.cursorIndex;
    const cfg = this.config;

    if (delta === 0) {
      this.pendingJump = null;
      return this.result('hold', confidence);
    }

    if (delta < 0) {
      if (-delta <= cfg.backIgnoreDistance || c.matches < cfg.backMinMatches) {
        return this.result('hold', confidence);
      }
      return this.confirm(c.end, 'back', confidence);
    }

    // Forward. The first words of a script are accepted with a single strong
    // match so the prompter reacts as soon as the speaker starts.
    const starting = this.cursorIndex < 0 && c.end <= 2;
    const minSmallStepMatches = starting ? 1 : Math.min(2, c.tailLen);
    const stepLimit = cfg.jumpThreshold + Math.max(0, newWords - 1);
    if (delta <= stepLimit) {
      const needed = delta > cfg.jumpThreshold ? cfg.jumpMinMatches : minSmallStepMatches;
      if (c.matches < needed) return this.result('hold', confidence);
      this.cursorIndex = c.end;
      this.pendingJump = null;
      return this.result('advance', confidence);
    }

    if (c.matches < cfg.jumpMinMatches || confidence < 0.5) {
      return this.result('hold', confidence);
    }
    return this.confirm(c.end, 'jump', confidence);
  }

  /** Large moves must be seen on two consecutive updates before applying. */
  private confirm(end: number, kind: 'jump' | 'back', confidence: number): AlignmentResult {
    const pending = this.pendingJump;
    if (pending && pending.kind === kind && Math.abs(pending.end - end) <= 3) {
      this.cursorIndex = end;
      this.pendingJump = null;
      return this.result(kind, confidence);
    }
    this.pendingJump = { end, kind };
    return this.result('hold', confidence);
  }

  private result(kind: AlignmentKind, confidence: number): AlignmentResult {
    return {
      kind,
      cursor: this.cursorIndex,
      charOffset: this.charOffsetForCursor(),
      confidence,
    };
  }

  /**
   * Similarity row of a spoken word against the vocabulary (cached). Entries
   * are filled lazily: -1 = not computed yet, 0 = below the threshold.
   */
  private similarities(spoken: string): Float32Array {
    const cached = this.simCache.get(spoken);
    if (cached) {
      // Refresh recency.
      this.simCache.delete(spoken);
      this.simCache.set(spoken, cached);
      return cached;
    }
    const row = new Float32Array(this.vocab.length).fill(-1);
    if (this.simCache.size >= SIM_CACHE_SIZE) this.simCache.delete(this.simCache.keys().next().value!);
    this.simCache.set(spoken, row);
    this.spokenOf.set(row, spoken);
    return row;
  }

  private sim(row: Float32Array, id: number): number {
    const cached = row[id]!;
    if (cached >= 0) return cached;
    const sim = wordSimilarity(this.spokenOf.get(row)!, this.vocab[id]!);
    const v = sim >= this.config.minWordSimilarity ? sim : 0;
    row[id] = v;
    return v;
  }

  /** Number of tail words that match at least one script word anywhere. */
  private matchableWords(sims: Float32Array[]): number {
    let n = 0;
    for (const row of sims) {
      for (let v = 0; v < row.length; v++) {
        if (this.sim(row, v) > 0) {
          n++;
          break;
        }
      }
    }
    return n;
  }

  /**
   * Local alignment of the tail (given as per-word similarity rows) against
   * tokens[from, to). Returns the script index aligned to (or nearest before)
   * the end of the tail. Candidates whose alignment does not reach the last
   * spoken words are penalized, and among equal scores the one closest to the
   * cursor wins. Uses two rolling rows: O(to - from) memory.
   */
  private align(sims: Float32Array[], from: number, to: number): Candidate | null {
    const m = sims.length;
    const n = to - from;
    if (m === 0 || n <= 0) return null;
    const ids = this.tokenIds;
    const width = n + 1;
    let prevScore = new Float64Array(width);
    let prevMatches = new Int32Array(width);
    let score = new Float64Array(width);
    let matches = new Int32Array(width);
    let best: Candidate | null = null;
    let bestAdjusted = -Infinity;

    for (let i = 1; i <= m; i++) {
      const row = sims[i - 1]!;
      score[0] = 0;
      matches[0] = 0;
      for (let j = 1; j <= n; j++) {
        // Similarities below the threshold are stored as 0 (= no match).
        const id = ids[from + j - 1]!;
        const cachedSim = row[id]!;
        const sim = cachedSim >= 0 ? cachedSim : this.sim(row, id);
        const isMatch = sim > 0;
        const diag = prevScore[j - 1]! + (isMatch ? MATCH_WEIGHT * sim : MISMATCH);
        const up = prevScore[j]! + GAP;
        const left = score[j - 1]! + GAP;
        let v = 0;
        let mc = 0;
        if (diag >= up && diag >= left && diag > 0) {
          v = diag;
          mc = prevMatches[j - 1]! + (isMatch ? 1 : 0);
        } else if (up >= left && up > 0) {
          v = up;
          mc = prevMatches[j]!;
        } else if (left > 0) {
          v = left;
          mc = matches[j - 1]!;
        }
        score[j] = v;
        matches[j] = mc;

        // Only cells where the current script word matched are valid endings.
        if (!isMatch || v <= 0) continue;
        const end = from + j - 1;
        const trailingUnmatched = m - i;
        const distance = Math.abs(end - this.cursorIndex);
        const adjusted = v - trailingUnmatched * 0.75 - distance * 0.01;
        if (adjusted > bestAdjusted) {
          bestAdjusted = adjusted;
          best = { end, matches: mc, score: v, tailLen: m };
        }
      }
      [prevScore, score] = [score, prevScore];
      [prevMatches, matches] = [matches, prevMatches];
    }
    return best;
  }
}
