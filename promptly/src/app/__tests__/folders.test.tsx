/**
 * @jest-environment node
 */
/* Script organization: folders in the Library and the editor, and scripts export. Real storage (node:sqlite). */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import { BACKUP_FORMAT, parseBackup } from '../../storage/backup';
import { createRepos, renderScreen } from './testUtils';

let mockRepos: Awaited<ReturnType<typeof createRepos>>;
const mockPush = jest.fn();
const mockParams: Record<string, string> = {};
const mockShare = jest.fn((..._a: unknown[]) => Promise.resolve());
const mockWritten: Record<string, string> = {};

jest.mock('../../services/db', () => ({ getRepositories: () => Promise.resolve(mockRepos) }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
    // Render header buttons so they can be pressed like any other control.
    Stack: { Screen: ({ options }: { options?: { headerRight?: () => unknown } }) => options?.headerRight?.() ?? null },
  };
});
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(true),
  shareAsync: (...a: unknown[]) => mockShare(...a),
}));
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    exists = false;
    constructor(_dir: unknown, name: string) {
      this.uri = `file:///cache/exports/${name}`;
    }
    delete() {}
    async write(text: string) {
      mockWritten[this.uri] = text;
    }
  },
  Directory: class {},
  Paths: {},
}));
jest.mock('../../services/files', () => ({ exportsDir: () => ({}), deleteRecordingFile: jest.fn() }));

beforeEach(async () => {
  mockRepos = await createRepos();
  mockPush.mockClear();
  mockShare.mockClear();
  for (const k of Object.keys(mockParams)) delete mockParams[k];
});

afterEach(() => jest.restoreAllMocks());

const Library = () => {
  const Screen = require('../scripts/index').default;
  return <Screen />;
};

/** The sheet's option rows (inside the Modal), not the chip row behind it. */
const sheetButton = (label: string) => {
  const all = screen.getAllByLabelText(label);
  return all[all.length - 1]!;
};

describe('Library folders', () => {
  it('creates a folder from the chip row and opens it', async () => {
    await mockRepos.scripts.create({ title: 'Morning routine', body: 'wake up' });
    await renderScreen(<Library />);
    await screen.findByText('Morning routine');
    expect(screen.getByLabelText('All').props.accessibilityState.selected).toBe(true);

    await fireEvent.press(screen.getByLabelText('New folder'));
    await fireEvent.changeText(await screen.findByLabelText('Folder name'), '  Product launches ');
    await fireEvent.press(screen.getByLabelText('Create'));

    const chip = await screen.findByLabelText('Product launches, 0 scripts');
    expect(chip.props.accessibilityState.selected).toBe(true);
    expect(await screen.findByText('This folder is empty')).toBeTruthy();
    expect((await mockRepos.folders.list()).map((f) => f.name)).toEqual(['Product launches']);
  });

  it('moves a script to a folder from its menu', async () => {
    const s = await mockRepos.scripts.create({ title: 'Hook ideas', body: 'stop scrolling' });
    const f = await mockRepos.folders.create('Hooks');
    await renderScreen(<Library />);
    await fireEvent(await screen.findByLabelText(/^Hook ideas,/), 'longPress');
    await fireEvent.press(await screen.findByLabelText('Move to folder'));
    expect(screen.getByText('Move “Hook ideas” to')).toBeTruthy();
    expect(screen.getByLabelText('No folder').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(sheetButton('Hooks'));

    await waitFor(async () => expect((await mockRepos.scripts.get(s.id))?.folderId).toBe(f.id));
    expect(await screen.findByLabelText('Hooks, 1 scripts')).toBeTruthy();
  });

  it('moves a script into a brand-new folder from the menu', async () => {
    const s = await mockRepos.scripts.create({ title: 'Tutorial', body: 'step one' });
    await renderScreen(<Library />);
    await fireEvent.press(await screen.findByLabelText('More actions'));
    await fireEvent.press(await screen.findByLabelText('Move to folder'));
    await fireEvent.press(sheetButton('New folder'));
    await fireEvent.changeText(await screen.findByLabelText('Folder name'), 'How-tos');
    await fireEvent.press(screen.getByLabelText('Create'));
    await waitFor(async () => expect((await mockRepos.scripts.get(s.id))?.folderId).toBeTruthy());
    expect((await mockRepos.folders.listWithCounts()).map((x) => [x.name, x.scriptCount])).toEqual([['How-tos', 1]]);
  });

  it('filters by folder and keeps search working inside it', async () => {
    const f = await mockRepos.folders.create('Series');
    await mockRepos.scripts.create({ title: 'Episode one', body: 'pilot', folderId: f.id });
    await mockRepos.scripts.create({ title: 'Episode two', body: 'sequel', folderId: f.id });
    await mockRepos.scripts.create({ title: 'Loose episode idea', body: 'pilot' });
    await renderScreen(<Library />);
    await screen.findByText('Loose episode idea');

    await fireEvent.press(screen.getByLabelText('Series, 2 scripts'));
    await waitFor(() => expect(screen.queryByText('Loose episode idea')).toBeNull());
    expect(screen.getByText('Episode one')).toBeTruthy();
    expect(screen.getByText('Episode two')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Search scripts'), 'pilot');
    await waitFor(() => expect(screen.queryByText('Episode two')).toBeNull());
    expect(screen.getByText('Episode one')).toBeTruthy();
    expect(screen.queryByText('Loose episode idea')).toBeNull();

    await fireEvent.press(screen.getByLabelText('All'));
    expect(await screen.findByText('Loose episode idea')).toBeTruthy();
  });

  it('new scripts start in the folder being viewed', async () => {
    const f = await mockRepos.folders.create('Ads');
    await renderScreen(<Library />);
    await fireEvent.press(await screen.findByLabelText('Ads, 0 scripts'));
    await screen.findByText('This folder is empty');
    await fireEvent.press(screen.getByLabelText('New script'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/^\/scripts\/id\d+$/)));
    const [created] = await mockRepos.scripts.list({ folderId: f.id });
    expect(mockPush).toHaveBeenCalledWith(`/scripts/${created!.id}`);
  });

  it('renames a folder from a long-press on its chip', async () => {
    const f = await mockRepos.folders.create('Drafts');
    await renderScreen(<Library />);
    await fireEvent(await screen.findByLabelText('Drafts, 0 scripts'), 'longPress');
    await fireEvent.press(await screen.findByLabelText('Rename'));
    await fireEvent.changeText(await screen.findByDisplayValue('Drafts'), 'Final cuts');
    await fireEvent.press(screen.getByLabelText('Save'));
    expect(await screen.findByLabelText('Final cuts, 0 scripts')).toBeTruthy();
    expect((await mockRepos.folders.get(f.id))?.name).toBe('Final cuts');
  });

  it('deleting a folder keeps its scripts (they move to No folder)', async () => {
    const f = await mockRepos.folders.create('Old campaign');
    const a = await mockRepos.scripts.create({ title: 'Promo A', body: 'buy now', folderId: f.id });
    const b = await mockRepos.scripts.create({ title: 'Promo B', body: 'last chance', folderId: f.id });
    const alert = jest.spyOn(Alert, 'alert');
    await renderScreen(<Library />);
    await fireEvent.press(await screen.findByLabelText('Old campaign, 2 scripts'));
    await screen.findByText('Promo A');

    await fireEvent(screen.getByLabelText('Old campaign, 2 scripts'), 'longPress');
    await fireEvent.press(await screen.findByLabelText('Delete folder'));
    expect(alert).toHaveBeenCalledWith('Delete folder', 'Delete “Old campaign”? Its scripts move to No folder. No script is deleted.', expect.any(Array));
    const buttons = alert.mock.calls[0]![2] as AlertButton[];
    await act(async () => {
      await buttons.find((x) => x.style === 'destructive')!.onPress!();
    });

    await waitFor(() => expect(screen.queryByLabelText('Old campaign, 2 scripts')).toBeNull());
    expect(screen.getByLabelText('All').props.accessibilityState.selected).toBe(true);
    expect(screen.getByText('Promo A')).toBeTruthy();
    expect(screen.getByText('Promo B')).toBeTruthy();
    expect(await mockRepos.folders.list()).toEqual([]);
    expect((await mockRepos.scripts.get(a.id))?.folderId).toBeNull();
    expect((await mockRepos.scripts.get(b.id))?.body).toBe('last chance');
  });

  it('shows a favorites empty state', async () => {
    await mockRepos.scripts.create({ title: 'Plain', body: 'x' });
    await renderScreen(<Library />);
    await screen.findByText('Plain');
    await fireEvent.press(screen.getByLabelText('Favorites'));
    expect(await screen.findByText('No favorites yet')).toBeTruthy();
  });
});

describe('Editor folder chip', () => {
  it('shows the current folder and moves the script', async () => {
    const f = await mockRepos.folders.create('Hooks');
    const s = await mockRepos.scripts.create({ title: 'Draft', body: 'Hello there' });
    mockParams.id = s.id;
    const Editor = require('../scripts/[id]').default;
    await renderScreen(<Editor />);
    await fireEvent.press(await screen.findByLabelText('Folder: No folder'));
    const sheet = within(screen.getByText('Move “Draft” to').parent!.parent!);
    await fireEvent.press(sheet.getByLabelText('Hooks'));
    expect(await screen.findByLabelText('Folder: Hooks')).toBeTruthy();
    expect((await mockRepos.scripts.get(s.id))?.folderId).toBe(f.id);
  });
});

describe('Export my scripts', () => {
  it('shares one versioned JSON file with scripts, versions and folders', async () => {
    const f = await mockRepos.folders.create('Hooks');
    const s = await mockRepos.scripts.create({ title: 'Hook', body: 'Stop scrolling', folderId: f.id });
    await mockRepos.scripts.addVersion(s.id, 'older', 'before_ai');
    const Privacy = require('../settings/privacy').default;
    await renderScreen(<Privacy />);
    await fireEvent.press(screen.getByLabelText('Export my scripts'));

    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    const [uri, opts] = mockShare.mock.calls[0]! as [string, { mimeType: string }];
    expect(uri).toMatch(/promptly-scripts-\d{4}-\d{2}-\d{2}\.json$/);
    expect(opts.mimeType).toBe('application/json');
    const text = mockWritten[uri]!;
    expect(JSON.parse(text).format).toBe(BACKUP_FORMAT);
    const data = parseBackup(text);
    expect(data.scripts.map((x) => [x.title, x.folderId])).toEqual([['Hook', f.id]]);
    expect(data.versions.map((v) => v.body)).toEqual(['older']);
    expect(data.folders.map((x) => x.name)).toEqual(['Hooks']);
  });

  it('explains when there is nothing to export', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const Privacy = require('../settings/privacy').default;
    await renderScreen(<Privacy />);
    await fireEvent.press(screen.getByLabelText('Export my scripts'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('There are no scripts to export yet.'));
    expect(mockShare).not.toHaveBeenCalled();
  });
});
