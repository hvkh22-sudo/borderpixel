/**
 * Speech-recognition locales offered in Settings. The current choice (by default the device
 * locale, e.g. he-IL on a Hebrew phone) is always listed so it shows as selected and can be
 * picked again; Hebrew is offered alongside English because the UI ships in both.
 */
const BASE_LOCALES = ['en-US', 'en-GB', 'en-AU', 'en-CA', 'en-IN', 'he-IL'];

/** Region used when the device reports a bare language (the iOS Simulator reports "he"). */
const DEFAULT_REGION: Record<string, string> = { he: 'IL', en: 'US' };

/**
 * Normalizes a locale tag for speech recognition: "iw" → "he" (older Android/Java), "_" → "-",
 * upper-case region, and a default region for a bare language ("he" → "he-IL"), which the
 * recognizers expect.
 */
export function canonicalSpeechLocale(tag: string): string {
  const [lang = '', ...rest] = tag.replace('_', '-').split('-').filter(Boolean);
  const code = lang.toLowerCase() === 'iw' ? 'he' : lang.toLowerCase();
  const region = rest.length ? rest.map((p) => p.toUpperCase()) : DEFAULT_REGION[code] ? [DEFAULT_REGION[code]] : [];
  return [code, ...region].join('-');
}

export function speechLocaleOptions(current: string, uiLanguage: string): string[] {
  const preferred = uiLanguage === 'he' ? ['he-IL'] : [];
  const out: string[] = [];
  for (const tag of [canonicalSpeechLocale(current), ...preferred, ...BASE_LOCALES]) {
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}
