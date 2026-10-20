import {
  addSample,
  breakPaceSegment,
  createPaceTracker,
  durationWpm,
  EMPTY_RATE_HISTORY,
  estimateWpm,
  MAX_SAMPLES,
  measureWpm,
  paceTotals,
  parseRateHistory,
  suggestedTimedWpm,
  timedSample,
  trackCursor,
  voiceSample,
  weightedMedian,
  type RateSample,
  type SpeakingRateHistory,
} from '../speakingRate';

const s = (wpm: number, at = 0): RateSample => ({ wpm, at, source: 'voice' });
const hist = (...wpms: number[]): SpeakingRateHistory => wpms.reduce((h, w, i) => addSample(h, s(w, i)), EMPTY_RATE_HISTORY);

describe('measureWpm', () => {
  it('computes words per minute', () => {
    expect(measureWpm(150, 60_000)).toBe(150);
    expect(measureWpm(50, 20_000)).toBe(150);
  });

  it('ignores takes under 10 s and too few words', () => {
    expect(measureWpm(30, 9_999)).toBeNull();
    expect(measureWpm(10, 30_000)).toBeNull();
  });

  it('clamps to 80–240 and rejects implausible rates', () => {
    expect(measureWpm(30, 30_000)).toBe(80); // 60 wpm → clamped
    expect(measureWpm(130, 30_000)).toBe(240); // 260 wpm → clamped
    expect(measureWpm(15, 60_000)).toBeNull(); // 15 wpm: noise
    expect(measureWpm(500, 60_000)).toBeNull(); // 500 wpm: a jump, not speech
    expect(measureWpm(NaN, 60_000)).toBeNull();
  });
});

describe('Voice Follow pace tracker', () => {
  it('measures from the first to the last aligner advance', () => {
    let t = createPaceTracker();
    t = trackCursor(t, -1, 0); // not started
    t = trackCursor(t, 1, 2_000); // first words recognised
    t = trackCursor(t, 26, 12_000);
    t = trackCursor(t, 41, 20_000);
    expect(paceTotals(t)).toEqual({ words: 40, ms: 18_000 });
    expect(voiceSample(t, 99)).toEqual({ wpm: (40 / 18_000) * 60_000, at: 99, source: 'voice' });
  });

  it('does not count a manual jump as spoken words', () => {
    let t = createPaceTracker();
    t = trackCursor(t, 0, 0);
    t = trackCursor(t, 30, 12_000);
    t = breakPaceSegment(t);
    t = trackCursor(t, 200, 13_000); // tap-to-resync far ahead
    t = trackCursor(t, 230, 25_000);
    expect(paceTotals(t)).toEqual({ words: 60, ms: 24_000 });
  });

  it('restarts the segment when the cursor moves back', () => {
    let t = createPaceTracker();
    t = trackCursor(t, 0, 0);
    t = trackCursor(t, 20, 10_000);
    t = trackCursor(t, 5, 11_000);
    t = trackCursor(t, 25, 21_000);
    expect(paceTotals(t)).toEqual({ words: 40, ms: 20_000 });
  });

  it('gives no sample for a short take', () => {
    let t = createPaceTracker();
    t = trackCursor(t, 0, 0);
    t = trackCursor(t, 20, 8_000);
    expect(voiceSample(t, 0)).toBeNull();
  });
});

describe('timedSample', () => {
  const base = { scriptWords: 150, playedMs: 60_000, reachedEnd: true, manualScroll: false };
  it('learns only when the prompter reached the end untouched', () => {
    expect(timedSample(base, 5)).toEqual({ wpm: 150, at: 5, source: 'timed' });
    expect(timedSample({ ...base, reachedEnd: false }, 5)).toBeNull();
    expect(timedSample({ ...base, manualScroll: true }, 5)).toBeNull();
    expect(timedSample({ ...base, playedMs: 5_000 }, 5)).toBeNull();
  });
});

describe('estimate', () => {
  it('needs at least two samples', () => {
    expect(estimateWpm(EMPTY_RATE_HISTORY)).toBeNull();
    expect(estimateWpm(hist(170))).toBeNull();
    expect(durationWpm(hist(170))).toBe(150);
    expect(estimateWpm(hist(170, 180))).not.toBeNull();
  });

  it('is robust to a single outlier', () => {
    expect(estimateWpm(hist(160, 162, 158, 240, 161))).toBe(161);
  });

  it('weights recent takes more', () => {
    // Old habit 120 wpm, recent takes 180 wpm.
    expect(estimateWpm(hist(120, 120, 120, 180, 180, 180))).toBe(180);
    expect(weightedMedian([])).toBeNull();
  });

  it('keeps only the most recent samples', () => {
    const h = hist(...Array.from({ length: MAX_SAMPLES + 5 }, (_, i) => 100 + i));
    expect(h.samples).toHaveLength(MAX_SAMPLES);
    expect(h.samples[0]!.wpm).toBe(105);
  });

  it('suggests a Timed speed in steps of 10', () => {
    expect(suggestedTimedWpm(hist(163, 167))).toBe(170);
    expect(suggestedTimedWpm(EMPTY_RATE_HISTORY)).toBeNull();
    expect(durationWpm(hist(163, 167))).toBe(167);
  });
});

describe('parseRateHistory', () => {
  it('drops malformed data without throwing', () => {
    expect(parseRateHistory(null)).toEqual(EMPTY_RATE_HISTORY);
    expect(parseRateHistory('x')).toEqual(EMPTY_RATE_HISTORY);
    expect(parseRateHistory({ samples: 'x' })).toEqual(EMPTY_RATE_HISTORY);
    const parsed = parseRateHistory({ version: 1, samples: [s(150), { wpm: 'fast' }, { wpm: 400, at: 1, source: 'timed' }, null] });
    expect(parsed.samples).toEqual([s(150), { wpm: 240, at: 1, source: 'timed' }]);
  });
});
