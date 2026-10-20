import {
  buildLineIndex,
  clampWpm,
  followAnimationMs,
  lineForChar,
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
});
