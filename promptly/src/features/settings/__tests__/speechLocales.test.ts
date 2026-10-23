import { canonicalSpeechLocale, speechLocaleOptions } from '../speechLocales';

describe('speechLocaleOptions', () => {
  it('lists the current locale first so it shows as selected', () => {
    expect(speechLocaleOptions('he-IL', 'he')[0]).toBe('he-IL');
    expect(speechLocaleOptions('fr-FR', 'en')[0]).toBe('fr-FR');
  });

  it('offers Hebrew to everyone and puts it first for a Hebrew UI', () => {
    expect(speechLocaleOptions('en-US', 'en')).toContain('he-IL');
    expect(speechLocaleOptions('en-US', 'he').slice(0, 2)).toEqual(['en-US', 'he-IL']);
  });

  it('does not repeat locales and maps legacy "iw" to Hebrew', () => {
    const opts = speechLocaleOptions('iw_IL', 'he');
    expect(opts[0]).toBe('he-IL');
    expect(new Set(opts).size).toBe(opts.length);
    expect(canonicalSpeechLocale('en-us')).toBe('en-US');
  });

  it('adds the default region to a bare language (iOS reports "he")', () => {
    expect(canonicalSpeechLocale('he')).toBe('he-IL');
    expect(canonicalSpeechLocale('en')).toBe('en-US');
    expect(canonicalSpeechLocale('fr')).toBe('fr');
    expect(speechLocaleOptions('he', 'he').filter((l) => l.startsWith('he'))).toEqual(['he-IL']);
  });
});
