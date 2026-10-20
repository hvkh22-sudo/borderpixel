import type { SqlExecutor } from './sql';

/**
 * Ordered schema migrations. Never edit a shipped migration; append a new one.
 * Large media lives on the file system; the DB stores file names only.
 */
export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS scripts (
     id TEXT PRIMARY KEY NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     favorite INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     last_opened_at INTEGER,
     deleted_at INTEGER
   );
   CREATE INDEX IF NOT EXISTS idx_scripts_updated ON scripts(updated_at DESC);
   CREATE TABLE IF NOT EXISTS script_versions (
     id TEXT PRIMARY KEY NOT NULL,
     script_id TEXT NOT NULL,
     body TEXT NOT NULL,
     source TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_versions_script ON script_versions(script_id, created_at DESC);
   CREATE TABLE IF NOT EXISTS recordings (
     id TEXT PRIMARY KEY NOT NULL,
     script_id TEXT,
     file_name TEXT NOT NULL,
     duration_ms INTEGER NOT NULL DEFAULT 0,
     width INTEGER,
     height INTEGER,
     created_at INTEGER NOT NULL,
     captions_json TEXT,
     caption_style TEXT,
     saved_to_library INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'ready'
   );
   CREATE INDEX IF NOT EXISTS idx_recordings_created ON recordings(created_at DESC);
   CREATE TABLE IF NOT EXISTS kv (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,
  `ALTER TABLE recordings ADD COLUMN caption_position TEXT NOT NULL DEFAULT 'lower';`,
  // Script organization: one optional folder per script. NULL folder_id = "No folder".
  `CREATE TABLE IF NOT EXISTS folders (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     sort_order INTEGER NOT NULL DEFAULT 0
   );
   ALTER TABLE scripts ADD COLUMN folder_id TEXT;
   CREATE INDEX IF NOT EXISTS idx_scripts_folder ON scripts(folder_id);`,
];

export async function migrate(db: SqlExecutor): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await db.execAsync('BEGIN');
    try {
      await db.execAsync(MIGRATIONS[version]!);
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
      await db.execAsync('COMMIT');
    } catch (e) {
      await db.execAsync('ROLLBACK');
      throw e;
    }
    version++;
  }
  return version;
}
