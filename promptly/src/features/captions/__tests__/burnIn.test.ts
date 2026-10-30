import { burnInPayload } from '../burnIn';
import type { Cue } from '../captions';

const cues: Cue[] = [
  { id: 'c1', startMs: 0, endMs: 900, text: 'hello there', words: [{ text: 'hello', startMs: 0, endMs: 400 }, { text: 'there', startMs: 450, endMs: 900 }] },
  { id: 'c2', startMs: 1000, endMs: 2000, text: 'edited text' },
];

describe('burnInPayload', () => {
  it('sends word timing and highlight colour only when highlight is on and the style has one', () => {
    const p = burnInPayload(cues, 'pop', 'lower', true);
    expect(p.style.highlightColor).toBe('#FFE14D');
    expect(p.cues[0]!.words).toEqual([
      { startMs: 0, endMs: 400 },
      { startMs: 450, endMs: 900 },
    ]);
    // Edited cue: no word timing, rendered without highlight.
    expect(p.cues[1]).toEqual({ startMs: 1000, endMs: 2000, text: 'edited text' });
    expect(p.style.positionY).toBe(0.7);
  });

  it('omits highlight when off or the style has no highlight colour', () => {
    for (const p of [burnInPayload(cues, 'pop', 'lower', false), burnInPayload(cues, 'clean', 'upper', true)]) {
      expect(p.style.highlightColor).toBeNull();
      expect(p.cues.every((c) => c.words === undefined)).toBe(true);
    }
  });

  it('leaves emptied cues out of the video (they would draw an empty pill)', () => {
    const p = burnInPayload(
      [
        { id: 'a', startMs: 0, endMs: 500, text: 'hello' },
        { id: 'b', startMs: 500, endMs: 900, text: '  ' },
      ],
      'clean',
      'lower',
      false,
    );
    expect(p.cues.map((c) => c.text)).toEqual(['hello']);
  });

  it('keeps a right-to-left cue that starts with a Latin word RTL in the video (RLM)', () => {
    const p = burnInPayload([{ id: 'a', startMs: 0, endMs: 500, text: 'iPhone חדש עם מצלמה' }], 'clean', 'lower', false);
    expect(p.cues[0]!.text).toBe('\u200FiPhone חדש עם מצלמה');
  });
});
