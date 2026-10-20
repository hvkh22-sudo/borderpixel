import {
  buildChunkedLineIndex,
  buildLineIndex,
  lineAtY,
  splitScript,
  timedStep,
  clampWpm,
  followAnimationMs,
  lineForChar,
  maxScroll,
  pixelsPerSecond,
  scrollOffsetForChar,
} from '../scrollModel';

const lines = [
  { text: 'Hello world, ', y: 0, height: 40 },
  { text: 'this is a ', y: 40, height: 40 },
  { text: 'teleprompter.', y: 80, height: 40 },
];

describe('scrollModel', () => {
  const index = buildLineIndex(lines);

  it('indexes line starts and content height', () => {
    expect(index.starts).toEqual([0, 13, 23]);
    expect(index.contentHeight).toBe(120);
  });

  it('finds the line for a character', () => {
    expect(lineForChar(index, 0)).toBe(0);
    expect(lineForChar(index, 12)).toBe(0);
    expect(lineForChar(index, 13)).toBe(1);
    expect(lineForChar(index, 500)).toBe(2);
    expect(lineForChar(buildLineIndex([]), 3)).toBe(-1);
  });

  it('places the active line on the reading line and clamps at the top', () => {
    // Line 2 center = 100; reading line at 30% of 200 = 60 → offset 40.
    expect(scrollOffsetForChar(index, 25, 200, 0.3)).toBe(40);
    expect(scrollOffsetForChar(index, 0, 200, 0.3)).toBe(0);
  });

  it('uses the renderer\'s scroll range (last line on the reading line), not topPad beyond it', () => {
    // Renderer: topPad = viewport * readingLine, and offsets run 0..contentHeight.
    const viewport = 400;
    const topPad = viewport * 0.3;
    expect(maxScroll(index, viewport, 0.3, topPad)).toBe(index.contentHeight);
    for (let c = 0; c <= 40; c++) expect(scrollOffsetForChar(index, c, viewport, 0.3, topPad)).toBeLessThanOrEqual(index.contentHeight);
    // Generic inset: the bottom of the content may reach the reading line, no further.
    expect(maxScroll(index, 200, 0.3, 0)).toBe(60);
  });

  it('computes timed velocity from WPM', () => {
    // 120px for 6 words = 20px/word; 150 wpm = 2.5 words/s → 50 px/s
    expect(pixelsPerSecond(120, 6, 150)).toBe(50);
    expect(pixelsPerSecond(0, 6, 150)).toBe(0);
  });

  it('clamps WPM to supported steps', () => {
    expect(clampWpm(10)).toBe(60);
    expect(clampWpm(147)).toBe(150);
    expect(clampWpm(999)).toBe(260);
  });

  it('scales follow animation duration with distance', () => {
    expect(followAnimationMs(0, 40)).toBe(220);
    expect(followAnimationMs(40, 40)).toBe(280);
    expect(followAnimationMs(4000, 40)).toBe(700);
  });

  describe('chunked layout (one <Text> per hard line)', () => {
    const script = 'Hello world, this is\n\nteleprompter.';
    const chunks = splitScript(script);

    it('splits at newlines, keeping script offsets', () => {
      expect(chunks).toEqual([
        { start: 0, end: 20, text: 'Hello world, this is' },
        { start: 21, end: 21, text: '' },
        { start: 22, end: 35, text: 'teleprompter.' },
      ]);
      expect(splitScript('')).toEqual([]);
      expect(splitScript('a\n')).toEqual([
        { start: 0, end: 1, text: 'a' },
        { start: 2, end: 2, text: '' },
      ]);
    });

    const layouts = [
      { y: 0, lines: [{ text: 'Hello world, ', y: 0, height: 40 }, { text: 'this is', y: 40, height: 40 }] },
      { y: 80, lines: [{ text: ' ', y: 0, height: 40 }] },
      { y: 120, lines: [{ text: 'teleprompter.', y: 0, height: 40 }] },
    ];

    it('waits until every chunk reported position and lines', () => {
      expect(buildChunkedLineIndex(chunks, [layouts[0]!, { y: 80 }, layouts[2]!])).toBeNull();
      expect(buildChunkedLineIndex(chunks, layouts.slice(0, 2))).toBeNull();
    });

    it('matches the single-text index geometry', () => {
      const idx = buildChunkedLineIndex(chunks, layouts)!;
      // Same lines a single <Text> would report (newlines folded into line ends).
      const single = buildLineIndex([
        { text: 'Hello world, ', y: 0, height: 40 },
        { text: 'this is\n', y: 40, height: 40 },
        { text: '\n', y: 80, height: 40 },
        { text: 'teleprompter.', y: 120, height: 40 },
      ]);
      expect(idx.starts).toEqual(single.starts);
      expect(idx.contentHeight).toBe(single.contentHeight);
      for (let c = 0; c <= script.length; c++) {
        expect(scrollOffsetForChar(idx, c, 400, 0.3, 120)).toBe(scrollOffsetForChar(single, c, 400, 0.3, 120));
      }
    });

    it('finds the line under a tap with a binary search', () => {
      const idx = buildChunkedLineIndex(chunks, layouts)!;
      expect(lineAtY(idx, 0)).toBe(0);
      expect(lineAtY(idx, 79.9)).toBe(1);
      expect(lineAtY(idx, 100)).toBe(2);
      expect(lineAtY(idx, 159)).toBe(3);
      expect(lineAtY(idx, 160)).toBe(-1);
      expect(lineAtY(idx, -1)).toBe(-1);
    });

    it('builds a 5,000-line index quickly', () => {
      const many = Array.from({ length: 2500 }, (_, i) => `paragraph ${i} with some words`);
      const big = splitScript(many.join('\n'));
      const lay = big.map((c, i) => ({ y: i * 80, lines: [{ text: c.text.slice(0, 10), y: 0, height: 40 }, { text: c.text.slice(10), y: 40, height: 40 }] }));
      const t0 = performance.now();
      const idx = buildChunkedLineIndex(big, lay)!;
      expect(idx.lines).toHaveLength(5000);
      expect(performance.now() - t0).toBeLessThan(50);
      expect(lineForChar(idx, big[1234]!.start + 12)).toBe(2469);
    });
  });

  it('timed step leaves the offset alone while a restart/jump animation runs', () => {
    expect(timedStep(100, 50, 16, 1000, true)).toBeNull();
    expect(timedStep(100, 50, 20, 1000, false)).toBe(101);
    // Long frames are capped (64 ms) and the result clamps to the end.
    expect(timedStep(100, 1000, 500, 1000, false)).toBe(164);
    expect(timedStep(990, 1000, 64, 1000, false)).toBe(1000);
  });
});
