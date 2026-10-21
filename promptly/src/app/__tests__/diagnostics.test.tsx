/**
 * @jest-environment node
 */
/* Diagnostics screen: facts, overrides persisted to KV, copyable report, hidden entry in Settings. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { diagnosticsLog, DIAGNOSTICS_LOG_KEY } from '../../services/diagnosticsLog';
import { DEFAULT_OVERRIDES, OVERRIDES_KEY, useDiagnosticsOverrides } from '../../services/diagnosticsOverrides';
import { useSettings } from '../../state/settings';
import { createRepos, renderScreen } from './testUtils';

let mockRepos: Awaited<ReturnType<typeof createRepos>>;
const mockPush = jest.fn();
const mockCopy = jest.fn<Promise<boolean>, [string]>(async () => true);

jest.mock('../../services/db', () => ({ getRepositories: () => Promise.resolve(mockRepos) }));
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: (s: string) => mockCopy(s), getStringAsync: async () => '' }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '42' }));
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: () => true,
    supportsRecording: () => true,
    supportsOnDeviceRecognition: () => true,
    getSupportedLocales: async () => ({ locales: ['he-IL', 'en-US'], installedLocales: ['en-US'] }),
    addListener: () => ({ remove() {} }),
  },
}));
jest.mock('../../services/nativeMedia', () => ({
  PromptlyMedia: { isAvailable: () => true, remoteKeysAvailable: () => false },
}));
beforeEach(async () => {
  mockRepos = await createRepos();
  mockPush.mockReset();
  mockCopy.mockClear();
  useDiagnosticsOverrides.setState(DEFAULT_OVERRIDES);
  useSettings.getState().hydrate({ speechLocale: 'he-IL' });
  await diagnosticsLog.clear();
});

async function open() {
  const Diagnostics = require('../settings/diagnostics').default;
  await renderScreen(<Diagnostics />);
  await screen.findByTestId('diagnostics-facts');
}

describe('Diagnostics screen', () => {
  it('shows device facts, decisions and recent errors', async () => {
    diagnosticsLog.record('mux', 'mux_failed_ios', new Error('Export failed for file:///var/x.wav'));
    await open();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Recorded by the camera')).toBeTruthy();
    expect(screen.getByText(/2 supported: en-US, he-IL/)).toBeTruthy();
    expect(screen.getByText(/mux · mux_failed_ios — Export failed for <path>/)).toBeTruthy();
  });

  it('switching the iOS strategy persists it and changes the audio decision', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('diagnostics-vf-separate'));
    expect(await screen.findByText('Recorded separately, merged after the take')).toBeTruthy();
    await waitFor(async () => expect(await mockRepos.kv.get(OVERRIDES_KEY, null)).toMatchObject({ iosVoiceFollowAudio: 'separate' }));

    await fireEvent.press(screen.getByTestId('diagnostics-vf-default'));
    expect(await screen.findByText('Recorded by the camera')).toBeTruthy();
    await waitFor(async () => expect(await mockRepos.kv.get(OVERRIDES_KEY, null)).toMatchObject({ iosVoiceFollowAudio: null }));
  });

  it('burn-in and integrity toggles persist', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('diagnostics-burnin-on'));
    await fireEvent(screen.getByTestId('diagnostics-integrity'), 'valueChange', false);
    await waitFor(async () =>
      expect(await mockRepos.kv.get(OVERRIDES_KEY, null)).toEqual({ iosVoiceFollowAudio: null, burnIn: 'on', integrityHeaders: false }),
    );
    expect(useDiagnosticsOverrides.getState().burnIn).toBe('on');
  });

  it('copies a plain-text report without user content', async () => {
    await mockRepos.scripts.create({ title: 'Secret title', body: 'My private script' });
    diagnosticsLog.record('speech', 'audio-capture');
    await open();
    await fireEvent.press(screen.getByTestId('diagnostics-copy'));
    expect(mockCopy).toHaveBeenCalledTimes(1);
    const report = mockCopy.mock.calls[0]![0];
    expect(report).toContain('Promptly diagnostics report');
    expect(report).toContain('build: 42');
    expect(report).toContain('speech audio-capture');
    expect(report).not.toContain('private');
    expect(report).not.toContain('Secret');
    expect(screen.getByTestId('diagnostics-notice')).toBeTruthy();
  });

  it('clears the error list', async () => {
    diagnosticsLog.record('export', 'srt');
    await open();
    await fireEvent.press(screen.getByTestId('diagnostics-clear-errors'));
    expect(await screen.findByText('No errors recorded.')).toBeTruthy();
    expect(await mockRepos.kv.get(DIAGNOSTICS_LOG_KEY, null)).toEqual([]);
  });
});

describe('Settings hidden entry', () => {
  it('opens diagnostics after 5 taps on the version', async () => {
    const Settings = require('../settings/index').default;
    await renderScreen(<Settings />);
    const version = screen.getByTestId('settings-version');
    for (let i = 0; i < 4; i++) await fireEvent.press(version);
    expect(mockPush).not.toHaveBeenCalled();
    await fireEvent.press(version);
    expect(mockPush).toHaveBeenCalledWith('/settings/diagnostics');
  });
});
