/**
 * Speech-recognition locales offered in Settings. The current choice (by default the device
 * locale, e.g. he-IL on a Hebrew phone) is always listed so it shows as selected and can be
 * picked again; Hebrew is offered alongside English because the UI ships in both.
 */
const BASE_LOCALES = ['en-US', 'en-GB', 'en-AU', 'en-CA', 'en-IN', 'he-IL'];

/** Older Android/Java versions report Hebrew as "iw". */
export function canonicalSpeechLocale(tag: string): string {
  const [lang = '', ...rest] = tag.replace('_', '-').split('-');
  const code = lang.toLowerCase() === 'iw' ? 'he' : lang.toLowerCase();
  return [code, ...rest.map((p) => p.toUpperCase())].join('-');
}

export function speechLocaleOptions(current: string, uiLanguage: string): string[] {
  const preferred = uiLanguage === 'he' ? ['he-IL'] : [];
  const out: string[] = [];
  for (const tag of [canonicalSpeechLocale(current), ...preferred, ...BASE_LOCALES]) {
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}
