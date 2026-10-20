import type { Cue } from '../features/captions/captions';
import type { CaptionPosition, CaptionStyleId } from '../features/captions/captionStyles';
import type { SqlExecutor, SqlValue } from './sql';

export interface Script {
  id: string;
  title: string;
  body: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
}

export interface ScriptVersionRow {
  id: string;
  scriptId: string;
  body: string;
  source: string;
  createdAt: number;
}

export type ScriptSort = 'updated' | 'recent' | 'title';

interface ScriptRow {
  id: string;
  title: string;
  body: string;
  favorite: number;
  created_at: number;
  updated_at: number;
  last_opened_at: number | null;
}

const toScript = (r: ScriptRow): Script => ({
  id: r.id,
  title: r.title,
  body: r.body,
  favorite: r.favorite === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastOpenedAt: r.last_opened_at,
});

export interface Deps {
  db: SqlExecutor;
  newId: () => string;
  now: () => number;
}

/** Derive a title from the first line when the user has not named the script. */
export function deriveTitle(body: string, fallback: string): string {
  const first = body.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
  if (!first) return fallback;
  return first.length > 48 ? `${first.slice(0, 47).trimEnd()}…` : first;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class ScriptRepository {
  constructor(private readonly deps: Deps) {}

  async create(input: { title: string; body: string }): Promise<Script> {
    const now = this.deps.now();
    const script: Script = {
      id: this.deps.newId(),
      title: input.title,
      body: input.body,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    await this.deps.db.runAsync(
      'INSERT INTO scripts (id, title, body, favorite, created_at, updated_at, last_opened_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
      [script.id, script.title, script.body, now, now, now],
    );
    return script;
  }

  async get(id: string): Promise<Script | null> {
    const row = await this.deps.db.getFirstAsync<ScriptRow>('SELECT * FROM scripts WHERE id = ? AND deleted_at IS NULL', [id]);
    return row ? toScript(row) : null;
  }

  async list(opts: { query?: string; favoritesOnly?: boolean; sort?: ScriptSort } = {}): Promise<Script[]> {
    const where = ['deleted_at IS NULL'];
    const params: SqlValue[] = [];
    if (opts.query?.trim()) {
      const q = `%${escapeLike(opts.query.trim())}%`;
      where.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
      params.push(q, q);
    }
    if (opts.favoritesOnly) where.push('favorite = 1');
    const order =
      opts.sort === 'title'
        ? 'title COLLATE NOCASE ASC'
        : opts.sort === 'recent'
          ? 'COALESCE(last_opened_at, updated_at) DESC'
          : 'updated_at DESC';
    const rows = await this.deps.db.getAllAsync<ScriptRow>(
      `SELECT * FROM scripts WHERE ${where.join(' AND ')} ORDER BY ${order}`,
      params,
    );
    return rows.map(toScript);
  }

  async update(id: string, patch: Partial<Pick<Script, 'title' | 'body' | 'favorite'>>): Promise<void> {
    const sets: string[] = [];
    const params: SqlValue[] = [];
    if (patch.title !== undefined) {
      sets.push('title = ?');
      params.push(patch.title);
    }
    if (patch.body !== undefined) {
      sets.push('body = ?');
      params.push(patch.body);
    }
    if (patch.favorite !== undefined) {
      sets.push('favorite = ?');
      params.push(patch.favorite ? 1 : 0);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    params.push(this.deps.now(), id);
    await this.deps.db.runAsync(`UPDATE scripts SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async markOpened(id: string): Promise<void> {
    await this.deps.db.runAsync('UPDATE scripts SET last_opened_at = ? WHERE id = ?', [this.deps.now(), id]);
  }

  async duplicate(id: string, copySuffix: string): Promise<Script | null> {
    const s = await this.get(id);
    if (!s) return null;
    return this.create({ title: `${s.title} ${copySuffix}`.trim(), body: s.body });
  }

  /** Soft delete so an accidental delete can be undone from the snackbar. */
  async remove(id: string): Promise<void> {
    await this.deps.db.runAsync('UPDATE scripts SET deleted_at = ? WHERE id = ?', [this.deps.now(), id]);
  }

  async restore(id: string): Promise<void> {
    await this.deps.db.runAsync('UPDATE scripts SET deleted_at = NULL WHERE id = ?', [id]);
  }

  /** Permanently remove scripts soft-deleted before the cutoff. */
  async purgeDeleted(olderThan: number): Promise<number> {
    const r = await this.deps.db.runAsync('DELETE FROM scripts WHERE deleted_at IS NOT NULL AND deleted_at < ?', [olderThan]);
    await this.deps.db.runAsync('DELETE FROM script_versions WHERE script_id NOT IN (SELECT id FROM scripts)', []);
    return r.changes;
  }

  // ----- Versions (AI rewrites are always recoverable) -----

  async addVersion(scriptId: string, body: string, source: string): Promise<ScriptVersionRow> {
    const v: ScriptVersionRow = { id: this.deps.newId(), scriptId, body, source, createdAt: this.deps.now() };
    await this.deps.db.runAsync(
      'INSERT INTO script_versions (id, script_id, body, source, created_at) VALUES (?, ?, ?, ?, ?)',
      [v.id, scriptId, body, source, v.createdAt],
    );
    // Keep the newest 30 versions per script.
    await this.deps.db.runAsync(
      `DELETE FROM script_versions WHERE script_id = ? AND id NOT IN (
         SELECT id FROM script_versions WHERE script_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 30)`,
      [scriptId, scriptId],
    );
    return v;
  }

  async listVersions(scriptId: string): Promise<ScriptVersionRow[]> {
    const rows = await this.deps.db.getAllAsync<{ id: string; script_id: string; body: string; source: string; created_at: number }>(
      'SELECT * FROM script_versions WHERE script_id = ? ORDER BY created_at DESC, rowid DESC',
      [scriptId],
    );
    return rows.map((r) => ({ id: r.id, scriptId: r.script_id, body: r.body, source: r.source, createdAt: r.created_at }));
  }
}

export type RecordingStatusRow = 'ready' | 'recovered';

export interface Recording {
  id: string;
  scriptId: string | null;
  fileName: string;
  durationMs: number;
  width: number | null;
  height: number | null;
  createdAt: number;
  cues: Cue[] | null;
  captionStyle: CaptionStyleId | null;
  captionPosition: CaptionPosition;
  savedToLibrary: boolean;
  status: RecordingStatusRow;
}

interface RecordingRow {
  id: string;
  script_id: string | null;
  file_name: string;
  duration_ms: number;
  width: number | null;
  height: number | null;
  created_at: number;
  captions_json: string | null;
  caption_style: string | null;
  caption_position: string;
  saved_to_library: number;
  status: string;
}

function parseCues(json: string | null): Cue[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as Cue[]) : null;
  } catch {
    return null;
  }
}

const toRecording = (r: RecordingRow): Recording => ({
  id: r.id,
  scriptId: r.script_id,
  fileName: r.file_name,
  durationMs: r.duration_ms,
  width: r.width,
  height: r.height,
  createdAt: r.created_at,
  cues: parseCues(r.captions_json),
  captionStyle: (r.caption_style as CaptionStyleId | null) ?? null,
  captionPosition: r.caption_position === 'upper' || r.caption_position === 'middle' ? r.caption_position : 'lower',
  savedToLibrary: r.saved_to_library === 1,
  status: r.status === 'recovered' ? 'recovered' : 'ready',
});

export class RecordingRepository {
  constructor(private readonly deps: Deps) {}

  async add(input: Omit<Recording, 'id' | 'createdAt' | 'cues' | 'captionStyle' | 'captionPosition' | 'savedToLibrary'> & { id?: string }): Promise<Recording> {
    const rec: Recording = {
      ...input,
      id: input.id ?? this.deps.newId(),
      createdAt: this.deps.now(),
      cues: null,
      captionStyle: null,
      captionPosition: 'lower',
      savedToLibrary: false,
    };
    await this.deps.db.runAsync(
      `INSERT INTO recordings (id, script_id, file_name, duration_ms, width, height, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [rec.id, rec.scriptId, rec.fileName, rec.durationMs, rec.width, rec.height, rec.createdAt, rec.status],
    );
    return rec;
  }

  async get(id: string): Promise<Recording | null> {
    const row = await this.deps.db.getFirstAsync<RecordingRow>('SELECT * FROM recordings WHERE id = ?', [id]);
    return row ? toRecording(row) : null;
  }

  async list(): Promise<Recording[]> {
    const rows = await this.deps.db.getAllAsync<RecordingRow>('SELECT * FROM recordings ORDER BY created_at DESC', []);
    return rows.map(toRecording);
  }

  async knownFileNames(): Promise<Set<string>> {
    const rows = await this.deps.db.getAllAsync<{ file_name: string }>('SELECT file_name FROM recordings', []);
    return new Set(rows.map((r) => r.file_name));
  }

  async saveCaptions(id: string, cues: Cue[], style: CaptionStyleId, position: CaptionPosition = 'lower'): Promise<void> {
    await this.deps.db.runAsync('UPDATE recordings SET captions_json = ?, caption_style = ?, caption_position = ? WHERE id = ?', [
      JSON.stringify(cues),
      style,
      position,
      id,
    ]);
  }

  async markSavedToLibrary(id: string): Promise<void> {
    await this.deps.db.runAsync('UPDATE recordings SET saved_to_library = 1 WHERE id = ?', [id]);
  }

  async remove(id: string): Promise<void> {
    await this.deps.db.runAsync('DELETE FROM recordings WHERE id = ?', [id]);
  }
}

/** JSON key/value store for settings, usage counters and cached state. */
export class KeyValueStore {
  constructor(private readonly db: SqlExecutor) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.db.runAsync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
      key,
      JSON.stringify(value),
    ]);
  }

  async increment(key: string, by = 1): Promise<number> {
    const current = await this.get<number>(key, 0);
    const next = current + by;
    await this.set(key, next);
    return next;
  }

  async remove(key: string): Promise<void> {
    await this.db.runAsync('DELETE FROM kv WHERE key = ?', [key]);
  }

  async clearAll(): Promise<void> {
    await this.db.runAsync('DELETE FROM kv', []);
  }
}
