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
 * A hard line of the script (text between newlines), rendered as its own
 * <Text> so a highlight change re-renders and re-measures only that chunk.
 * `end` is exclusive and excludes the newline; the newline at `end` belongs
 * to this chunk for char → line mapping.
 */
export interface ScriptChunk {
  start: number;
  end: number;
  text: string;
}

/** Splits a script at newlines. An empty script has no chunks. */
export function splitScript(script: string): ScriptChunk[] {
  if (!script) return [];
  const chunks: ScriptChunk[] = [];
  let start = 0;
  for (;;) {
    const nl = script.indexOf('\n', start);
    const end = nl < 0 ? script.length : nl;
    chunks.push({ start, end, text: script.slice(start, end) });
    if (nl < 0) break;
    start = nl + 1;
  }
  return chunks;
}

/** Layout reported by one chunk: its top inside the content view and its lines. */
export interface ChunkLayout {
  y?: number;
  lines?: LayoutLine[];
}

/**
 * Combines per-chunk layouts into one script-wide line index (same contract
 * as buildLineIndex over a single <Text>: line starts are script character
 * offsets, y is relative to the top of the script). Returns null until every
 * chunk has reported both its position and its lines.
 */
export function buildChunkedLineIndex(chunks: ScriptChunk[], layouts: ChunkLayout[]): LineIndex | null {
  const starts: number[] = [];
  const lines: LayoutLine[] = [];
  for (let c = 0; c < chunks.length; c++) {
    const layout = layouts[c];
    if (!layout || layout.y === undefined || !layout.lines) return null;
    const chunk = chunks[c]!;
    let offset = chunk.start;
    const chunkLines = layout.lines.length ? layout.lines : [{ text: '', y: 0, height: 0 }];
    for (const line of chunkLines) {
      starts.push(Math.min(offset, Math.max(chunk.start, chunk.end - 1)));
      lines.push({ text: line.text, y: layout.y + line.y, height: line.height });
      offset += line.text.length;
    }
  }
  const last = lines[lines.length - 1];
  return { starts, lines, contentHeight: last ? last.y + last.height : 0 };
}

/** Index of the line containing content-relative `y`, or -1 (binary search). */
export function lineAtY(index: LineIndex, y: number): number {
  const { lines } = index;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const l = lines[mid]!;
    if (y < l.y) hi = mid - 1;
    else if (y >= l.y + l.height) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * Keeps the reading position on the same text when the script reflows (rotation, font size,
 * text width): converts the content `y` on the reading line in the old layout to a character,
 * then returns the `y` of that character in the new layout, clamped to the new content.
 */
export function remapOffset(from: LineIndex, to: LineIndex, y: number): number {
  const { lines } = from;
  if (lines.length === 0 || to.lines.length === 0) return clamp(y, 0, to.contentHeight);
  // Last line starting at or above y (y may sit in the spacing between chunks).
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid]!.y <= y) lo = mid;
    else hi = mid - 1;
  }
  const line = lines[lo]!;
  if (y < line.y) return clamp(y, 0, to.contentHeight);
  const len = Math.max(1, line.text.length);
  const within = line.height > 0 ? (y - line.y) / line.height : 0;
  if (within >= 1) {
    // Below the line: keep the same distance below the same text in the new layout.
    const target = to.lines[lineForChar(to, from.starts[lo]! + line.text.length - 1)]!;
    return clamp(target.y + target.height + (y - line.y - line.height), 0, to.contentHeight);
  }
  const char = from.starts[lo]! + Math.floor(within * len);
  const ti = lineForChar(to, char);
  const target = to.lines[ti]!;
  const tLen = Math.max(1, target.text.length);
  const frac = Math.min(1, Math.max(0, (char - to.starts[ti]!) / tLen));
  return clamp(target.y + frac * target.height, 0, to.contentHeight);
}

/**
 * Timed mode, one frame: the next offset, or null when the frame callback
 * must not write (dragging, or a restart/jump animation owns the offset —
 * assigning offset.value would cancel that withTiming).
 */
export function timedStep(offset: number, pps: number, dtMs: number, max: number, blocked: boolean): number | null {
  'worklet';
  if (blocked) return null;
  return Math.min(max, offset + (pps * Math.min(dtMs, 64)) / 1000);
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
  return clamp(target, 0, maxScroll(index, viewportHeight, readingLineRatio, topInset));
}

/**
 * Largest scroll offset: the end of the content sits on the reading line. With the
 * renderer's geometry (topInset = viewport * readingLine) this is `contentHeight`,
 * the same bound Timed scrolling, drags and nudges use.
 */
export function maxScroll(index: LineIndex, viewportHeight: number, readingLineRatio: number, topInset = 0): number {
  return Math.max(0, topInset + index.contentHeight - viewportHeight * readingLineRatio);
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
