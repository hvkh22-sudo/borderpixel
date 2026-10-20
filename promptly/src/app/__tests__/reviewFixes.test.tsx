/**
 * @jest-environment node
 */
/* Editor ↔ Studio sync, auto titles, data deletion and paywall defaults (real SQLite). */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { useSettings } from '../../state/settings';
import { createRepos, renderScreen } from './testUtils';

let mockRepos: Awaited<ReturnType<typeof createRepos>>;
const mockParams: Record<string, string> = {};
const mockFocus: { cb: null | (() => void | (() => void)) } = { cb: null };
const mockFetchPackages = jest.fn();
const mockPurchase = jest.fn();

jest.mock('../../services/db', () => ({ getRepositories: () => Promise.resolve(mockRepos) }));
jest.mock('../../services/purchases', () => ({
  fetchPackages: () => mockFetchPackages(),
  purchase: (...a: unknown[]) => mockPurchase(...a),
  restore: jest.fn(),
}));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useLocalSearchParams: () => mockParams,
    // Runs on mount like a first focus; tests call mockFocus.cb() to simulate returning to the screen.
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockFocus.cb = cb;
      React.useEffect(cb, [cb]);
    },
    Stack: { Screen: () => null },
  };
});

const USAGE_VF_KEY = 'usage.voiceFollowSessions';
const refocus =() => act(async () => void mockFocus.cb?.());

beforeEach(async () => {
  mockRepos = await createRepos();
  for (const k of Object.keys(mockParams)) delete mockParams[k];
  mockFocus.cb = null;
  useSettings.getState().hydrate({ onboardingDone: true });
});

describe('Editor after Studio', () => {
  it('shows the applied AI draft on return and does not overwrite it with stale text', async () => {
    const s = await mockRepos.scripts.create({ title: 'Draft', body: 'Original text' });
    mockParams.id = s.id;
    const Editor = require('../scripts/[id]').default;
    await renderScreen(<Editor />);
    await screen.findByDisplayValue('Original text');

    // Studio (a modal over the editor) applies a draft directly in storage.
    await mockRepos.scripts.update(s.id, { body: 'AI draft' });
    await refocus();
    const input = await screen.findByDisplayValue('AI draft');

    await fireEvent.changeText(input, 'AI draft, edited');
    await waitFor(async () => expect((await mockRepos.scripts.get(s.id))?.body).toBe('AI draft, edited'), { timeout: 2000 });
  });

  it('keeps pending local edits when the screen regains focus', async () => {
    const s = await mockRepos.scripts.create({ title: 'Draft', body: 'Original text' });
    mockParams.id = s.id;
    const Editor = require('../scripts/[id]').default;
    await renderScreen(<Editor />);
    await fireEvent.changeText(await screen.findByDisplayValue('Original text'), 'Typed locally');
    await refocus();
    expect(screen.getByDisplayValue('Typed locally')).toBeTruthy();
  });
});

describe('Editor autosave', () => {
  it('keeps an edit whose save failed dirty and saves it on the next flush', async () => {
    const s = await mockRepos.scripts.create({ title: 'Draft', body: 'Original text' });
    mockParams.id = s.id;
    const realUpdate = mockRepos.scripts.update.bind(mockRepos.scripts);
    const update = jest.spyOn(mockRepos.scripts, 'update').mockRejectedValueOnce(new Error('disk full')).mockImplementation(realUpdate);
    const Editor = require('../scripts/[id]').default;
    const view = await renderScreen(<Editor />);
    await fireEvent.changeText(await screen.findByDisplayValue('Original text'), 'Edited once');
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1), { timeout: 2000 });
    // Leaving the screen flushes again: the failed edit is retried, not lost.
    view.unmount();
    await waitFor(async () => expect((await mockRepos.scripts.get(s.id))?.body).toBe('Edited once'), { timeout: 2000 });
  });
});

describe('Editor auto title', () => {
  it('keeps deriving the title from the first line until the user edits the title', async () => {
    const s = await mockRepos.scripts.create({ title: 'Untitled script', body: '' });
    mockParams.id = s.id;
    const Editor = require('../scripts/[id]').default;
    await renderScreen(<Editor />);
    await screen.findByTestId('editor-folder-chip'); // loaded
    const body = screen.getByTestId('editor-body');
    await fireEvent.changeText(body, 'H');
    await fireEvent.changeText(body, 'Hello world');
    expect(screen.getByTestId('editor-title').props.value).toBe('Hello world');
    await waitFor(async () => expect((await mockRepos.scripts.get(s.id))?.title).toBe('Hello world'), { timeout: 2000 });

    await fireEvent.changeText(screen.getByTestId('editor-title'), 'My title');
    await fireEvent.changeText(body, 'Hello world, again');
    expect(screen.getByTestId('editor-title').props.value).toBe('My title');
  });

  it('never replaces a title the user chose', async () => {
    const s = await mockRepos.scripts.create({ title: 'Launch plan', body: 'Hello' });
    mockParams.id = s.id;
    const Editor = require('../scripts/[id]').default;
    await renderScreen(<Editor />);
    await fireEvent.changeText(await screen.findByDisplayValue('Hello'), 'Hello there');
    expect(screen.getByTestId('editor-title').props.value).toBe('Launch plan');
  });
});

describe('Delete all my data', () => {
  it('keeps the free Voice Follow usage counter', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mockRepos.kv.set(USAGE_VF_KEY, 3);
    await mockRepos.kv.set('settings', { appearance: 'dark' });
    await mockRepos.scripts.create({ title: 'T', body: 'x' });
    const Privacy = require('../settings/privacy').default;
    await renderScreen(<Privacy />);
    await fireEvent.press(screen.getByLabelText('Delete all my data'));
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { style?: string; onPress?: () => Promise<void> }[];
    await act(async () => buttons.find((b) => b.style === 'destructive')!.onPress!());
    expect(await mockRepos.kv.get(USAGE_VF_KEY, 0)).toBe(3);
    expect(await mockRepos.kv.get('settings', null)).toBeNull();
    expect(await mockRepos.scripts.list()).toEqual([]);
  });
});

describe('Paywall', () => {
  it('selects an available plan when the offering has no annual package', async () => {
    const monthly = { identifier: 'm', product: { priceString: '$4.99' } };
    mockFetchPackages.mockResolvedValue({ monthly, annual: null, lifetime: null });
    mockPurchase.mockResolvedValue({ status: 'cancelled' });
    const Paywall = require('../paywall').default;
    await renderScreen(<Paywall />);
    const option = await screen.findByLabelText('Monthly, $4.99/month');
    expect(option.props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId('paywall-subscribe'));
    await waitFor(() => expect(mockPurchase).toHaveBeenCalledWith(monthly));
  });
});
