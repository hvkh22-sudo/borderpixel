/**
 * Minimal, dependency-free i18n. English ships at launch; further languages
 * are added as `Strings`-typed dictionaries once translated and reviewed.
 * UI language support is separate from speech/caption/AI language support.
 */
import { en, type Strings } from './en';

type Dict = Strings;

const dictionaries: Record<string, Dict> = { en };

/** Languages written right-to-left; layout mirrors when one is active. */
export const RTL_LANGUAGES = new Set(['he', 'ar', 'fa', 'ur']);

let active: Dict = en;
let activeLanguage = 'en';

export function setLanguage(languageCode: string): void {
  const code = languageCode.split('-')[0]!.toLowerCase();
  activeLanguage = dictionaries[code] ? code : 'en';
  active = dictionaries[activeLanguage]!;
}

export function currentLanguage(): string {
  return activeLanguage;
}

export function isRtl(): boolean {
  return RTL_LANGUAGES.has(activeLanguage);
}

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Leaves<T> = T extends string ? never : { [K in keyof T]: T[K] extends string ? K : Join<K, Leaves<T[K]>> }[keyof T];

export type TKey = Leaves<typeof en>;

function lookup(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), dict);
}

export function t(key: TKey, params?: Record<string, string | number>): string {
  const raw = lookup(active, key) ?? lookup(en, key);
  if (typeof raw !== 'string') return key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => (params[name] != null ? String(params[name]) : `{${name}}`));
}

/** Access non-string resources (e.g. FAQ arrays). */
export function strings(): Dict {
  return active;
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return t('common.seconds', { n: s });
  return t('common.minutesSeconds', { m: Math.floor(s / 60), s: s % 60 });
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
