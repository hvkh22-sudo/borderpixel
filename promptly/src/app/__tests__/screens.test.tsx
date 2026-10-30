/**
 * @jest-environment node
 */
/* Render smoke tests for the main screens with real storage (node:sqlite). */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useSettings } from '../../state/settings';
import { SPEAKING_RATE_KEY, useSpeakingRate } from '../../state/speakingRate';
import { createRepos, renderScreen } from './testUtils';
import { useAccess } from '../../state/access';

let mockRepos: Awaited<ReturnType<typeof createRepos>>;
const mockPush = jest.fn();
const mockParams: Record<string, string> = {};

jest.mock('../../services/db', () => ({ getRepositories: () => Promise.resolve(mockRepos) }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
    Redirect: ({ href }: { href: string }) => {
      mockPush(`redirect:${href}`);
      return null;
    },
    Stack: { Screen: () => null },
  };
});

beforeEach(async () => {
  useAccess.setState({ loaded: true });
  mockRepos = await createRepos();
  mockPush.mockClear();
  for (const k of Object.keys(mockParams)) delete mockParams[k];
  useSettings.getState().hydrate({ onboardingDone: true });
  useSpeakingRate.getState().reset();
});

describe('Home', () => {
  it('redirects to onboarding on first run', async () => {
    useSettings.getState().hydrate({ onboardingDone: false });
    const Home = require('../index').default;
    await renderScreen(<Home />);
    expect(mockPush).toHaveBeenCalledWith('redirect:/onboarding');
  });

  it('shows the empty state and creates a sample script', async () => {
    const Home = require('../index').default;
    await renderScreen(<Home />);
    await screen.findByText('Your first video starts here');
    await fireEvent.press(screen.getByLabelText('Try a sample script'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/^\/prepare\/id\d+$/)));
    expect((await mockRepos.scripts.list()).length).toBe(1);
  });

  it('lists recent scripts', async () => {
    await mockRepos.scripts.create({ title: 'Launch day', body: 'We are live today.' });
    const Home = require('../index').default;
    await renderScreen(<Home />);
    expect(await screen.findByText('Launch day')).toBeTruthy();
  });
});

describe('Library', () => {
  it('filters by search text', async () => {
    await mockRepos.scripts.create({ title: 'Morning routine', body: 'wake up' });
    await mockRepos.scripts.create({ title: 'Camera tips', body: 'use light' });
    const Library = require('../scripts/index').default;
    await renderScreen(<Library />);
    await screen.findByText('Morning routine');
    await fireEvent.changeText(screen.getByLabelText('Search scripts'), 'camera');
    await waitFor(() => expect(screen.queryByText('Morning routine')).toBeNull());
    expect(screen.getByText('Camera tips')).toBeTruthy();
  });
});

describe('Editor', () => {
  it('loads a script and autosaves edits', async () => {
    const s = await mockRepos.scripts.create({ title: 'Draft', body: 'Hello there' });
    mockParams.id = s.id;
    const Editor = require('../scripts/[id]').default;
    await renderScreen(<Editor />);
    const input = await screen.findByDisplayValue('Hello there');
    await fireEvent.changeText(input, 'Hello there, creators');
    await waitFor(async () => expect((await mockRepos.scripts.get(s.id))?.body).toBe('Hello there, creators'), { timeout: 2000 });
    expect(screen.getByText(/3 words/)).toBeTruthy();
  });
});

describe('Paywall', () => {
  it('renders without store configuration and explains purchases are unavailable', async () => {
    const Paywall = require('../paywall').default;
    await renderScreen(<Paywall />);
    expect(screen.getByText('Promptly Pro')).toBeTruthy();
    expect(await screen.findByText('Purchases aren’t available right now. Please try again later.')).toBeTruthy();
  });
});

describe('Settings', () => {
  it('changes appearance', async () => {
    const Settings = require('../settings/index').default;
    await renderScreen(<Settings />);
    await fireEvent.press(screen.getByLabelText('Dark'));
    expect(useSettings.getState().appearance).toBe('dark');
  });
});

describe('Prepare', () => {
  it('renders the prompter preview and changes speed', async () => {
    const s = await mockRepos.scripts.create({ title: 'T', body: 'One two three four five six seven eight nine ten.' });
    mockParams.id = s.id;
    useSettings.getState().setPrompter({ mode: 'timed', wpm: 150 });
    const Prepare = require('../prepare/[id]').default;
    await renderScreen(<Prepare />);
    expect(await screen.findByText('150 words/min')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Speed +'));
    expect(useSettings.getState().prompter.wpm).toBe(160);
  });

  it('offers Voice Follow as a free trial and opens the camera with the chosen mode', async () => {
    const s = await mockRepos.scripts.create({ title: 'T', body: 'Hello world' });
    mockParams.id = s.id;
    const Prepare = require('../prepare/[id]').default;
    await renderScreen(<Prepare />);
    await fireEvent.press(await screen.findByLabelText('Voice Follow, PRO'));
    expect(screen.getByText('3 free Voice Follow takes left')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Open camera'));
    expect(mockPush).toHaveBeenCalledWith(`/record/${s.id}?mode=voice`);
  });

  it('does not downgrade Voice Follow or show the paywall before purchases have loaded', async () => {
    // A subscriber whose purchases have not loaded yet, with the free trial used up on this device.
    useAccess.setState({ loaded: false, usage: { voiceFollowSessionsUsed: 99 } });
    useSettings.setState({ prompter: { ...useSettings.getState().prompter, mode: 'voice' } });
    const s = await mockRepos.scripts.create({ title: 'T', body: 'Hello world' });
    mockParams.id = s.id;
    const Prepare = require('../prepare/[id]').default;
    await renderScreen(<Prepare />);
    await fireEvent.press(await screen.findByLabelText('Open camera'));
    expect(mockPush).toHaveBeenCalledWith(`/record/${s.id}?mode=voice`);
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('/paywall'));
    useAccess.setState({ usage: { voiceFollowSessionsUsed: 0 } });
  });
});

describe('Prepare presets', () => {
  it('applies a preset, shows it as active, and turns Custom after a manual change', async () => {
    const s = await mockRepos.scripts.create({ title: 'T', body: 'Hello world' });
    mockParams.id = s.id;
    const Prepare = require('../prepare/[id]').default;
    await renderScreen(<Prepare />);
    expect(await screen.findByText('Custom settings')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('YouTube'));
    expect(useSettings.getState().camera).toMatchObject({ orientation: 'landscape', resolution: '1080p', fps: 30 });
    expect(screen.getByLabelText('YouTube').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.queryByText('Custom settings')).toBeNull();

    await fireEvent.press(screen.getByLabelText('TikTok / Reels / Shorts'));
    expect(useSettings.getState().camera).toMatchObject({ orientation: 'portrait', fps: 30 });
    expect(useSettings.getState().prompter.readingLine).toBe(0.18);
    expect(useSettings.getState().captionPosition).toBe('lower');

    await fireEvent.press(screen.getByLabelText('Talking head 60 fps'));
    expect(useSettings.getState().camera.fps).toBe(60);

    // A custom change still works and the setup becomes Custom.
    await fireEvent.press(screen.getByLabelText('720p'));
    expect(useSettings.getState().camera.resolution).toBe('720p');
    expect(screen.getByText('Custom settings')).toBeTruthy();
    expect(screen.getByLabelText('Talking head 60 fps').props.accessibilityState).toMatchObject({ selected: false });
  });
});

describe('Learned speaking rate', () => {
  it('suggests the creator’s pace in Timed mode with one-tap “Use my pace”', async () => {
    await useSpeakingRate.getState().record({ wpm: 168, at: 1, source: 'voice' });
    await useSpeakingRate.getState().record({ wpm: 172, at: 2, source: 'timed' });
    expect((await mockRepos.kv.get<{ samples: unknown[] }>(SPEAKING_RATE_KEY, { samples: [] })).samples).toHaveLength(2);
    const s = await mockRepos.scripts.create({ title: 'T', body: 'One two three four five six seven eight nine ten.' });
    mockParams.id = s.id;
    useSettings.getState().setPrompter({ mode: 'timed', wpm: 150 });
    const Prepare = require('../prepare/[id]').default;
    await renderScreen(<Prepare />);
    expect(await screen.findByText(/Your pace: \d+ wpm$/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Use my pace'));
    expect(useSettings.getState().prompter.wpm).toBe(170);
    expect(screen.getByText(/Your pace: \d+ wpm · in use/)).toBeTruthy();
    expect(screen.queryByLabelText('Use my pace')).toBeNull();
  });

  it('shows nothing before enough takes, and duration estimates use the learned pace', async () => {
    const s = await mockRepos.scripts.create({ title: 'T', body: Array.from({ length: 200 }, () => 'word').join(' ') });
    mockParams.id = s.id;
    useSettings.getState().setPrompter({ mode: 'timed', wpm: 150 });
    const Prepare = require('../prepare/[id]').default;
    const r = await renderScreen(<Prepare />);
    await screen.findByText('150 words/min');
    expect(screen.queryByLabelText('Use my pace')).toBeNull();
    await r.unmount();

    const Editor = require('../scripts/[id]').default;
    const e = await renderScreen(<Editor />);
    expect(await screen.findByText(/200 words · ~1m 20s/)).toBeTruthy(); // default 150 wpm
    await e.unmount();
    await useSpeakingRate.getState().record({ wpm: 200, at: 1, source: 'voice' });
    await useSpeakingRate.getState().record({ wpm: 200, at: 2, source: 'voice' });
    await renderScreen(<Editor />);
    expect(await screen.findByText(/200 words · ~1m 0s/)).toBeTruthy();
  });
});

describe('Studio', () => {
  it('explains AI is not configured and still shows version history', async () => {
    const s = await mockRepos.scripts.create({ title: 'T', body: 'current' });
    await mockRepos.scripts.addVersion(s.id, 'older text', 'before_ai');
    mockParams.scriptId = s.id;
    const Studio = require('../studio').default;
    await renderScreen(<Studio />);
    expect(screen.getByText('AI Studio isn’t available in this build yet.')).toBeTruthy();
    await fireEvent.press(await screen.findByLabelText('Restore'));
    await waitFor(async () => expect((await mockRepos.scripts.get(s.id))?.body).toBe('older text'));
  });
});

describe('Takes', () => {
  it('shows empty state, then a take', async () => {
    const Takes = require('../takes').default;
    const r = await renderScreen(<Takes />);
    expect(await screen.findByText('No takes yet')).toBeTruthy();
    await r.unmount();
    await mockRepos.recordings.add({ scriptId: null, fileName: 'a.mp4', durationMs: 65_000, width: null, height: null, status: 'ready' });
    await renderScreen(<Takes />);
    expect(await screen.findByText(/1:05/)).toBeTruthy();
  });
});

describe('Subscription', () => {
  it('shows the free plan and an upgrade path', async () => {
    const Subscription = require('../settings/subscription').default;
    await renderScreen(<Subscription />);
    expect(screen.getByText('Free plan')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('See Pro plans'));
    expect(mockPush).toHaveBeenCalledWith('/paywall');
  });
});

/**
 * Accessibility audit: every pressable host element on the main screens exposes a role and a name
 * (accessibilityLabel or visible text), so screen-reader users hear what each control does.
 */
describe('Accessibility audit', () => {
  type Node = { type: unknown; props: Record<string, unknown>; children: (Node | string)[] };
  const textOf = (n: Node | string): string =>
    typeof n === 'string' ? n : [n.props.accessibilityLabel as string | undefined, ...n.children.map(textOf)].filter(Boolean).join(' ');
  function unnamedControls(): string[] {
    const bad: string[] = [];
    let controls = 0;
    const visit = (n: Node | string) => {
      if (typeof n === 'string') return;
      const hidden = n.props.accessibilityElementsHidden || n.props.importantForAccessibility === 'no-hide-descendants';
      if (hidden) return;
      const pressable = typeof n.type === 'string' && typeof n.props.onClick === 'function' && n.props.accessible !== false;
      if (pressable) {
        controls++;
        const name = ((n.props.accessibilityLabel as string | undefined) ?? textOf(n)).trim();
        const role = n.props.accessibilityRole ?? n.props.role;
        if (!name || !role) bad.push(`${String(n.props.testID ?? n.type)} role=${String(role)} name="${name}"`);
      }
      n.children.forEach(visit);
    };
    visit(screen.toJSON() as unknown as Node);
    // The audit must actually see the screen's controls, or it would pass vacuously.
    if (controls === 0) bad.push('no controls found');
    return bad;
  }

  it.each([
    ['Home', () => require('../index').default],
    ['Library', () => require('../scripts/index').default],
    ['Settings', () => require('../settings/index').default],
    ['Paywall', () => require('../paywall').default],
    ['Create', () => require('../create').default],
  ])('%s: every control has a role and a name', async (_name, load) => {
    await mockRepos.scripts.create({ title: 'A script', body: 'Hello world' });
    const Screen = load();
    await renderScreen(<Screen />);
    await new Promise((r) => setTimeout(r, 50));
    expect(unnamedControls()).toEqual([]);
  });

  it.each([
    ['Editor', () => require('../scripts/[id]').default],
    ['Prepare', () => require('../prepare/[id]').default],
  ])('%s: every control has a role and a name', async (_name, load) => {
    const s = await mockRepos.scripts.create({ title: 'A script', body: 'Hello world' });
    mockParams.id = s.id;
    const Screen = load();
    await renderScreen(<Screen />);
    await new Promise((res) => setTimeout(res, 50));
    expect(unnamedControls()).toEqual([]);
  });
});
