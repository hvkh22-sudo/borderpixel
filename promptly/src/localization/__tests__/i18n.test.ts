import { formatClock, formatDuration, isRtl, setLanguage, t } from '../i18n';

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
});
