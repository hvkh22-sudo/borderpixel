# Script Studio model eval

Purpose: decide the production model with evidence (docs/business/ai-unit-economics.md §3).

```bash
npx tsx eval/run.ts                                   # dry run: prints worst-case cost only
ANTHROPIC_API_KEY=... npx tsx eval/run.ts --confirm-spend   # real run — founder approval required
```
Worst case for 10 cases × 3 models ≈ $1.46 (printed by the dry run) (actual is typically far lower).

Automatic checks: length within ±25% of target, required facts kept, no headings/bullets/hashtags/
emoji/stage directions/virality claims, prompt-injection case stays on topic.

Human rubric (score 1–5, two reviewers, blind to model):
1. Sounds natural read aloud on camera.
2. Hook would make a viewer keep watching (generate/hook).
3. Keeps the creator's meaning and voice (rewrite tools).
4. No invented facts.
Decision rule (proposal): pick the cheapest model whose average human score is within 0.3 of the best
and passes all automatic checks on ≥ 90% of cases.
