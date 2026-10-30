import { sanitizeCue, type Cue } from '../features/captions/captions';
import { isCaptionStyleId, type CaptionPosition, type CaptionStyleId } from '../features/captions/captionStyles';
import type { SqlExecutor, SqlValue } from './sql';

export interface Script {
  id: string;
  title: string;
  body: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
  /** `null` means the script is in "No folder". */
  folderId: string | null;
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
  folder_id: string | null;
}

const toScript = (r: ScriptRow): Script => ({
  id: r.id,
  title: r.title,
  body: r.body,
  favorite: r.favorite === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastOpenedAt: r.last_opened_at,
  folderId: r.folder_id ?? null,
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

/** Case-, accent- and niqqud-insensitive form for search. */
export function foldForSearch(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

const TITLE_COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export class ScriptRepository {
  constructor(private readonly deps: Deps) {}

  async create(input: { title: string; body: string; folderId?: string | null }): Promise<Script> {
    const now = this.deps.now();
    const script: Script = {
      id: this.deps.newId(),
      title: input.title,
      body: input.body,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      folderId: input.folderId ?? null,
    };
    await this.deps.db.runAsync(
      'INSERT INTO scripts (id, title, body, favorite, created_at, updated_at, last_opened_at, folder_id) VALUES (?, ?, ?, 0, ?, ?, ?, ?)',
      [script.id, script.title, script.body, now, now, now, script.folderId],
    );
    return script;
  }

  async get(id: string): Promise<Script | null> {
    const row = await this.deps.db.getFirstAsync<ScriptRow>('SELECT * FROM scripts WHERE id = ? AND deleted_at IS NULL', [id]);
    return row ? toScript(row) : null;
  }

  /**
   * `folderId`: omitted = every folder, a string = that folder only, `null` = scripts in "No folder".
   */
  async list(opts: { query?: string; favoritesOnly?: boolean; sort?: ScriptSort; folderId?: string | null; limit?: number } = {}): Promise<Script[]> {
    const where = ['deleted_at IS NULL'];
    const params: SqlValue[] = [];
    if (opts.favoritesOnly) where.push('favorite = 1');
    if (opts.folderId === null) where.push('folder_id IS NULL');
    else if (opts.folderId !== undefined) {
      where.push('folder_id = ?');
      params.push(opts.folderId);
    }
    const order = opts.sort === 'recent' ? 'COALESCE(last_opened_at, updated_at) DESC' : 'updated_at DESC';
    // A limit only applies in SQL when nothing is filtered or re-sorted in JS below.
    const sqlLimit = opts.limit != null && !opts.query?.trim() && opts.sort !== 'title' ? ` LIMIT ${Math.max(0, Math.floor(opts.limit))}` : '';
    const rows = await this.deps.db.getAllAsync<ScriptRow>(
      `SELECT * FROM scripts WHERE ${where.join(' AND ')} ORDER BY ${order}${sqlLimit}`,
      params,
    );
    let scripts = rows.map(toScript);
    // Search and title sort run here, not in SQL: SQLite's LIKE / NOCASE only fold ASCII, so "écrire"
    // missed "Écrire", a pointed Hebrew title missed a plain query, and non-Latin titles sorted last.
    const q = opts.query?.trim() ? foldForSearch(opts.query.trim()) : '';
    if (q) scripts = scripts.filter((sc) => foldForSearch(sc.title).includes(q) || foldForSearch(sc.body).includes(q));
    if (opts.sort === 'title') scripts.sort((a, b) => TITLE_COLLATOR.compare(a.title, b.title));
    return opts.limit != null ? scripts.slice(0, Math.max(0, opts.limit)) : scripts;
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
    // Favoriting is organization, not editing: only text changes move "Last edited".
    if (patch.title !== undefined || patch.body !== undefined) {
      sets.push('updated_at = ?');
      params.push(this.deps.now());
    }
    params.push(id);
    await this.deps.db.runAsync(`UPDATE scripts SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  /** Moving is organization, not editing: `updated_at` (and the "Last edited" sort) is unchanged. */
  async moveToFolder(id: string, folderId: string | null): Promise<void> {
    await this.deps.db.runAsync('UPDATE scripts SET folder_id = ? WHERE id = ?', [folderId, id]);
  }

  async markOpened(id: string): Promise<void> {
    await this.deps.db.runAsync('UPDATE scripts SET last_opened_at = ? WHERE id = ?', [this.deps.now(), id]);
  }

  async duplicate(id: string, copySuffix: string): Promise<Script | null> {
    const s = await this.get(id);
    if (!s) return null;
    return this.create({ title: `${s.title} ${copySuffix}`.trim(), body: s.body, folderId: s.folderId });
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
    const rows = await this.deps.db.getAllAsync<VersionDbRow>(
      'SELECT * FROM script_versions WHERE script_id = ? ORDER BY created_at DESC, rowid DESC',
      [scriptId],
    );
    return rows.map(toVersion);
  }

  // ----- Backup (export / merge import) -----

  /** Every live (not soft-deleted) script and its versions, oldest first. */
  async exportAll(): Promise<{ scripts: Script[]; versions: ScriptVersionRow[] }> {
    const scripts = await this.deps.db.getAllAsync<ScriptRow>('SELECT * FROM scripts WHERE deleted_at IS NULL ORDER BY created_at ASC, rowid ASC', []);
    const versions = await this.deps.db.getAllAsync<VersionDbRow>(
      `SELECT v.* FROM script_versions v JOIN scripts s ON s.id = v.script_id
       WHERE s.deleted_at IS NULL ORDER BY v.created_at ASC, v.rowid ASC`,
      [],
    );
    return { scripts: scripts.map(toScript), versions: versions.map(toVersion) };
  }

  /** Ids of every stored script and version, including soft-deleted ones, so an import never collides. */
  async existingIds(): Promise<{ scripts: Map<string, Pick<Script, 'title' | 'body' | 'updatedAt'> & { deleted: boolean }>; versions: Set<string> }> {
    const s = await this.deps.db.getAllAsync<{ id: string; title: string; body: string; updated_at: number; deleted_at: number | null }>(
      'SELECT id, title, body, updated_at, deleted_at FROM scripts',
      [],
    );
    const v = await this.deps.db.getAllAsync<{ id: string }>('SELECT id FROM script_versions', []);
    return {
      scripts: new Map(s.map((r) => [r.id, { title: r.title, body: r.body, updatedAt: r.updated_at, deleted: r.deleted_at != null }])),
      versions: new Set(v.map((r) => r.id)),
    };
  }

  /** Bring back a soft-deleted script with the content from a backup (same id). */
  async restoreImported(s: Script): Promise<void> {
    await this.deps.db.runAsync(
      `UPDATE scripts SET title = ?, body = ?, favorite = ?, created_at = ?, updated_at = ?, last_opened_at = ?, folder_id = ?, deleted_at = NULL
       WHERE id = ?`,
      [s.title, s.body, s.favorite ? 1 : 0, s.createdAt, s.updatedAt, s.lastOpenedAt, s.folderId, s.id],
    );
  }

  /** Insert an imported script exactly as given (ids are already conflict-free). */
  async insertImported(s: Script): Promise<void> {
    await this.deps.db.runAsync(
      `INSERT INTO scripts (id, title, body, favorite, created_at, updated_at, last_opened_at, folder_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.id, s.title, s.body, s.favorite ? 1 : 0, s.createdAt, s.updatedAt, s.lastOpenedAt, s.folderId],
    );
  }

  async insertImportedVersion(v: ScriptVersionRow): Promise<void> {
    await this.deps.db.runAsync('INSERT INTO script_versions (id, script_id, body, source, created_at) VALUES (?, ?, ?, ?, ?)', [
      v.id,
      v.scriptId,
      v.body,
      v.source,
      v.createdAt,
    ]);
  }
}

interface VersionDbRow {
  id: string;
  script_id: string;
  body: string;
  source: string;
  created_at: number;
}

const toVersion = (r: VersionDbRow): ScriptVersionRow => ({ id: r.id, scriptId: r.script_id, body: r.body, source: r.source, createdAt: r.created_at });

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  sortOrder: number;
}

export interface FolderWithCount extends Folder {
  /** Live (not soft-deleted) scripts in the folder. */
  scriptCount: number;
}

interface FolderRow {
  id: string;
  name: string;
  created_at: number;
  sort_order: number;
}

const toFolder = (r: FolderRow): Folder => ({ id: r.id, name: r.name, createdAt: r.created_at, sortOrder: r.sort_order });

export const FOLDER_NAME_MAX = 40;

/** Trim, collapse whitespace and cap the length of a user-entered folder name. */
export function normalizeFolderName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, FOLDER_NAME_MAX).trim();
}

export class FolderRepository {
  constructor(private readonly deps: Deps) {}

  async create(name: string): Promise<Folder> {
    const clean = normalizeFolderName(name);
    if (!clean) throw new Error('Folder name is empty');
    const max = await this.deps.db.getFirstAsync<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM folders', []);
    const folder: Folder = { id: this.deps.newId(), name: clean, createdAt: this.deps.now(), sortOrder: (max?.m ?? -1) + 1 };
    await this.insert(folder);
    return folder;
  }

  /** Insert a folder exactly as given (used by import; ids are already conflict-free). */
  async insert(f: Folder): Promise<void> {
    await this.deps.db.runAsync('INSERT INTO folders (id, name, created_at, sort_order) VALUES (?, ?, ?, ?)', [f.id, f.name, f.createdAt, f.sortOrder]);
  }

  async get(id: string): Promise<Folder | null> {
    const row = await this.deps.db.getFirstAsync<FolderRow>('SELECT * FROM folders WHERE id = ?', [id]);
    return row ? toFolder(row) : null;
  }

  async rename(id: string, name: string): Promise<void> {
    const clean = normalizeFolderName(name);
    if (!clean) return;
    await this.deps.db.runAsync('UPDATE folders SET name = ? WHERE id = ?', [clean, id]);
  }

  /**
   * Deletes only the folder. Its scripts (including soft-deleted ones awaiting
   * undo) move to "No folder" first, so no script is ever lost with a folder.
   */
  async remove(id: string): Promise<void> {
    await this.deps.db.runAsync('UPDATE scripts SET folder_id = NULL WHERE folder_id = ?', [id]);
    await this.deps.db.runAsync('DELETE FROM folders WHERE id = ?', [id]);
  }

  async list(): Promise<Folder[]> {
    const rows = await this.deps.db.getAllAsync<FolderRow>('SELECT * FROM folders ORDER BY sort_order ASC, created_at ASC', []);
    return rows.map(toFolder);
  }

  async listWithCounts(): Promise<FolderWithCount[]> {
    const rows = await this.deps.db.getAllAsync<FolderRow & { script_count: number }>(
      `SELECT f.*, (SELECT COUNT(*) FROM scripts s WHERE s.folder_id = f.id AND s.deleted_at IS NULL) AS script_count
       FROM folders f ORDER BY f.sort_order ASC, f.created_at ASC`,
      [],
    );
    return rows.map((r) => ({ ...toFolder(r), scriptCount: Number(r.script_count) }));
  }

  /** Used by "Delete all my data". */
  async clearAll(): Promise<void> {
    await this.deps.db.runAsync('UPDATE scripts SET folder_id = NULL WHERE folder_id IS NOT NULL', []);
    await this.deps.db.runAsync('DELETE FROM folders', []);
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
  /** Saved without sound: the separately captured audio could not be merged (kept beside the file). */
  audioMissing: boolean;
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
  audio_missing?: number;
}

function parseCues(json: string | null): Cue[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as Cue[]).map(sanitizeCue) : null;
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
  captionStyle: isCaptionStyleId(r.caption_style) ? r.caption_style : null,
  captionPosition: r.caption_position === 'upper' || r.caption_position === 'middle' ? r.caption_position : 'lower',
  savedToLibrary: r.saved_to_library === 1,
  status: r.status === 'recovered' ? 'recovered' : 'ready',
  audioMissing: r.audio_missing === 1,
});

export class RecordingRepository {
  constructor(private readonly deps: Deps) {}

  async add(
    input: Omit<Recording, 'id' | 'createdAt' | 'cues' | 'captionStyle' | 'captionPosition' | 'savedToLibrary' | 'audioMissing'> & { id?: string; audioMissing?: boolean },
  ): Promise<Recording> {
    const rec: Recording = {
      ...input,
      audioMissing: input.audioMissing ?? false,
      id: input.id ?? this.deps.newId(),
      createdAt: this.deps.now(),
      cues: null,
      captionStyle: null,
      captionPosition: 'lower',
      savedToLibrary: false,
    };
    await this.deps.db.runAsync(
      `INSERT INTO recordings (id, script_id, file_name, duration_ms, width, height, created_at, status, audio_missing)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rec.id, rec.scriptId, rec.fileName, rec.durationMs, rec.width, rec.height, rec.createdAt, rec.status, rec.audioMissing ? 1 : 0],
    );
    return rec;
  }

  async get(id: string): Promise<Recording | null> {
    const row = await this.deps.db.getFirstAsync<RecordingRow>('SELECT * FROM recordings WHERE id = ?', [id]);
    return row ? toRecording(row) : null;
  }

  async list(opts: { limit?: number } = {}): Promise<Recording[]> {
    const limit = opts.limit != null ? ` LIMIT ${Math.max(0, Math.floor(opts.limit))}` : '';
    const rows = await this.deps.db.getAllAsync<RecordingRow>(`SELECT * FROM recordings ORDER BY created_at DESC${limit}`, []);
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

/** Prefix of free-tier usage counters in the key/value store; they survive "Delete all my data". */
export const USAGE_KEY_PREFIX = 'usage.';

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

  /** Deletes every key except those starting with one of `prefixes` (e.g. free-tier usage counters). */
  async clearAllExcept(prefixes: string[]): Promise<void> {
    const keep = prefixes.map(() => "key NOT LIKE ? ESCAPE '\\'").join(' AND ');
    await this.db.runAsync(`DELETE FROM kv${keep ? ` WHERE ${keep}` : ''}`, prefixes.map((p) => `${escapeLike(p)}%`));
  }
}
