import { randomUUID } from 'expo-crypto';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { migrate } from '../storage/migrations';
import { FolderRepository, KeyValueStore, RecordingRepository, ScriptRepository } from '../storage/repositories';
import type { SqlExecutor } from '../storage/sql';

export interface Repositories {
  scripts: ScriptRepository;
  folders: FolderRepository;
  recordings: RecordingRepository;
  kv: KeyValueStore;
}

function adapt(db: SQLiteDatabase): SqlExecutor {
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: async (sql, params) => {
      const r = await db.runAsync(sql, params);
      return { changes: r.changes };
    },
    getAllAsync: (sql, params) => db.getAllAsync(sql, params),
    getFirstAsync: (sql, params) => db.getFirstAsync(sql, params),
  };
}

let repos: Promise<Repositories> | null = null;

export function getRepositories(): Promise<Repositories> {
  if (!repos) {
    repos = (async () => {
      const db = await openDatabaseAsync('promptly.db');
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      const exec = adapt(db);
      await migrate(exec);
      const deps = { db: exec, newId: randomUUID, now: Date.now };
      return {
        scripts: new ScriptRepository(deps),
        folders: new FolderRepository(deps),
        recordings: new RecordingRepository(deps),
        kv: new KeyValueStore(exec),
      };
    })();
    repos.catch(() => {
      repos = null;
    });
  }
  return repos;
}
