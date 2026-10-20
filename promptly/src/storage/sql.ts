/**
 * Minimal async SQL executor. Implemented by expo-sqlite's SQLiteDatabase in
 * the app and by node:sqlite in tests, so repositories run real SQL in CI.
 */
export type SqlValue = string | number | null;

export interface SqlExecutor {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SqlValue[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: SqlValue[]): Promise<T | null>;
}
