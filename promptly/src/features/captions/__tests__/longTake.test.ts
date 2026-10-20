import type { RecognizedSegment } from '../captions';
import {
  chunkByteRange,
  detectPrematureEnd,
  mergeChunkResults,
  offsetSegments,
  parseWavHeader,
  planChunks,
  wavDurationMs,
  wavHeader,
} from '../longTake';

const seg = (text: string, startMs: number, endMs: number): RecognizedSegment => ({ text, startMs, endMs, confidence: 0.9 });

describe('planChunks', () => {
  it('keeps short takes in one part', () => {
    expect(planChunks(30_000)).toEqual([{ index: 0, startMs: 0, endMs: 30_000 }]);
    expect(planChunks(52_000)).toHaveLength(1);
    expect(planChunks(0)).toEqual([]);
  });

  it('splits a 10-minute take into ~50 s parts with 1 s overlap covering everything', () => {
    const plans = planChunks(600_000);
    expect(plans.length).toBe(13);
    expect(plans[0]).toEqual({ index: 0, startMs: 0, endMs: 50_000 });
    expect(plans[1]).toEqual({ index: 1, startMs: 49_000, endMs: 99_000 });
    for (let i = 1; i < plans.length; i++) expect(plans[i - 1]!.endMs - plans[i]!.startMs).toBe(1_000);
    expect(plans[plans.length - 1]!.endMs).toBe(600_000);
  });

  it('folds a tiny tail into the last part instead of recognizing 2 s alone', () => {
    const plans = planChunks(100_000);
    expect(plans.map((p) => [p.startMs, p.endMs])).toEqual([
      [0, 50_000],
      [49_000, 100_000],
    ]);
  });
});

describe('offsetSegments', () => {
  it('moves part-relative times onto the take timeline', () => {
    expect(offsetSegments([seg('hi', 100, 400)], 49_000)).toEqual([seg('hi', 49_100, 49_400)]);
  });
});

describe('mergeChunkResults', () => {
  it('cuts overlaps at the midpoint so each word appears once', () => {
    const a = { startMs: 0, endMs: 50_000, segments: [seg('one', 48_000, 48_400), seg('two', 49_100, 49_400), seg('three', 49_600, 49_900)] };
    // Part 2 starts at 49 s and re-hears "two" and "three" with slightly different timing.
    const b = { startMs: 49_000, endMs: 99_000, segments: [seg('two', 49_120, 49_420), seg('three', 49_620, 49_950), seg('four', 50_500, 50_800)] };
    const out = mergeChunkResults([b, a]);
    expect(out.map((s) => s.text)).toEqual(['one', 'two', 'three', 'four']);
    // Midpoint is 49.5 s: "two" from part 1, "three" from part 2.
    expect(out[1]!.startMs).toBe(49_100);
    expect(out[2]!.startMs).toBe(49_620);
  });

  it('drops a word repeated right across the cut', () => {
    const a = { startMs: 0, endMs: 50_000, segments: [seg('hello', 49_200, 49_480)] };
    const b = { startMs: 49_000, endMs: 99_000, segments: [seg('Hello,', 49_510, 49_800), seg('world', 50_000, 50_300)] };
    expect(mergeChunkResults([a, b]).map((s) => s.text)).toEqual(['hello', 'world']);
  });

  it('keeps genuine repeats that are far apart', () => {
    const a = { startMs: 0, endMs: 50_000, segments: [seg('no', 48_000, 48_200)] };
    const b = { startMs: 49_000, endMs: 99_000, segments: [seg('no', 52_000, 52_200)] };
    expect(mergeChunkResults([a, b])).toHaveLength(2);
  });

  it('passes a single part through unchanged', () => {
    const only = [seg('a', 0, 100), seg('b', 200, 300)];
    expect(mergeChunkResults([{ startMs: 0, endMs: 1000, segments: only }])).toEqual(only);
  });
});

describe('detectPrematureEnd', () => {
  it('reports the uncovered tail when recognition stopped early', () => {
    expect(detectPrematureEnd([seg('a', 0, 10_000), seg('b', 50_000, 58_000)], 300_000)).toEqual({ startMs: 58_000, endMs: 300_000, reason: 'stopped_early' });
  });
  it('accepts a normal trailing pause', () => {
    expect(detectPrematureEnd([seg('a', 0, 118_000)], 120_000)).toBeNull();
    expect(detectPrematureEnd([], 120_000)).toBeNull();
  });
});

describe('WAV helpers', () => {
  const fmt16k = (dataBytes: number) => {
    const header = wavHeader(dataBytes, 16_000);
    return parseWavHeader(header, 44 + dataBytes);
  };

  it('writes and parses a canonical PCM header', () => {
    const f = fmt16k(32_000);
    expect(f).toEqual({ sampleRate: 16_000, channels: 1, bitsPerSample: 16, dataOffset: 44, dataBytes: 32_000 });
    expect(wavDurationMs(f)).toBe(1000);
  });

  it('skips extra chunks before data and trusts file size for streamed headers', () => {
    const base = wavHeader(0, 8000);
    const list = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 1, 2, 3, 4]); // "LIST" + 4 bytes
    const bytes = new Uint8Array(base.length + list.length);
    bytes.set(base.slice(0, 36), 0);
    bytes.set(list, 36);
    bytes.set(base.slice(36), 36 + list.length);
    const f = parseWavHeader(bytes, bytes.length + 16_000);
    expect(f.dataOffset).toBe(56);
    expect(f.dataBytes).toBe(16_000);
  });

  it('trusts the header size when the file size is unknown, and keeps whole frames', () => {
    // handle.size can be null; transcription passes 0 then.
    expect(parseWavHeader(wavHeader(32_000, 16_000), 0).dataBytes).toBe(32_000);
    // A truncated file with an odd byte count is cut to whole 16-bit frames.
    expect(parseWavHeader(wavHeader(0, 16_000), 44 + 1001).dataBytes).toBe(1000);
  });

  it('rejects non-WAV input', () => {
    expect(() => parseWavHeader(new Uint8Array(44))).toThrow('Not a WAV file');
  });

  it('maps a part to a frame-aligned byte range', () => {
    const f = fmt16k(600_000 * 32);
    expect(chunkByteRange({ index: 1, startMs: 49_000, endMs: 99_000 }, f)).toEqual({ offset: 44 + 49_000 * 32, length: 50_000 * 32 });
    // Clamped to the data that exists.
    expect(chunkByteRange({ index: 0, startMs: 590_000, endMs: 700_000 }, f).length).toBe(10_000 * 32);
  });
});
