/* Shared helpers for screen tests: real SQLite repositories + router mocks. */
import type { ReactElement } from 'react';
import { render } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { migrate } from '../../storage/migrations';
import { FolderRepository, KeyValueStore, RecordingRepository, ScriptRepository } from '../../storage/repositories';
import { createTestDb } from '../../storage/__tests__/nodeSqlite';
import { ThemeProvider } from '../../theme/ThemeProvider';

export async function createRepos() {
  const db = createTestDb();
  await migrate(db);
  let n = 0;
  const deps = { db, newId: () => `id${++n}`, now: () => Date.UTC(2026, 9, 20) + n };
  return { scripts: new ScriptRepository(deps), folders: new FolderRepository(deps), recordings: new RecordingRepository(deps), kv: new KeyValueStore(db) };
}

export function renderScreen(ui: ReactElement) {
  return render(
    <GestureHandlerRootView>
      <ThemeProvider>{ui}</ThemeProvider>
    </GestureHandlerRootView>,
  );
}
