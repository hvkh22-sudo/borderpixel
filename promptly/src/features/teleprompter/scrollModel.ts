/**
 * Pure geometry for the teleprompter: maps script character offsets to
 * vertical scroll offsets using the line layout reported by the text renderer
 * (React Native `onTextLayout`), and computes timed-scroll velocity.
 *
 * Keeping this pure lets the UI thread animation (Reanimated) consume plain
 * numbers and keeps every rule testable without a device.
 */

export interface LayoutLine {
  /** Text content of the rendered line (as reported by onTextLayout). */
  text: string;
  /** Top of the line relative to the text container. */
  y: number;
  height: number;
}

export interface LineIndex {
  /** Starting character offset of each line. */
  starts: number[];
  lines: LayoutLine[];
  contentHeight: number;
}

export function buildLineIndex(lines: LayoutLine[]): LineIndex {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.text.length;
  }
  const last = lines[lines.length - 1];
  return { starts, lines, contentHeight: last ? last.y + last.height : 0 };
}

/** Index of the line containing the given character offset. */
export function lineForChar(index: LineIndex, charOffset: number): number {
  const { starts } = index;
  if (starts.length === 0) return -1;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= charOffset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Scroll offset that places the line containing `charOffset` on the reading
 * line, which sits at `readingLineRatio` of the viewport height (0 = top).
 * The script content is assumed to start at `topInset` inside the scroll view.
 */
export function scrollOffsetForChar(
  index: LineIndex,
  charOffset: number,
  viewportHeight: number,
  readingLineRatio: number,
  topInset = 0,
): number {
  const li = lineForChar(index, charOffset);
  if (li < 0) return 0;
  const line = index.lines[li]!;
  const lineCenter = topInset + line.y + line.height / 2;
  const target = lineCenter - viewportHeight * readingLineRatio;
  return clamp(target, 0, maxScroll(index, viewportHeight, topInset));
}

export function maxScroll(index: LineIndex, viewportHeight: number, topInset = 0): number {
  // Allow the last line to reach the reading line: content is padded by one
  // viewport at the bottom in the renderer.
  return Math.max(0, topInset + index.contentHeight);
}

/**
 * Timed mode: pixels per second needed to read at `wpm` words per minute,
 * given the rendered content height and the script word count.
 */
export function pixelsPerSecond(contentHeight: number, wordCount: number, wpm: number): number {
  if (wordCount <= 0 || contentHeight <= 0 || wpm <= 0) return 0;
  const pxPerWord = contentHeight / wordCount;
  return (pxPerWord * wpm) / 60;
}

export const MIN_WPM = 60;
export const MAX_WPM = 260;
export const WPM_STEP = 10;

export function clampWpm(wpm: number): number {
  return clamp(Math.round(wpm / WPM_STEP) * WPM_STEP, MIN_WPM, MAX_WPM);
}

/**
 * Voice Follow animation duration: short moves glide quickly, long jumps take
 * a little longer so the reader can track where the text went.
 */
export function followAnimationMs(distancePx: number, lineHeight: number): number {
  const lines = Math.abs(distancePx) / Math.max(1, lineHeight);
  return Math.round(clamp(220 + lines * 60, 220, 700));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
