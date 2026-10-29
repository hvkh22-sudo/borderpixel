import { detectDirection, scriptTextAlign } from '../textDirection';

describe('detectDirection', () => {
  it('detects Hebrew and Arabic as RTL', () => {
    expect(detectDirection('שלום לכולם')).toBe('rtl');
    expect(detectDirection('مرحبا بالعالم')).toBe('rtl');
  });

  it('detects Latin and other scripts as LTR', () => {
    expect(detectDirection('Hello world')).toBe('ltr');
    expect(detectDirection('Привет')).toBe('ltr');
    expect(detectDirection('こんにちは')).toBe('ltr');
  });

  it('uses the first strong character, skipping neutrals', () => {
    expect(detectDirection('  123, — "שלום" and hello')).toBe('rtl');
    expect(detectDirection('🎬 1. Hello שלום')).toBe('ltr');
    expect(detectDirection('\n\n2024 — TikTok טיפים')).toBe('ltr');
    // Hebrew punctuation (maqaf, geresh) and niqqud are not strong.
    expect(detectDirection('־׳ Go')).toBe('ltr');
  });

  it('falls back when there is no strong character', () => {
    expect(detectDirection('')).toBe('ltr');
    expect(detectDirection('123 !?')).toBe('ltr');
    expect(detectDirection('', 'rtl')).toBe('rtl');
    expect(detectDirection('Hi', 'rtl')).toBe('ltr');
  });
});

describe('scriptTextAlign', () => {
  it('keeps center', () => {
    expect(scriptTextAlign('center', 'rtl', true)).toBe('center');
    expect(scriptTextAlign('center', 'ltr', false)).toBe('center');
  });

  it('maps "left" to the start edge of the script, compensating for RN swapping in RTL layouts', () => {
    expect(scriptTextAlign('left', 'ltr', false)).toBe('left');
    expect(scriptTextAlign('left', 'rtl', false)).toBe('right');
    // RN renders 'left' as physical right inside an RTL layout, and vice versa.
    expect(scriptTextAlign('left', 'rtl', true)).toBe('left');
    expect(scriptTextAlign('left', 'ltr', true)).toBe('right');
  });
});

describe('majorityDirection (captions)', () => {
  const { majorityDirection } = require('../textDirection') as typeof import('../textDirection');
  it('reads a Hebrew caption that starts with a Latin word as right-to-left', () => {
    expect(majorityDirection('iPhone חדש עם מצלמה טובה')).toBe('rtl');
    expect(majorityDirection('Hello world שלום')).toBe('ltr');
    expect(majorityDirection('123 !')).toBe('ltr');
  });
});
