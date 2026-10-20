import type { EvalCase } from './cases';

/** USD per million tokens (Anthropic first-party rates, cached 2026-10-06 — re-verify). */
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};

const WPM = 150;

export interface Checks {
  words: number;
  /** Within ±25% of the spoken-length target; null when no target. */
  lengthOk: boolean | null;
  missingFacts: string[];
  formatIssues: string[];
}

export function autoChecks(c: EvalCase, text: string): Checks {
  const words = text.split(/\s+/).filter(Boolean).length;
  const target = c.request.durationSec ? (c.request.durationSec / 60) * WPM : null;
  const lower = text.toLowerCase();
  const formatIssues: string[] = [];
  if (/^#+\s/m.test(text)) formatIssues.push('heading');
  if (/^\s*[-*•]\s/m.test(text)) formatIssues.push('bullets');
  if (/#[a-z]\w+/i.test(text)) formatIssues.push('hashtag');
  if (/\p{Extended_Pictographic}/u.test(text)) formatIssues.push('emoji');
  if (/\[(pause|cut|b-roll)[^\]]*\]|\((pause|smiles)[^)]*\)/i.test(text)) formatIssues.push('stage directions');
  if (/viral|guarantee/i.test(text)) formatIssues.push('virality claim');
  return {
    words,
    lengthOk: target == null ? null : Math.abs(words - target) / target <= 0.25,
    missingFacts: c.mustInclude.filter((f) => !lower.includes(f.toLowerCase())),
    formatIssues,
  };
}

/** Upper bound: every request uses the full output budget and ~4k input tokens. */
export function estimateMaxCostUsd(models: string[], cases: number, maxOutputTokens: number): number {
  return models.reduce((sum, m) => {
    const p = PRICES[m];
    if (!p) return sum;
    return sum + (cases * (4000 * p.input + maxOutputTokens * p.output)) / 1_000_000;
  }, 0);
}
