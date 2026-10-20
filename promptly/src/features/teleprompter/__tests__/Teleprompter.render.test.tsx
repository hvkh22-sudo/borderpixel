/**
 * Render-cost contract of the teleprompter: a Voice Follow highlight update
 * re-renders O(1) script chunks, not the whole script.
 *
 * A memoized chunk that React skips keeps the very same props object on its
 * host text node (the renderer only replaces it in commitUpdate), so comparing
 * props identity before/after an update counts the chunks actually re-rendered.
 */
import { Profiler, createRef } from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DEFAULT_PROMPTER } from '../../../state/settings';
import { Teleprompter, type TeleprompterHandle } from '../Teleprompter';

const WORDS = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike'.split(' ');

/** ~10,000 words in paragraphs of 40 words separated by blank lines. */
function makeScript(words = 10000, perPara = 40): string {
  const paras: string[] = [];
  let para: string[] = [];
  for (let i = 0; i < words; i++) {
    para.push(`${WORDS[i % WORDS.length]}${i % 7}`);
    if (para.length === perPara) {
      paras.push(`${para.join(' ')}.`);
      para = [];
    }
  }
  if (para.length) paras.push(para.join(' '));
  return paras.join('\n\n');
}

/** Host <Text> nodes of the script chunks (the ones that report text layout). */
function chunkTexts() {
  return screen.root!.queryAll((n) => typeof n.type === 'string' && typeof n.props.onTextLayout === 'function');
}

function flatStyle(style: unknown): Record<string, unknown> {
  return StyleSheet.flatten(style as never) ?? {};
}

describe('Teleprompter render cost', () => {
  const script = makeScript();
  let commits = 0;
  const ui = (offset: number) => (
    <GestureHandlerRootView>
      <Profiler id="tp" onRender={() => commits++}>
        <Teleprompter script={script} settings={DEFAULT_PROMPTER} mode="voice" playing={false} followCharOffset={offset} highlightCharOffset={offset} />
      </Profiler>
    </GestureHandlerRootView>
  );

  it('renders one chunk per hard line and re-renders O(1) chunks per follow update', async () => {
    const r = await render(ui(0));
    const initial = chunkTexts();
    // 250 paragraphs + 249 blank lines.
    expect(initial).toHaveLength(script.split('\n').length);

    let before = initial.map((t) => t.props);
    let maxChanged = 0;
    // Walk the highlight through the first paragraphs, ~one word at a time,
    // crossing several paragraph boundaries.
    for (let offset = 5; offset < 1200; offset += 7) {
      commits = 0;
      await act(async () => r.rerender(ui(offset)));
      const after = chunkTexts().map((t) => t.props);
      const changed = after.filter((p, i) => p !== before[i]).length;
      maxChanged = Math.max(maxChanged, changed);
      expect(commits).toBe(1);
      before = after;
    }
    // The boundary chunk, plus the previous one when the boundary crosses a line.
    expect(maxChanged).toBeLessThanOrEqual(2);
    expect(maxChanged).toBeGreaterThanOrEqual(1);
  });

  it('dims exactly the spoken text across chunks', async () => {
    const offset = script.indexOf('\n') + 10;
    await render(ui(offset));
    const spoken = screen.root!.queryAll((n) => typeof n.type === 'string' && flatStyle(n.props.style).opacity === 0.4);
    const dimmed = spoken.map((n) => n.children.join('')).join('');
    // First paragraph fully, the blank line's space is not dimmed, then the first 9 chars of paragraph 2.
    const p1 = script.slice(0, script.indexOf('\n'));
    expect(dimmed).toBe(p1 + script.slice(script.indexOf('\n\n') + 2, offset));
  });

  it('maps chunk layouts to the same char → scroll geometry as one text', async () => {
    const short = 'One two three four\n\nFive six';
    const ref = createRef<TeleprompterHandle>();
    await render(
      <GestureHandlerRootView>
        <Teleprompter ref={ref} script={short} settings={DEFAULT_PROMPTER} mode="manual" playing={false} followCharOffset={null} />
      </GestureHandlerRootView>,
    );
    const lh = 40;
    const viewport = screen.root!.queryAll((n) => typeof n.props.onLayout === 'function' && n.props.accessibilityRole === 'text')[0]!;
    await act(async () => viewport.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 500 } } }));
    // Chunk 0 wraps into two lines; chunk 1 is the blank line; chunk 2 one line.
    const reports = [
      { y: 0, lines: [{ text: 'One two ', y: 0, height: lh }, { text: 'three four', y: lh, height: lh }] },
      { y: 2 * lh, lines: [{ text: ' ', y: 0, height: lh }] },
      { y: 3 * lh, lines: [{ text: 'Five six', y: 0, height: lh }] },
    ];
    await act(async () => {
      chunkTexts().forEach((n, i) => {
        n.props.onLayout({ nativeEvent: { layout: { x: 0, y: reports[i]!.y, width: 300, height: reports[i]!.lines.length * lh } } });
        n.props.onTextLayout({ nativeEvent: { lines: reports[i]!.lines } });
      });
      await new Promise((r) => setTimeout(r, 5));
    });
    // Reanimated's Jest build exposes the live animated style as `jestAnimatedStyle`.
    const translateY = () => {
      const n = screen.root!.queryAll((x) => x.props.jestAnimatedStyle != null)[0]!;
      const transform = n.props.jestAnimatedStyle.value.transform as { translateY?: number }[];
      return transform.find((t) => 'translateY' in t)!.translateY!;
    };
    const topPad = 500 * DEFAULT_PROMPTER.readingLine;
    // 'Five' (offset 20) is on line 3 (y 120..160): centre 140 on the reading line.
    await act(async () => {
      ref.current!.jumpToChar(short.indexOf('Five'));
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(translateY()).toBeCloseTo(topPad - 140);
    await act(async () => {
      ref.current!.jumpToChar(short.indexOf('three'));
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(translateY()).toBeCloseTo(topPad - 60);
  });
});
