/**
 * Tiny ring buffer of recent failures for the diagnostics screen and its
 * copyable report. Codes and short error messages only: never script text,
 * transcripts, file contents or personal data. File paths in messages are
 * replaced with <path>. Kept in memory and mirrored to KV so a failure from a
 * previous launch (crash, force quit) is still visible.
 */
import { getRepositories } from './db';

export type DiagnosticsSource = 'recording' | 'speech' | 'transcription' | 'export' | 'mux';

export interface DiagnosticsEntry {
  /** Epoch ms. */
  at: number;
  source: DiagnosticsSource;
  code: string;
  message?: string;
}

export interface DiagnosticsStorage {
  load(): Promise<unknown>;
  save(entries: DiagnosticsEntry[]): Promise<void>;
}

export const DIAGNOSTICS_LOG_KEY = 'diagnostics.log.v1';
export const DIAGNOSTICS_LOG_MAX = 30;
const MAX_MESSAGE = 160;
const MAX_CODE = 60;
const SOURCES: ReadonlySet<string> = new Set<DiagnosticsSource>(['recording', 'speech', 'transcription', 'export', 'mux']);

/** Strip paths/URIs (they can carry file names) and cap the length. */
export function sanitizeMessage(raw: string): string {
  const clean = raw
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<path>')
    .replace(/(^|[\s('"=])\/[^\s'")]+/g, '$1<path>')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > MAX_MESSAGE ? `${clean.slice(0, MAX_MESSAGE - 1)}…` : clean;
}

function messageOf(error: unknown): string | undefined {
  if (error == null) return undefined;
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  if (!raw) return undefined;
  const msg = sanitizeMessage(raw);
  return msg || undefined;
}

function isEntry(v: unknown): v is DiagnosticsEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.at === 'number' && typeof e.code === 'string' && typeof e.source === 'string' && SOURCES.has(e.source);
}

export function createDiagnosticsLog(storage: DiagnosticsStorage, opts: { now?: () => number; max?: number } = {}) {
  const now = opts.now ?? Date.now;
  const max = opts.max ?? DIAGNOSTICS_LOG_MAX;
  let entries: DiagnosticsEntry[] = [];
  let loaded: Promise<void> | null = null;

  const load = (): Promise<void> =>
    (loaded ??= (async () => {
      try {
        const raw = await storage.load();
        const saved = Array.isArray(raw) ? raw.filter(isEntry) : [];
        entries = [...saved, ...entries].sort((a, b) => a.at - b.at).slice(-max);
      } catch {
        // Unreadable log: start empty.
      }
    })());

  // Saved only after the earlier launches' entries were merged in, so they are never overwritten.
  const persist = () => {
    void load()
      .then(() => storage.save(entries.slice()))
      .catch(() => {
        // Diagnostics must never break the feature that failed.
      });
  };

  return {
    /** Record a failure. Never throws. */
    record(source: DiagnosticsSource, code: string, error?: unknown): void {
      try {
        const message = messageOf(error);
        const entry: DiagnosticsEntry = { at: now(), source, code: sanitizeMessage(String(code)).slice(0, MAX_CODE) || 'unknown' };
        if (message && message !== entry.code) entry.message = message;
        entries = [...entries, entry].slice(-max);
        persist();
      } catch {
        // Never throw into the caller.
      }
    },

    /** Merge entries saved by earlier launches (older) with this launch's. Idempotent. */
    load,

    /** Oldest first. */
    entries(): DiagnosticsEntry[] {
      return entries.slice();
    },

    async clear(): Promise<void> {
      await load();
      entries = [];
      await storage.save([]).catch(() => {});
    },
  };
}

export type DiagnosticsLog = ReturnType<typeof createDiagnosticsLog>;

export const diagnosticsLog = createDiagnosticsLog({
  load: async () => (await getRepositories()).kv.get<unknown>(DIAGNOSTICS_LOG_KEY, []),
  save: async (entries) => (await getRepositories()).kv.set(DIAGNOSTICS_LOG_KEY, entries),
});

/** Shorthand used at failure sites. Never throws. */
export function logDiagnostic(source: DiagnosticsSource, code: string, error?: unknown): void {
  diagnosticsLog.record(source, code, error);
}
