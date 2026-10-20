/**
 * Text normalization and tokenization shared by Voice Follow alignment and
 * script-aware caption correction.
 *
 * Normalization is deliberately conservative: lowercase, strip diacritics and
 * punctuation, keep letters/digits from any script (Latin, Hebrew, Cyrillic…).
 */

export interface Token {
  /** Normalized form used for matching. */
  norm: string;
  /** Index of the token within its token list. */
  index: number;
  /** Start character offset (inclusive) in the source text. */
  start: number;
  /** End character offset (exclusive) in the source text. */
  end: number;
}

const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
const COMBINING_MARKS_RE = /\p{M}/gu;

/** Small number words → digits so "ten" and "10" match. */
const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  twenty: '20',
  thirty: '30',
  hundred: '100',
};

export function normalizeWord(word: string): string {
  const base = word
    .normalize('NFKD')
    .replace(COMBINING_MARKS_RE, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/-/g, '');
  return NUMBER_WORDS[base] ?? base;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(WORD_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const norm = normalizeWord(raw);
    if (!norm) continue;
    tokens.push({ norm, index: tokens.length, start, end: start + raw.length });
  }
  return tokens;
}

/** Levenshtein distance with an early-exit bound. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/**
 * Similarity in [0, 1] between two normalized words. Tolerates the kind of
 * near-misses speech recognizers produce ("color"/"colour", "gonna"/"gona").
 */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  // Very short words must match exactly; fuzzy matching them causes false hits.
  if (longest <= 3) return 0;
  const maxEdits = longest <= 5 ? 1 : 2;
  const d = editDistance(a, b, maxEdits);
  if (d > maxEdits) return 0;
  return 1 - d / longest;
}

/** Words per minute used for duration estimates when the user has no history. */
export const DEFAULT_SPEAKING_WPM = 150;

export function countWords(text: string): number {
  return tokenize(text).length;
}

export function estimateSpeakingSeconds(text: string, wpm = DEFAULT_SPEAKING_WPM): number {
  const words = countWords(text);
  if (words === 0) return 0;
  return Math.max(1, Math.round((words / wpm) * 60));
}
