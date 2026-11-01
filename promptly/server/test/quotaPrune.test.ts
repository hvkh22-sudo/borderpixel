import { describe, expect, it } from 'vitest';

import { dayCounterPrefix, staleDayKeys } from '../src/quota';

describe('daily counter pruning', () => {
  it('recognizes per-day keys only', () => {
    expect(dayCounterPrefix('d:2026-11-01')).toBe('d:');
    expect(dayCounterPrefix('spend_free:2026-11-01')).toBe('spend_free:');
    expect(dayCounterPrefix('m:2026-11')).toBeNull(); // monthly quota: kept
    expect(dayCounterPrefix('lifetime_total')).toBeNull();
  });

  it("lists earlier days of the same counter, never today's, a later day, or another counter", () => {
    const keys = ['d:2026-10-30', 'd:2026-10-31', 'd:2026-11-01', 'b:2026-10-31', 'm:2026-10', 'd:2026-11-02'];
    expect(staleDayKeys(keys, 'd:2026-11-01')).toEqual(['d:2026-10-30', 'd:2026-10-31']);
    expect(staleDayKeys(keys, 'm:2026-11')).toEqual([]);
  });
});
