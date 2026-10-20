/**
 * @jest-environment node
 */
/* Screen-reader semantics of key screens: roles, labels, states and custom actions (see docs/design/accessibility-audit.md). */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useSettings } from '../../state/settings';
import { useSpeakingRate } from '../../state/speakingRate';
import { createRepos, renderScreen } from './testUtils';

let mockRepos: Awaited<ReturnType<typeof createRepos>>;
const mockPush = jest.fn();
const mockParams: Record<string, string> = {};
const mockTranscribe = jest.fn();

jest.mock('../../services/db', () => ({ getRepositories: () => Promise.resolve(mockRepos) }));
jest.mock('../../services/transcription', () => ({
  ...jest.requireActual('../../services/transcription'),
  transcribeRecording: (...a: unknown[]) => mockTranscribe(...a),
}));
jest.mock('../../services/files', () => ({
  recordingFile: (name: string) => ({ uri: `file:///docs/${name}`, exists: true }),
  deleteRecordingFile: jest.fn(),
  exportsDir: () => ({}),
  availableBytes: () => Number.MAX_SAFE_INTEGER,
}));
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ currentTime: 0, duration: 10, play: jest.fn(), pause: jest.fn() }),
  VideoView: () => null,
}));
jest.mock('expo', () => ({
  ...jest.requireActual('expo'),
  useEvent: (_p: unknown, _e: string, initial: unknown) => initial,
}));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
    Redirect: () => null,
    Stack: { Screen: () => null },
  };
});

beforeEach(async () => {
  mockRepos = await createRepos();
  mockPush.mockClear();
  mockTranscribe.mockReset();
  for (const k of Object.keys(mockParams)) delete mockParams[k];
  useSettings.getState().hydrate({ onboardingDone: true });
  useSettings.getState().setPrompter({ mode: 'timed', wpm: 150 });
  useSpeakingRate.getState().reset();
});

const action = (actionName: string) => ({ nativeEvent: { actionName } });

describe('Library rows', () => {
  it('read as one element with a full label and offer the row menu as custom actions', async () => {
    const s = await mockRepos.scripts.create({ title: 'Hook ideas', body: 'stop scrolling now' });
    await mockRepos.scripts.update(s.id, { favorite: true });
    const Library = require('../scripts/index').default;
    await renderScreen(<Library />);

    const row = await screen.findByRole('button', { name: /^Hook ideas, Favorite, ~\d/ });
    expect(row.props.accessibilityHint).toBe('Opens the editor');
    expect(row.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual(['favorite', 'move', 'duplicate', 'delete', 'longpress']);
    expect(row.props.accessibilityActions[0].label).toBe('Remove favorite');

    await fireEvent(row, 'accessibilityAction', action('favorite'));
    await waitFor(async () => expect((await mockRepos.scripts.get(s.id))?.favorite).toBe(false));

    await fireEvent(await screen.findByRole('button', { name: /^Hook ideas, ~\d/ }), 'accessibilityAction', action('delete'));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeTruthy();
    expect((await mockRepos.scripts.list()).length).toBe(0);
  });

  it('opens the move sheet with the title as the focused header', async () => {
    await mockRepos.scripts.create({ title: 'Hook ideas', body: 'stop scrolling' });
    const Library = require('../scripts/index').default;
    await renderScreen(<Library />);
    await fireEvent(await screen.findByRole('button', { name: /^Hook ideas,/ }), 'accessibilityAction', action('move'));
    expect(await screen.findByRole('header', { name: 'Move “Hook ideas” to' })).toBeTruthy();
    // The dimmed backdrop is touch-only; screen readers use Cancel / escape instead.
    expect(screen.queryByLabelText('Close')).toBeNull();
    expect(screen.getByRole('button', { name: 'No folder' }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('exposes filter chips and the sort control with state', async () => {
    const Library = require('../scripts/index').default;
    await renderScreen(<Library />);
    expect((await screen.findByRole('button', { name: 'All' })).props.accessibilityState).toMatchObject({ selected: true });
    // Containers are not accessibility elements (that would hide their radios on iOS), so query by label.
    expect(screen.getByLabelText('Sort by').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByRole('radio', { name: 'Last edited' }).props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe('Settings', () => {
  it('marks the chosen speech language as selected instead of a bare checkmark', async () => {
    useSettings.getState().set({ speechLocale: 'en-GB' });
    const Settings = require('../settings/index').default;
    await renderScreen(<Settings />);
    expect(screen.getByRole('button', { name: 'en-GB' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('button', { name: 'en-US' }).props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByRole('header', { name: 'Appearance' })).toBeTruthy();
  });
});

describe('Prepare', () => {
  it('exposes steppers as adjustable controls and toggles as labelled switches', async () => {
    const s = await mockRepos.scripts.create({ title: 'T', body: 'One two three four five.' });
    mockParams.id = s.id;
    const Prepare = require('../prepare/[id]').default;
    await renderScreen(<Prepare />);
    const speed = await screen.findByRole('adjustable', { name: 'Speed' });
    expect(speed.props.accessibilityValue).toEqual({ text: '150 words/min' });
    await fireEvent(speed, 'accessibilityAction', action('increment'));
    expect(useSettings.getState().prompter.wpm).toBe(160);
    await fireEvent(speed, 'accessibilityAction', action('decrement'));
    expect(useSettings.getState().prompter.wpm).toBe(150);
    expect(screen.getByRole('switch', { name: 'Mirror text' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Timed' }).props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe('Captions editor', () => {
  it('keeps each cue’s text field and buttons reachable, with a seek button per cue', async () => {
    const sc = await mockRepos.scripts.create({ title: 'T', body: 'Write your script.' });
    const r = await mockRepos.recordings.add({ scriptId: sc.id, fileName: 'take.mp4', durationMs: 4000, width: null, height: null, status: 'ready' });
    mockParams.id = r.id;
    mockTranscribe.mockResolvedValue({
      transcript: 'write your script',
      segments: ['write', 'your', 'script'].map((w, i) => ({ text: w, startMs: i * 400, endMs: i * 400 + 350, confidence: 0.9 })),
    });
    const Captions = require('../captions/[id]').default;
    await renderScreen(<Captions />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Generate captions' }));
    expect(await screen.findByRole('button', { name: 'Play from 0:00' })).toBeTruthy();
    expect(screen.getByLabelText('Caption 1, starts at 0:00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Shift all captions 0.1 seconds earlier' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Merge with next' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getAllByLabelText('Style').map((e) => e.props.accessibilityRole)).toEqual(['header', 'radiogroup']);
  });
});
