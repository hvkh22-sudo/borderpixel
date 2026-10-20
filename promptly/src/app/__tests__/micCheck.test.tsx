/**
 * @jest-environment node
 */
/* Mic check on the setup screen, with expo-audio and expo-file-system mocked. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useSettings } from '../../state/settings';
import { createRepos, renderScreen } from './testUtils';

let mockRepos: Awaited<ReturnType<typeof createRepos>>;
const mockPush = jest.fn();
const mockParams: Record<string, string> = {};
const mockCalls: string[] = [];
const mockAudio = {
  granted: true,
  metering: [] as number[],
  input: { name: 'iPhone Microphone', type: 'MicrophoneBuiltIn', uid: 'built-in' },
};

jest.mock('../../services/db', () => ({ getRepositories: () => Promise.resolve(mockRepos) }));
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('../../features/recording/micCheck', () => ({
  ...jest.requireActual('../../features/recording/micCheck'),
  MIC_CHECK_DURATION_MS: 200,
  MIC_CHECK_POLL_MS: 10,
}));
jest.mock('expo-file-system', () => ({
  File: class MockFile {
    mockUri: string;
    constructor(mockUri: string) {
      this.mockUri = mockUri;
    }
    get exists() {
      return true;
    }
    delete() {
      mockCalls.push(`delete:${this.mockUri}`);
    }
  },
}));
jest.mock('expo-audio', () => {
  const recorder = {
    id: 'rec',
    uri: null as string | null,
    isRecording: false,
    prepareToRecordAsync: async () => {
      mockCalls.push('prepare');
      recorder.uri = 'file:///cache/mic-check.m4a';
    },
    record: () => {
      mockCalls.push('record');
      recorder.isRecording = true;
    },
    stop: async () => {
      mockCalls.push('stop');
      recorder.isRecording = false;
    },
    getStatus: () => ({ metering: recorder.isRecording ? (mockAudio.metering.shift() ?? mockAudio.metering[0]) : undefined }),
    getCurrentInput: async () => mockAudio.input,
  };
  return {
    RecordingPresets: { LOW_QUALITY: {} },
    useAudioRecorder: () => recorder,
    requestRecordingPermissionsAsync: async () => ({ granted: mockAudio.granted, canAskAgain: true }),
    setAudioModeAsync: async (m: { allowsRecording?: boolean }) => mockCalls.push(`mode:${m.allowsRecording}`),
    setIsAudioActiveAsync: async (a: boolean) => mockCalls.push(`active:${a}`),
  };
});

const steady = (db: number) => Array.from({ length: 200 }, () => db);

async function openMicCheck() {
  const s = await mockRepos.scripts.create({ title: 'T', body: 'Hello world' });
  mockParams.id = s.id;
  const Prepare = require('../prepare/[id]').default;
  await renderScreen(<Prepare />);
  await fireEvent.press(await screen.findByLabelText('Mic check'));
  await fireEvent.press(screen.getByLabelText('Start mic check'));
  return s.id;
}

beforeEach(async () => {
  mockRepos = await createRepos();
  mockPush.mockClear();
  mockCalls.length = 0;
  mockAudio.granted = true;
  mockAudio.input = { name: 'iPhone Microphone', type: 'MicrophoneBuiltIn', uid: 'built-in' };
  useSettings.getState().hydrate({ onboardingDone: true });
});

describe('Mic check', () => {
  it('records, shows a verdict, deletes the clip and releases the session before the camera opens', async () => {
    mockAudio.metering = steady(-18);
    const id = await openMicCheck();
    expect(await screen.findByText('Sounds good', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText('Input: iPhone Microphone')).toBeTruthy();
    expect(screen.getByText(/^Tip: Bluetooth earbud mics/)).toBeTruthy();
    expect(mockCalls).toEqual([
      'active:true',
      'mode:true',
      'prepare',
      'record',
      'stop',
      'delete:file:///cache/mic-check.m4a',
      'mode:false',
      'active:false',
    ]);

    await fireEvent.press(screen.getByLabelText('Done'));
    expect(screen.getByText('Good')).toBeTruthy(); // last result on the setup row
    await fireEvent.press(screen.getByLabelText('Open camera'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/record/${id}?mode=timed`));
  });

  it('warns about Bluetooth earbud mics and reports silence', async () => {
    mockAudio.metering = steady(-160);
    mockAudio.input = { name: 'AirPods Pro', type: 'BluetoothHFP', uid: 'bt' };
    await openMicCheck();
    expect(await screen.findByText('No sound detected', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText('Input: AirPods Pro')).toBeTruthy();
    expect(screen.getByText(/^You’re using a Bluetooth mic/)).toBeTruthy();
  });

  it('flags clipping, then quiet input on a second check', async () => {
    mockAudio.metering = steady(-0.2);
    await openMicCheck();
    expect(await screen.findByText('Clipping — move back', {}, { timeout: 3000 })).toBeTruthy();
    mockAudio.metering = steady(-45);
    await fireEvent.press(screen.getByLabelText('Check again'));
    expect(await screen.findByText('Too quiet — move closer or check your mic', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('does not record without microphone permission', async () => {
    mockAudio.granted = false;
    await openMicCheck();
    expect(await screen.findByText('Microphone access is off. Allow it to run a mic check.')).toBeTruthy();
    expect(mockCalls).toEqual([]);
  });
});
