/* Test-only SqlExecutor backed by Node's built-in SQLite. */
import type { SqlExecutor, SqlValue } from '../sql';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...p: SqlValue[]): { changes: number | bigint };
      all(...p: SqlValue[]): unknown[];
      get(...p: SqlValue[]): unknown;
    };
  };
};

export function createTestDb(): SqlExecutor {
  const db = new DatabaseSync(':memory:');
  return {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, params) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async getAllAsync<T>(sql: string, params: SqlValue[]) {
      return db.prepare(sql).all(...params).map((r) => ({ ...(r as object) })) as T[];
    },
    async getFirstAsync<T>(sql: string, params: SqlValue[]) {
      const r = db.prepare(sql).get(...params);
      return (r ? { ...(r as object) } : null) as T | null;
    },
  };
}
