/**
 * @jest-environment node
 */
/* Settings › Privacy: import a scripts backup through the document picker. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { collectBackup, serializeBackup } from '../../storage/backup';
import { createRepos, renderScreen } from './testUtils';

let mockRepos: Awaited<ReturnType<typeof createRepos>>;
const mockPick = jest.fn();

jest.mock('../../services/db', () => ({ getRepositories: () => Promise.resolve(mockRepos) }));
jest.mock('../../services/backupImport', () => ({ pickBackupText: () => mockPick() }));
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `imp${++n}` };
});
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));

beforeEach(async () => {
  mockRepos = await createRepos();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

it('imports scripts from another device without overwriting', async () => {
  const source = await createRepos();
  await source.scripts.create({ title: 'From phone A', body: 'hello' });
  mockPick.mockResolvedValue(serializeBackup(await collectBackup(source as never), Date.UTC(2026, 9, 20)));
  await mockRepos.scripts.create({ title: 'Local', body: 'keep me' });

  const Privacy = require('../settings/privacy').default;
  await renderScreen(<Privacy />);
  await fireEvent.press(screen.getByLabelText('Import scripts'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Imported 1 scripts and 0 folders.'));
  expect((await mockRepos.scripts.list()).map((s) => s.title).sort()).toEqual(['From phone A', 'Local']);
});

it('rejects files that are not backups', async () => {
  mockPick.mockResolvedValue('{"hello": 1}');
  const Privacy = require('../settings/privacy').default;
  await renderScreen(<Privacy />);
  await fireEvent.press(screen.getByLabelText('Import scripts'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('This file isn’t a Promptly scripts backup.'));
});

it('restores a script that was deleted after the backup was made', async () => {
  const s = await mockRepos.scripts.create({ title: 'Oops', body: 'deleted by mistake' });
  mockPick.mockResolvedValue(serializeBackup(await collectBackup(mockRepos as never), Date.UTC(2026, 9, 20)));
  await mockRepos.scripts.remove(s.id);

  const Privacy = require('../settings/privacy').default;
  await renderScreen(<Privacy />);
  await fireEvent.press(screen.getByLabelText('Import scripts'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Imported 1 scripts and 0 folders.'));
  expect((await mockRepos.scripts.get(s.id))?.body).toBe('deleted by mistake');
});
