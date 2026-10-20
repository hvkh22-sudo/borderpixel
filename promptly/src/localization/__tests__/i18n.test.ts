import { en } from '../en';
import { he } from '../he';
import { currentLanguage, formatClock, formatDuration, isRtl, setLanguage, strings, t } from '../i18n';

/** Every leaf path of a strings tree; arrays are walked by index. */
function leafPaths(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}

function at(node: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((n, p) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[p] : undefined), node);
}

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe('i18n', () => {
  afterEach(() => setLanguage('en'));

  it('translates and interpolates', () => {
    expect(t('common.done')).toBe('Done');
    expect(t('editor.stats', { words: 12, duration: '5s' })).toBe('12 words · ~5s');
    expect(t('paywall.perMonth', {})).toBe('{price}/month');
  });

  it('falls back to English for unknown languages', () => {
    setLanguage('xx-YY');
    expect(t('common.done')).toBe('Done');
    expect(isRtl()).toBe(false);
  });

  it('formats durations and clocks', () => {
    expect(formatDuration(42)).toBe('42s');
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatClock(65_400)).toBe('1:05');
  });

  it('translates and interpolates in Hebrew', () => {
    setLanguage('he-IL');
    expect(currentLanguage()).toBe('he');
    expect(t('common.done')).toBe('סיום');
    expect(t('editor.stats', { words: 12, duration: '5 שנ׳' })).toBe('12 מילים · כ-5 שנ׳');
    expect(t('paywall.perMonth', { price: '₪19.90' })).toBe('₪19.90 לחודש');
    expect(formatDuration(125)).toBe('2 דק׳ 5 שנ׳');
    expect(strings().help.faq).toHaveLength(en.help.faq.length);
  });

  it('marks Hebrew as RTL, including the legacy Android code', () => {
    setLanguage('he');
    expect(isRtl()).toBe(true);
    setLanguage('iw');
    expect(currentLanguage()).toBe('he');
    expect(isRtl()).toBe(true);
    setLanguage('en-US');
    expect(isRtl()).toBe(false);
  });

  it('has every English key in Hebrew, with the same placeholders', () => {
    const enPaths = leafPaths(en);
    expect(enPaths.length).toBeGreaterThan(100);
    expect(leafPaths(he).sort()).toEqual([...enPaths].sort());
    for (const path of enPaths) {
      const enValue = at(en, path) as string;
      const heValue = at(he, path);
      expect(typeof heValue).toBe('string');
      expect({ path, placeholders: placeholders(heValue as string) }).toEqual({ path, placeholders: placeholders(enValue) });
      // Untranslated copies slip through types; only brand/platform names and empty strings may match.
      if (enValue === heValue && enValue !== '') {
        expect(['common.pro', 'editor.aiImprove', 'studio.toolHints.platform', 'paywall.title', 'subscription.pro', 'captions.style.bold']
          .concat(Object.keys(en.platform).map((k) => `platform.${k}`))).toContain(path);
      }
    }
  });
});
