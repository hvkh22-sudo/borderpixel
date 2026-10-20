import { analyzeMicSamples, classifyMicInput, DEFAULT_MIC_THRESHOLDS, meterFraction, micVerdict } from '../micCheck';

const repeat = (db: number, n: number) => Array.from({ length: n }, () => db);

describe('micVerdict', () => {
  it('reports silence for no samples, non-finite samples and a dead mic', () => {
    expect(micVerdict([])).toBe('silent');
    expect(micVerdict([NaN, Infinity, -Infinity])).toBe('silent');
    expect(micVerdict(repeat(-160, 30))).toBe('silent');
    expect(micVerdict(repeat(-58, 30))).toBe('silent'); // room noise only
  });

  it('accepts normal speech with pauses between words', () => {
    const speech = [...repeat(-160, 3), ...repeat(-45, 9), ...repeat(-22, 12), ...repeat(-14, 6)];
    expect(micVerdict(speech)).toBe('good');
  });

  it('flags quiet speech even when it is above the silence floor', () => {
    expect(micVerdict([...repeat(-55, 15), ...repeat(-40, 15)])).toBe('quiet');
  });

  it('flags clipping only when it is sustained, not for one pop', () => {
    const base = repeat(-18, 29);
    expect(micVerdict([...base, 0])).toBe('good'); // 1/30 < 5 %
    expect(micVerdict([...base.slice(0, 27), 0, -0.5, -0.2])).toBe('clipping');
  });

  it('clamps out-of-range values and exposes the analysis', () => {
    const a = analyzeMicSamples([5, -200, -20]);
    expect(a.peakDb).toBe(0);
    expect(a.clippedRatio).toBeCloseTo(1 / 3);
    expect(a.verdict).toBe('clipping');
  });

  it('respects custom thresholds (for per-platform calibration)', () => {
    expect(micVerdict(repeat(-30, 30), { ...DEFAULT_MIC_THRESHOLDS, quietSpeechDb: -25 })).toBe('quiet');
  });
});

describe('meterFraction', () => {
  it('maps dBFS to 0…1', () => {
    expect(meterFraction(undefined)).toBe(0);
    expect(meterFraction(-160)).toBe(0);
    expect(meterFraction(-30)).toBeCloseTo(0.5);
    expect(meterFraction(0)).toBe(1);
    expect(meterFraction(3)).toBe(1);
  });
});

describe('classifyMicInput', () => {
  it.each([
    ['MicrophoneBuiltIn', 'builtIn'],
    ['BluetoothHFP', 'bluetooth'],
    ['BluetoothSCO', 'bluetooth'],
    ['USBAudio', 'usb'],
    ['MicrophoneWired', 'wired'],
    ['HeadsetMicrophone', 'wired'],
    ['Unknown device type', 'other'],
    [undefined, 'other'],
  ])('%s → %s', (type, kind) => {
    expect(classifyMicInput(type)).toBe(kind);
  });
});
