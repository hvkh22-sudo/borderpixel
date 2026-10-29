/**
 * @jest-environment node
 */
/* First-take guidance: Home checklist, setup hint, take hint. Real SQLite repositories. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { INITIAL_FIRST_RUN, loadFirstRun, type FirstRunFlags } from '../../features/onboarding/firstRun';
import { setAnalyticsSink, type AnalyticsEvent } from '../../services/analytics';
import { useFirstRun } from '../../state/firstRun';
import { useSettings } from '../../state/settings';
import { useSpeakingRate } from '../../state/speakingRate';
import { createRepos, renderScreen } from './testUtils';
import { useAccess } from '../../state/access';

let mockRepos: Awaited<ReturnType<typeof createRepos>>;
const mockPush = jest.fn();
const mockParams: Record<string, string> = {};

jest.mock('../../services/db', () => ({ getRepositories: () => Promise.resolve(mockRepos) }));
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

let events: AnalyticsEvent[] = [];

beforeEach(async () => {
  useAccess.setState({ loaded: true });
  mockRepos = await createRepos();
  mockPush.mockClear();
  for (const k of Object.keys(mockParams)) delete mockParams[k];
  useSettings.getState().hydrate({ onboardingDone: true });
  useSpeakingRate.getState().reset();
  useFirstRun.getState().hydrate(INITIAL_FIRST_RUN);
  events = [];
  setAnalyticsSink((e) => events.push(e));
});

const firstRunSteps = () => events.filter((e) => e.name === 'first_run_step').map((e) => (e as { step: string }).step);
const persisted = (): Promise<FirstRunFlags> => loadFirstRun(mockRepos.kv);
const addTake = (scriptId: string | null = null) =>
  mockRepos.recordings.add({ scriptId, fileName: 'take.mp4', durationMs: 4000, width: null, height: null, status: 'ready' });

describe('Home first-video checklist', () => {
  it('starts at "Write or paste" with one primary action', async () => {
    const Home = require('../index').default;
    await renderScreen(<Home />);
    expect(await screen.findByText('Your first video in 3 steps')).toBeTruthy();
    expect(screen.getByLabelText('Step 1 of 3: Write or paste, current step').props.accessibilityState).toMatchObject({ selected: true, checked: false });
    expect(screen.getAllByTestId('first-run-action')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('first-run-action'));
    expect(mockPush).toHaveBeenCalledWith('/create');
  });

  it('moves to Record once a script exists and opens its setup', async () => {
    const s = await mockRepos.scripts.create({ title: 'Launch', body: 'We are live.' });
    const Home = require('../index').default;
    await renderScreen(<Home />);
    expect(await screen.findByLabelText('Step 2 of 3: Record, current step')).toBeTruthy();
    expect(screen.getByLabelText('Step 1 of 3: Write or paste, done')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Record your first take'));
    expect(mockPush).toHaveBeenCalledWith(`/prepare/${s.id}`);
    await waitFor(async () => expect((await persisted()).firstScriptCreated).toBe(true));
    // Caught up from the library, not done now: marked without analytics.
    expect(firstRunSteps()).toEqual([]);
  });

  it('celebrates the first take and points at Export, then disappears after the first export', async () => {
    const s = await mockRepos.scripts.create({ title: 'Launch', body: 'We are live.' });
    const take = await addTake(s.id);
    const Home = require('../index').default;
    const r = await renderScreen(<Home />);
    expect(await screen.findByText('Your first take is ready')).toBeTruthy();
    expect(screen.getByLabelText('Step 3 of 3: Export, current step')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Open your take'));
    expect(mockPush).toHaveBeenCalledWith(`/take/${take.id}`);
    await r.unmount();

    useFirstRun.getState().complete('firstExport');
    await renderScreen(<Home />);
    await screen.findByText('Launch');
    expect(screen.queryByTestId('first-run-checklist')).toBeNull();
    expect(firstRunSteps()).toEqual(['exported']);
  });

  it('reconcile marks pre-existing scripts and takes silently; only real-time completions are tracked', async () => {
    const s = await mockRepos.scripts.create({ title: 'Launch', body: 'We are live.' });
    await addTake(s.id);
    const Home = require('../index').default;
    await renderScreen(<Home />);
    await screen.findByText('Your first take is ready');
    await waitFor(async () => expect(await persisted()).toMatchObject({ firstScriptCreated: true, firstTakeRecorded: true }));
    expect(firstRunSteps()).toEqual([]);
    useFirstRun.getState().complete('firstExport');
    expect(firstRunSteps()).toEqual(['exported']);
  });

  it('Hide removes the checklist for good', async () => {
    const Home = require('../index').default;
    const r = await renderScreen(<Home />);
    await fireEvent.press(await screen.findByLabelText('Hide'));
    expect(screen.queryByTestId('first-run-checklist')).toBeNull();
    await waitFor(async () => expect((await persisted()).checklistHidden).toBe(true));
    expect(firstRunSteps()).toEqual(['checklist_hidden']);
    await r.unmount();

    // Next launch: flags come back from storage, the checklist stays hidden even as steps complete.
    useFirstRun.getState().hydrate(await persisted());
    await mockRepos.scripts.create({ title: 'Launch', body: 'We are live.' });
    await renderScreen(<Home />);
    await screen.findByText('Launch');
    expect(screen.queryByTestId('first-run-checklist')).toBeNull();
  });

  it('shows nothing before the flags are hydrated', async () => {
    useFirstRun.getState().reset();
    const Home = require('../index').default;
    await renderScreen(<Home />);
    await screen.findByText('Your first video starts here');
    expect(screen.queryByTestId('first-run-checklist')).toBeNull();
  });
});

describe('Setup first-visit tip', () => {
  it('shows once, sets Timed for the first take, and never returns', async () => {
    const s = await mockRepos.scripts.create({ title: 'T', body: 'Hello world' });
    mockParams.id = s.id;
    useSettings.getState().setPrompter({ mode: 'manual' });
    const Prepare = require('../prepare/[id]').default;
    const r = await renderScreen(<Prepare />);
    const tip = await screen.findByTestId('setup-tip');
    expect(tip).toBeTruthy();
    expect(screen.getByText(/Read from the highlighted line/)).toBeTruthy();
    expect(screen.getByText('Prefer hands-free? Voice Follow has free trial takes.')).toBeTruthy();
    expect(useSettings.getState().prompter.mode).toBe('timed');
    await waitFor(async () => expect((await persisted()).setupTipSeen).toBe(true));
    // The camera stays one tap away; the tip does not block it.
    await fireEvent.press(screen.getByLabelText('Open camera'));
    expect(mockPush).toHaveBeenCalledWith(`/record/${s.id}?mode=timed`);
    await r.unmount();

    await renderScreen(<Prepare />);
    await screen.findByText('150 words/min');
    expect(screen.queryByTestId('setup-tip')).toBeNull();
  });

  it('dismisses inline with a labeled 48pt button', async () => {
    const s = await mockRepos.scripts.create({ title: 'T', body: 'Hello world' });
    mockParams.id = s.id;
    const Prepare = require('../prepare/[id]').default;
    await renderScreen(<Prepare />);
    const dismiss = await screen.findByTestId('setup-tip-dismiss');
    expect(dismiss.props.accessibilityLabel).toBe('Dismiss tip');
    expect(dismiss.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: 48, height: 48 })]));
    expect(screen.getByText(/Read from the highlighted line/).props.accessibilityLiveRegion).toBe('polite');
    await fireEvent.press(dismiss);
    expect(screen.queryByTestId('setup-tip')).toBeNull();
    expect(firstRunSteps()).toEqual(['setup_tip_dismissed']);
  });

  it('does not show after the first take', async () => {
    useFirstRun.getState().hydrate({ ...INITIAL_FIRST_RUN, firstScriptCreated: true, firstTakeRecorded: true });
    const s = await mockRepos.scripts.create({ title: 'T', body: 'Hello world' });
    mockParams.id = s.id;
    const Prepare = require('../prepare/[id]').default;
    await renderScreen(<Prepare />);
    await screen.findByText('150 words/min');
    expect(screen.queryByTestId('setup-tip')).toBeNull();
  });
});

describe('Take screen tip', () => {
  it('marks the first take, points at captions, then at Export', async () => {
    const take = await addTake();
    mockParams.id = take.id;
    const Take = require('../take/[id]').default;
    const r = await renderScreen(<Take />);
    expect(await screen.findByText(/Next: tap Add captions/)).toBeTruthy();
    await waitFor(async () => expect((await persisted()).firstTakeRecorded).toBe(true));
    expect(firstRunSteps()).toEqual(['script_created', 'take_recorded']);
    await r.unmount();

    await mockRepos.recordings.saveCaptions(take.id, [{ id: 'c1', startMs: 0, endMs: 1000, text: 'Hello' }] as never, 'clean');
    await renderScreen(<Take />);
    expect(await screen.findByText('Looks good? Tap Export to save or share it.')).toBeTruthy();
  });

  it('never renders after dismissal or after the first export', async () => {
    const take = await addTake();
    mockParams.id = take.id;
    const Take = require('../take/[id]').default;
    const r = await renderScreen(<Take />);
    await fireEvent.press(await screen.findByTestId('take-tip-dismiss'));
    expect(screen.queryByTestId('take-tip')).toBeNull();
    expect(firstRunSteps()).toContain('take_tip_dismissed');
    await r.unmount();
    const r2 = await renderScreen(<Take />);
    await screen.findByTestId('take-export');
    expect(screen.queryByTestId('take-tip')).toBeNull();
    await r2.unmount();

    useFirstRun.getState().hydrate({ ...INITIAL_FIRST_RUN, firstScriptCreated: true, firstTakeRecorded: true, firstExport: true });
    await renderScreen(<Take />);
    await screen.findByTestId('take-export');
    expect(screen.queryByTestId('take-tip')).toBeNull();
  });
});
