import { describe, expect, it } from 'vitest';

import { CASES } from './cases';
import { autoChecks, estimateMaxCostUsd } from './metrics';

describe('eval metrics', () => {
  const routine = CASES.find((c) => c.id === 'shorten-routine-30')!;
  it('checks length, facts and format', () => {
    const ok = autoChecks(routine, `${'word '.repeat(70)}6:30`);
    expect(ok).toMatchObject({ lengthOk: true, missingFacts: [], formatIssues: [] });
    const bad = autoChecks(routine, '# Title\n- bullet #morning 🚀 this will go viral');
    expect(bad.lengthOk).toBe(false);
    expect(bad.missingFacts).toEqual(['6:30']);
    expect(bad.formatIssues).toEqual(expect.arrayContaining(['heading', 'bullets', 'hashtag', 'emoji', 'virality claim']));
  });
  it('bounds cost', () => {
    expect(estimateMaxCostUsd(['claude-haiku-5-5'], 10, 4000)).toBeCloseTo(0.024, 3);
  });
});
