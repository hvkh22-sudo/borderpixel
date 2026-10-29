/**
 * Compares Claude models on the Script Studio cases.
 *
 * COSTS MONEY: requires ANTHROPIC_API_KEY and the --confirm-spend flag.
 *   npx tsx eval/run.ts --models claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5 --confirm-spend
 * Writes eval/results/<timestamp>.json and .md (outputs are for human review).
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { AnthropicLlm } from '../src/llm';
import { SYSTEM_PROMPT, buildUserPrompt } from '../src/prompts';
import { CASES, type EvalCase } from './cases';
import { PRICES, autoChecks, estimateMaxCostUsd, type Checks } from './metrics';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const models = (arg('--models') ?? 'claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5').split(',');
const maxTokens = Number(arg('--max-tokens') ?? 4000);

async function main() {
  const unknown = models.filter((m) => !PRICES[m]);
  if (unknown.length) throw new Error(`No price configured for: ${unknown.join(', ')} (eval/metrics.ts)`);
  const ceiling = estimateMaxCostUsd(models, CASES.length, maxTokens);
  console.log(`${CASES.length} cases × ${models.length} models. Worst-case cost ≈ $${ceiling.toFixed(2)}.`);
  if (!args.includes('--confirm-spend')) {
    console.log('Dry run. Re-run with --confirm-spend to call the API (requires founder approval).');
    return;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');

  const rows: Row[] = [];
  for (const model of models) {
    const llm = new AnthropicLlm(key, model);
    for (const c of CASES) rows.push(await runCase(llm, model, c));
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync('eval/results', { recursive: true });
  writeFileSync(`eval/results/${stamp}.json`, JSON.stringify(rows, null, 2));
  writeFileSync(`eval/results/${stamp}.md`, report(rows));
  console.log(`Wrote eval/results/${stamp}.{json,md}`);
}

type Row =
  | {
      model: string;
      case: string;
      ok: true;
      ms: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      checks: Checks;
      text: string;
      alternatives: string[];
    }
  | { model: string; case: string; ok: false; ms: number; error: string };

async function runCase(llm: AnthropicLlm, model: string, c: EvalCase): Promise<Row> {
  const { prompt, wantsAlternatives } = buildUserPrompt(c.request);
  const started = Date.now();
  try {
    const out = await llm.complete(SYSTEM_PROMPT, prompt, wantsAlternatives, maxTokens);
    const p = PRICES[model]!;
    return {
      model,
      case: c.id,
      ok: true as const,
      ms: Date.now() - started,
      costUsd: (out.inputTokens * p.input + out.outputTokens * p.output) / 1_000_000,
      inputTokens: out.inputTokens,
      outputTokens: out.outputTokens,
      checks: autoChecks(c, out.text),
      text: out.text,
      alternatives: out.alternatives ?? [],
    };
  } catch (e) {
    return { model, case: c.id, ok: false as const, ms: Date.now() - started, error: (e as Error).message };
  }
}

function report(rows: Row[]): string {
  const lines = ['# Script Studio model comparison', '', '| model | case | ok | words | length ok | facts kept | format ok | ms | cost $ |', '|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    if (!r.ok) {
      lines.push(`| ${r.model} | ${r.case} | ✗ | | | | | ${r.ms} | |`);
      continue;
    }
    const k = r.checks;
    lines.push(`| ${r.model} | ${r.case} | ✓ | ${k.words} | ${k.lengthOk ?? '–'} | ${k.missingFacts.length ? `missing: ${k.missingFacts.join(', ')}` : '✓'} | ${k.formatIssues.length ? k.formatIssues.join(', ') : '✓'} | ${r.ms} | ${r.costUsd.toFixed(5)} |`);
  }
  lines.push('', '## Outputs (for human review — see eval/README.md rubric)', '');
  for (const r of rows) if (r.ok) lines.push(`### ${r.model} — ${r.case}`, '', r.text, ...(r.alternatives.length ? ['', ...r.alternatives.map((a) => `- ${a}`)] : []), '');
  return lines.join('\n');
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
