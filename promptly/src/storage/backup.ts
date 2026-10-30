/**
 * Local script backup: a single, versioned JSON file with scripts, their
 * version history and folders. Recordings are not included (they are large
 * media and stay in the documents directory).
 *
 * Serialize / parse / merge are pure; `collectBackup` and `importBackup` are
 * thin glue over the repositories. Import merges and never overwrites: an
 * existing row is never updated or deleted.
 */
import type { Folder, FolderRepository, Script, ScriptRepository, ScriptVersionRow } from './repositories';
import { normalizeFolderName } from './repositories';

export const BACKUP_FORMAT = 'promptly.scripts-backup';
export const BACKUP_VERSION = 1;

export interface BackupData {
  folders: Folder[];
  scripts: Script[];
  versions: ScriptVersionRow[];
}

export interface BackupFile extends BackupData {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
}

export type BackupErrorCode = 'invalid_json' | 'not_a_backup' | 'unsupported_version' | 'malformed';

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'BackupError';
  }
}

export function serializeBackup(data: BackupData, exportedAt: number): string {
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    folders: data.folders.map((f) => ({ id: f.id, name: f.name, createdAt: f.createdAt, sortOrder: f.sortOrder })),
    scripts: data.scripts.map((s) => ({
      id: s.id,
      title: s.title,
      body: s.body,
      favorite: s.favorite,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lastOpenedAt: s.lastOpenedAt,
      folderId: s.folderId,
    })),
    versions: data.versions.map((v) => ({ id: v.id, scriptId: v.scriptId, body: v.body, source: v.source, createdAt: v.createdAt })),
  };
  return JSON.stringify(file, null, 2);
}

// ----- Parsing (strict structure, tolerant of dangling references) -----

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;
// Epoch ms no later than a day from now: a far-future time would sort first forever or show "Invalid Date".
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= Date.now() + 24 * 60 * 60 * 1000;

function fail(detail: string): never {
  throw new BackupError('malformed', detail);
}

function parseFolder(v: unknown, i: number): Folder {
  if (!isObj(v) || !isId(v.id) || typeof v.name !== 'string' || !isTime(v.createdAt) || typeof v.sortOrder !== 'number' || !Number.isFinite(v.sortOrder)) {
    fail(`folders[${i}]`);
  }
  const name = normalizeFolderName(v.name);
  if (!name) fail(`folders[${i}].name`);
  return { id: v.id, name, createdAt: v.createdAt, sortOrder: v.sortOrder };
}

function parseScript(v: unknown, i: number): Script {
  if (
    !isObj(v) ||
    !isId(v.id) ||
    typeof v.title !== 'string' ||
    typeof v.body !== 'string' ||
    typeof v.favorite !== 'boolean' ||
    !isTime(v.createdAt) ||
    !isTime(v.updatedAt) ||
    !(v.lastOpenedAt === null || isTime(v.lastOpenedAt)) ||
    !(v.folderId === null || isId(v.folderId))
  ) {
    fail(`scripts[${i}]`);
  }
  return {
    id: v.id,
    title: v.title,
    body: v.body,
    favorite: v.favorite,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    lastOpenedAt: v.lastOpenedAt,
    folderId: v.folderId,
  };
}

function parseVersion(v: unknown, i: number): ScriptVersionRow {
  if (!isObj(v) || !isId(v.id) || !isId(v.scriptId) || typeof v.body !== 'string' || typeof v.source !== 'string' || !isTime(v.createdAt)) {
    fail(`versions[${i}]`);
  }
  return { id: v.id, scriptId: v.scriptId, body: v.body, source: v.source, createdAt: v.createdAt };
}

function assertUniqueIds(rows: { id: string }[], what: string): void {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) fail(`duplicate ${what} id`);
    seen.add(r.id);
  }
}

/**
 * Validates a backup file. Throws `BackupError` for anything that is not a
 * well-formed backup of a supported version. A script pointing at a folder
 * missing from the file lands in "No folder"; versions of scripts missing from
 * the file are dropped (they cannot be shown without their script).
 */
export function parseBackup(text: string): BackupData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('invalid_json');
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) throw new BackupError('not_a_backup');
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1 || raw.version > BACKUP_VERSION) {
    throw new BackupError('unsupported_version', String(raw.version));
  }
  if (!Array.isArray(raw.folders) || !Array.isArray(raw.scripts) || !Array.isArray(raw.versions)) fail('missing arrays');

  const folders = raw.folders.map(parseFolder);
  const scripts = raw.scripts.map(parseScript);
  const versions = raw.versions.map(parseVersion);
  assertUniqueIds(folders, 'folder');
  assertUniqueIds(scripts, 'script');
  assertUniqueIds(versions, 'version');

  const folderIds = new Set(folders.map((f) => f.id));
  const scriptIds = new Set(scripts.map((s) => s.id));
  return {
    folders,
    scripts: scripts.map((s) => (s.folderId && !folderIds.has(s.folderId) ? { ...s, folderId: null } : s)),
    versions: versions.filter((v) => scriptIds.has(v.scriptId)),
  };
}

// ----- Merge planning -----

export interface ExistingState {
  folders: Folder[];
  /** Every stored script id (including soft-deleted) with the fields used to detect an identical copy. */
  scripts: Map<string, Pick<Script, 'title' | 'body' | 'updatedAt'> & { deleted?: boolean }>;
  versionIds: Set<string>;
}

export interface MergePlan extends BackupData {
  /** Scripts whose stored copy is soft-deleted: restored in place (same id) with the backup's content. */
  restoredScripts: Script[];
  /** Scripts already present unchanged (same id, title, body and edit time) — not imported twice. */
  skippedScripts: number;
}

const folderKey = (name: string) => normalizeFolderName(name).toLocaleLowerCase();

/**
 * Plans an import that only adds rows. Rules:
 * - A folder whose name matches an existing folder (case-insensitive) is merged into it.
 * - A script identical to a stored one (same id, title, body, updatedAt) is skipped.
 * - A script whose stored copy is soft-deleted is restored in place with the backup's content.
 * - Any other id that collides gets a fresh id; references are rewritten.
 */
export function planMerge(existing: ExistingState, incoming: BackupData, newId: () => string): MergePlan {
  const taken = new Set<string>([...existing.folders.map((f) => f.id), ...existing.scripts.keys(), ...existing.versionIds]);
  const freshId = (id: string) => {
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
    let next = newId();
    while (taken.has(next)) next = newId();
    taken.add(next);
    return next;
  };

  const byName = new Map(existing.folders.map((f) => [folderKey(f.name), f.id]));
  let nextOrder = existing.folders.reduce((m, f) => Math.max(m, f.sortOrder), -1) + 1;
  const folderMap = new Map<string, string>();
  const folders: Folder[] = [];
  for (const f of [...incoming.folders].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)) {
    const match = byName.get(folderKey(f.name));
    if (match) {
      folderMap.set(f.id, match);
      continue;
    }
    const id = freshId(f.id);
    folderMap.set(f.id, id);
    byName.set(folderKey(f.name), id);
    folders.push({ ...f, id, sortOrder: nextOrder++ });
  }

  const scriptMap = new Map<string, string>();
  const skipped = new Set<string>();
  const scripts: Script[] = [];
  const restoredScripts: Script[] = [];
  const restored = new Set<string>();
  // The same content under another id is a copy a previous import already added: skip it, so
  // importing one backup twice never duplicates scripts.
  const contentKey = (s: Pick<Script, 'title' | 'body' | 'updatedAt'>) => `${s.updatedAt}\u0000${s.title}\u0000${s.body}`;
  const present = new Set([...existing.scripts.values()].filter((s) => !s.deleted).map(contentKey));
  for (const s of incoming.scripts) {
    const stored = existing.scripts.get(s.id);
    if (stored?.deleted) {
      // Deleted on this device since the backup: bring it back rather than treating it as present.
      restored.add(s.id);
      scriptMap.set(s.id, s.id);
      restoredScripts.push({ ...s, folderId: s.folderId ? (folderMap.get(s.folderId) ?? null) : null });
      continue;
    }
    if (stored && stored.title === s.title && stored.body === s.body && stored.updatedAt === s.updatedAt) {
      skipped.add(s.id);
      scriptMap.set(s.id, s.id);
      continue;
    }
    if (present.has(contentKey(s))) {
      skipped.add(s.id);
      continue;
    }
    present.add(contentKey(s));
    const id = freshId(s.id);
    scriptMap.set(s.id, id);
    scripts.push({ ...s, id, folderId: s.folderId ? (folderMap.get(s.folderId) ?? null) : null });
  }

  const versions: ScriptVersionRow[] = [];
  for (const v of incoming.versions) {
    const scriptId = scriptMap.get(v.scriptId);
    if (!scriptId) continue;
    // Versions of a skipped (already present) or restored script: add only the ones not stored yet.
    if ((skipped.has(v.scriptId) || restored.has(v.scriptId)) && existing.versionIds.has(v.id)) continue;
    versions.push({ ...v, id: freshId(v.id), scriptId });
  }

  return { folders, scripts, restoredScripts, versions, skippedScripts: skipped.size };
}

// ----- Repository glue -----

export interface BackupRepos {
  scripts: ScriptRepository;
  folders: FolderRepository;
}

export async function collectBackup(repos: BackupRepos): Promise<BackupData> {
  const [{ scripts, versions }, folders] = await Promise.all([repos.scripts.exportAll(), repos.folders.list()]);
  return { folders, scripts, versions };
}

export interface ImportResult {
  scriptsAdded: number;
  foldersAdded: number;
  versionsAdded: number;
  skippedScripts: number;
}

/** Parses and merges a backup file into storage. Throws `BackupError` before writing anything if the file is invalid. */
export async function importBackup(repos: BackupRepos, text: string, newId: () => string): Promise<ImportResult> {
  const incoming = parseBackup(text);
  const [folders, ids] = await Promise.all([repos.folders.list(), repos.scripts.existingIds()]);
  const plan = planMerge({ folders, scripts: ids.scripts, versionIds: ids.versions }, incoming, newId);
  for (const f of plan.folders) await repos.folders.insert(f);
  for (const s of plan.scripts) await repos.scripts.insertImported(s);
  for (const s of plan.restoredScripts) {
    // The stored (deleted) copy may be newer than the backup: keep it as a version, never overwrite it.
    const stored = ids.scripts.get(s.id);
    if (stored && stored.body !== s.body) await repos.scripts.addVersion(s.id, stored.body, 'before_restore');
    await repos.scripts.restoreImported(s);
  }
  for (const v of plan.versions) await repos.scripts.insertImportedVersion(v);
  return {
    scriptsAdded: plan.scripts.length + plan.restoredScripts.length,
    foldersAdded: plan.folders.length,
    versionsAdded: plan.versions.length,
    skippedScripts: plan.skippedScripts,
  };
}

/** File name for an export, e.g. `promptly-scripts-2026-10-20.json` (local date). */
export function backupFileName(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `promptly-scripts-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}.json`;
}
