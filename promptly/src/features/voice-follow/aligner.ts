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

export class ScriptAligner {
  readonly tokens: Token[];
  private readonly config: AlignerConfig;
  private cursorIndex = -1;
  private pendingJump: { end: number; kind: 'jump' | 'back' } | null = null;
  private lastHypothesisKey = '';
  /** Spoken word count of the previous hypothesis in this utterance. */
  private lastSpokenCount = 0;

  constructor(script: string, config: Partial<AlignerConfig> = {}) {
    this.tokens = tokenize(script);
    this.config = { ...DEFAULT_ALIGNER_CONFIG, ...config };
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
    const spoken = tokenize(hypothesis);
    const tail = spoken.slice(-this.config.tailWords).map((t) => t.norm);
    const key = tail.join(' ');
    if (tail.length === 0 || this.tokens.length === 0 || key === this.lastHypothesisKey) {
      return this.result('hold', 0);
    }
    this.lastHypothesisKey = key;
    // Recognizers may deliver many words at once (final-only results); a step
    // as large as the number of newly spoken words is normal progress.
    const newWords = spoken.length >= this.lastSpokenCount ? spoken.length - this.lastSpokenCount : spoken.length;
    this.lastSpokenCount = spoken.length;

    const { backWindow, forwardWindow } = this.config;
    const from = Math.max(0, this.cursorIndex - backWindow);
    const to = Math.min(this.tokens.length, this.cursorIndex + 1 + forwardWindow);
    let best = this.align(tail, from, to);
    if (!best || best.matches < this.config.jumpMinMatches) {
      // Nothing convincing nearby; look further ahead for a skipped section.
      const far = to < this.tokens.length ? this.align(tail, to, this.tokens.length) : null;
      if (far && far.matches >= this.config.jumpMinMatches + 1) best = far;
    }
    if (!best) return this.result('hold', 0);
    return this.decide(best, newWords);
  }

  /** Call when the recognizer starts a fresh utterance/session. */
  resetUtterance(): void {
    this.lastHypothesisKey = '';
    this.lastSpokenCount = 0;
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
   * Local alignment of `tail` against tokens[from, to). Returns the script
   * index aligned to (or nearest before) the end of the tail. Candidates whose
   * alignment does not reach the last spoken words are penalized, and among
   * equal scores the one closest to the cursor wins.
   */
  private align(tail: string[], from: number, to: number): Candidate | null {
    const m = tail.length;
    const n = to - from;
    if (m === 0 || n <= 0) return null;
    const minSim = this.config.minWordSimilarity;

    // score[i][j] and match counts, flattened (m+1) x (n+1).
    const width = n + 1;
    const score = new Float64Array((m + 1) * width);
    const matches = new Int32Array((m + 1) * width);
    let best: Candidate | null = null;
    let bestAdjusted = -Infinity;

    for (let i = 1; i <= m; i++) {
      const spokenWord = tail[i - 1]!;
      for (let j = 1; j <= n; j++) {
        const sim = wordSimilarity(spokenWord, this.tokens[from + j - 1]!.norm);
        const isMatch = sim >= minSim;
        const diagIdx = (i - 1) * width + (j - 1);
        const diag = score[diagIdx]! + (isMatch ? MATCH_WEIGHT * sim : MISMATCH);
        const up = score[(i - 1) * width + j]! + GAP;
        const left = score[i * width + (j - 1)]! + GAP;
        let v = 0;
        let mc = 0;
        if (diag >= up && diag >= left && diag > 0) {
          v = diag;
          mc = matches[diagIdx]! + (isMatch ? 1 : 0);
        } else if (up >= left && up > 0) {
          v = up;
          mc = matches[(i - 1) * width + j]!;
        } else if (left > 0) {
          v = left;
          mc = matches[i * width + (j - 1)]!;
        }
        const idx = i * width + j;
        score[idx] = v;
        matches[idx] = mc;

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
    }
    return best;
  }
}
