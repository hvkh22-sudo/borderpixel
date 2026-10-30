/**
 * @jest-environment node
 */
/*
 * Camera / record screen. VisionCamera, the speech recognizer, the native media module and the
 * file system are scriptable fakes; the database is real SQLite. Fake timers drive the
 * countdown, the recording timer and the Voice Follow stop delay.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState, Linking, Platform } from 'react-native';

import { FREE_ACCESS, LIMITS } from '../../features/monetization/entitlements';
import { INITIAL_FIRST_RUN } from '../../features/onboarding/firstRun';
import { USAGE_VF_KEY } from '../../hooks/useBootstrap';
import { setAnalyticsSink, type AnalyticsEvent } from '../../services/analytics';
import { useAccess } from '../../state/access';
import { useFirstRun } from '../../state/firstRun';
import { useSettings } from '../../state/settings';
import { useSpeakingRate } from '../../state/speakingRate';
import { createRepos, renderScreen } from './testUtils';

// ---------------------------------------------------------------------------
// Harness state (names start with `mock` so jest.mock factories may read them).

let mockRepos: Awaited<ReturnType<typeof createRepos>>;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockParams: Record<string, string> = {};

/** In-memory file system: file:// uri -> size in bytes. */
const mockFs = new Map<string, number>();
const mockDisk = { free: 50 * 1024 ** 3 };
const mockFileUri = (p: string) => (p.startsWith('file://') ? p : `file://${p}`);

type Finished = (filePath: string, reason: 'stopped' | 'max-duration-reached' | 'max-file-size-reached') => void;

class MockRecorder {
  onFinished: Finished | null = null;
  onError: ((e: Error) => void) | null = null;
  stopCalls = 0;
  constructor(readonly filePath: string) {}
  async startRecording(onFinished: Finished, onError: (e: Error) => void) {
    this.onFinished = onFinished;
    this.onError = onError;
    if (mockCam.startGate) await mockCam.startGate;
    mockFs.set(mockFileUri(this.filePath), 1000);
  }
  async stopRecording() {
    this.stopCalls++;
    // The native recorder reports "finished" asynchronously after stop resolves.
    if (mockCam.autoFinish) void Promise.resolve().then(() => this.finish());
  }
  finish(reason: Parameters<Finished>[1] = 'stopped') {
    mockFs.set(mockFileUri(this.filePath), 5000);
    this.onFinished?.(this.filePath, reason);
  }
  fail(error = new Error('encoder died')) {
    this.onError?.(error);
  }
}

type Perm = { has: boolean; canRequest: boolean };
const mockCam = {
  perms: { camera: { has: true, canRequest: true } as Perm, mic: { has: true, canRequest: true } as Perm },
  listeners: new Set<() => void>(),
  requests: [] as string[],
  outputOptions: [] as { enableAudio?: boolean }[],
  recorders: [] as MockRecorder[],
  startGate: null as Promise<void> | null,
  autoFinish: true,
  isActive: [] as boolean[],
  setPerm(kind: 'camera' | 'mic', p: Partial<Perm>) {
    this.perms = { ...this.perms, [kind]: { ...this.perms[kind], ...p } };
    this.listeners.forEach((l) => l());
  },
};

const mockSpeech = {
  listeners: new Map<string, Set<(e: unknown) => void>>(),
  start: jest.fn(),
  stop: jest.fn(),
  emit(name: string, e: unknown) {
    this.listeners.get(name)?.forEach((cb) => cb(e));
  },
};

const mockMedia = {
  keyListeners: new Set<(e: { key: string; repeat: boolean }) => void>(),
  setRemoteKeysEnabled: jest.fn(),
  muxAudio: jest.fn(async (_job: string, _video: string, _segments: { uri: string; offsetMs: number }[], output: string) => {
    mockFs.set(output, 6000);
    return output;
  }),
};

interface MockPrompterProps {
  followCharOffset: number | null;
  highlightCharOffset?: number;
  playing: boolean;
  mode: string;
  onTapChar(c: number): void;
}
const mockPrompter = {
  props: null as MockPrompterProps | null,
  handle: { restart: jest.fn(), jumpToChar: jest.fn(), nudgeLines: jest.fn() },
  capture(props: MockPrompterProps) {
    mockPrompter.props = props;
  },
};

let mockUuid = 0;

// ---------------------------------------------------------------------------
// Module mocks.

jest.mock('../../services/db', () => ({ getRepositories: () => Promise.resolve(mockRepos) }));
jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockRouter.push(...a),
    replace: (...a: unknown[]) => mockRouter.replace(...a),
    back: (...a: unknown[]) => mockRouter.back(...a),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid${++mockUuid}` }));

jest.mock('expo-file-system', () => {
  const join = (base: string, name: string) => `${base.replace(/\/$/, '')}/${name}`;
  class Directory {
    uri: string;
    constructor(parent: { uri: string } | string, name?: string) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = `${name ? join(base, name) : base.replace(/\/$/, '')}/`;
    }
    exists = true;
    create() {}
    list() {
      return [];
    }
  }
  class File {
    uri: string;
    constructor(parent: { uri: string } | string, name?: string) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = name ? join(base, name) : base;
    }
    get exists() {
      return mockFs.has(this.uri);
    }
    get name() {
      return this.uri.split('/').pop();
    }
    info() {
      return { size: mockFs.get(this.uri) };
    }
    async copy(dest: File) {
      mockFs.set(dest.uri, mockFs.get(this.uri) ?? 0);
    }
    async move(dest: File) {
      mockFs.set(dest.uri, mockFs.get(this.uri) ?? 0);
      mockFs.delete(this.uri);
      this.uri = dest.uri;
    }
    delete() {
      mockFs.delete(this.uri);
    }
  }
  return {
    File,
    Directory,
    Paths: {
      document: new Directory('file:///docs'),
      cache: new Directory('file:///cache'),
      get availableDiskSpace() {
        return mockDisk.free;
      },
    },
  };
});

jest.mock('react-native-vision-camera', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const usePerm = (kind: 'camera' | 'mic') => {
    const p = React.useSyncExternalStore(
      (l: () => void) => {
        mockCam.listeners.add(l);
        return () => mockCam.listeners.delete(l);
      },
      () => mockCam.perms[kind],
    ) as Perm;
    return {
      hasPermission: p.has,
      canRequestPermission: p.canRequest,
      requestPermission: async () => {
        mockCam.requests.push(kind);
        mockCam.setPerm(kind, { has: true });
        return true;
      },
    };
  };
  return {
    Camera: (props: { isActive: boolean; onStarted?: () => void }) => {
      mockCam.isActive.push(props.isActive);
      const onStarted = React.useRef(props.onStarted);
      React.useEffect(() => onStarted.current?.(), []);
      return React.createElement(View, { testID: 'camera' });
    },
    useCameraPermission: () => usePerm('camera'),
    useMicrophonePermission: () => usePerm('mic'),
    useVideoOutput: (opts: { enableAudio?: boolean }) => {
      mockCam.outputOptions.push(opts);
      return React.useMemo(
        () => ({
          createRecorder: async (settings: { filePath: string }) => {
            const r = new MockRecorder(settings.filePath);
            mockCam.recorders.push(r);
            return r;
          },
        }),
        [],
      );
    },
  };
});

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: () => true,
    supportsRecording: () => true,
    supportsOnDeviceRecognition: () => true,
    getPermissionsAsync: () => Promise.resolve({ granted: true, canAskAgain: true }),
    requestPermissionsAsync: () => Promise.resolve({ granted: true }),
    start: (o: unknown) => mockSpeech.start(o),
    stop: () => mockSpeech.stop(),
    addListener: (name: string, cb: (e: unknown) => void) => {
      const set = mockSpeech.listeners.get(name) ?? new Set();
      set.add(cb);
      mockSpeech.listeners.set(name, set);
      return { remove: () => set.delete(cb) };
    },
  },
  AVAudioSessionCategory: {},
  AVAudioSessionCategoryOptions: {},
  AVAudioSessionMode: {},
  AudioEncodingAndroid: { ENCODING_PCM_16BIT: 2 },
}));

// The real nativeMedia facade runs over a fake `PromptlyMedia` native module.
jest.mock('expo', () => {
  const actual = jest.requireActual('expo');
  return {
    ...actual,
    requireOptionalNativeModule: (name: string) =>
      name === 'PromptlyMedia'
        ? {
            setRemoteKeysEnabled: (on: boolean) => mockMedia.setRemoteKeysEnabled(on),
            muxAudio: (...a: Parameters<typeof mockMedia.muxAudio>) => mockMedia.muxAudio(...a),
            cancel: () => {},
            addListener: (event: string, cb: (e: { key: string; repeat: boolean }) => void) => {
              if (event === 'onRemoteKey') mockMedia.keyListeners.add(cb);
              return { remove: () => mockMedia.keyListeners.delete(cb) };
            },
          }
        : actual.requireOptionalNativeModule(name),
  };
});

// The real Teleprompter animates with Reanimated; a prop-recording stand-in keeps these tests
// about the camera screen (its own behaviour is covered by teleprompter tests).
jest.mock('../../features/teleprompter/Teleprompter', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    Teleprompter: React.forwardRef(function MockTeleprompter(props: MockPrompterProps, ref: unknown) {
      mockPrompter.capture(props);
      React.useImperativeHandle(ref, () => mockPrompter.handle);
      return React.createElement(Text, { testID: 'prompter' }, `follow:${props.followCharOffset} playing:${props.playing}`);
    }),
  };
});

// ---------------------------------------------------------------------------

const SCRIPT = 'Hello and welcome to the channel. Today we talk about cameras, lights and sound for creators.';
let events: (AnalyticsEvent & { t: number })[] = [];
let appStateHandler: ((s: string) => void) | null = null;

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  mockRepos = await createRepos();
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.back.mockClear();
  for (const k of Object.keys(mockParams)) delete mockParams[k];
  mockFs.clear();
  mockDisk.free = 50 * 1024 ** 3;
  mockCam.perms = { camera: { has: true, canRequest: true }, mic: { has: true, canRequest: true } };
  mockCam.requests = [];
  mockCam.outputOptions = [];
  mockCam.recorders = [];
  mockCam.startGate = null;
  mockCam.autoFinish = true;
  mockCam.isActive = [];
  mockSpeech.listeners.clear();
  mockSpeech.start.mockClear();
  mockSpeech.stop.mockClear();
  mockMedia.keyListeners.clear();
  mockMedia.setRemoteKeysEnabled.mockClear();
  mockMedia.muxAudio.mockClear();
  mockPrompter.props = null;
  Object.values(mockPrompter.handle).forEach((f) => f.mockClear());
  mockUuid = 0;
  events = [];
  setAnalyticsSink((e) => events.push(e));
  appStateHandler = null;
  (AppState.addEventListener as jest.Mock).mockImplementation((_type: string, cb: (s: string) => void) => {
    appStateHandler = cb;
    return { remove: () => (appStateHandler = null) };
  });
  useSettings.getState().reset();
  useSettings.getState().setPrompter({ countdownSec: 0, mode: 'timed' });
  useAccess.setState({ access: FREE_ACCESS, usage: { voiceFollowSessionsUsed: 0 }, loaded: true });
  useSpeakingRate.getState().reset();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function openRecord(mode?: 'timed' | 'voice' | 'manual') {
  const s = await mockRepos.scripts.create({ title: 'T', body: SCRIPT });
  mockParams.id = s.id;
  if (mode) mockParams.mode = mode;
  const Record = require('../record/[id]').default;
  await renderScreen(<Record />);
  await screen.findByTestId('prompter');
  return s;
}

const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
const recordButton = () => screen.getByTestId('record-button');
const recorder = () => mockCam.recorders[mockCam.recorders.length - 1]!;

async function startTake() {
  await press('record-button');
  await waitFor(() => expect(screen.getByTestId('record-timer')).toBeTruthy());
}

async function stopTakeAndSave() {
  await press('record-button');
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
  return mockRouter.replace.mock.calls[0]![0] as string;
}

// ---------------------------------------------------------------------------

describe('Record: permission gate', () => {
  it('requests the camera, then the microphone, then shows the camera', async () => {
    mockCam.perms = { camera: { has: false, canRequest: true }, mic: { has: false, canRequest: true } };
    mockParams.id = 'missing';
    await renderScreen(<RecordWithScript />);
    expect(screen.getByText('Camera and microphone')).toBeTruthy();
    expect(screen.queryByTestId('camera')).toBeNull();
    await press('record-permission-allow');
    expect(mockCam.requests).toEqual(['camera', 'mic']);
    expect(await screen.findByTestId('camera')).toBeTruthy();
  });

  it('sends the user to Settings when a permission is blocked', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    mockCam.perms = { camera: { has: true, canRequest: true }, mic: { has: false, canRequest: false } };
    mockParams.id = 'missing';
    await renderScreen(<RecordWithScript />);
    expect(screen.getByText('Open Settings')).toBeTruthy();
    await press('record-permission-allow');
    expect(openSettings).toHaveBeenCalled();
    expect(mockCam.requests).toEqual([]);
  });
});

/** Renders the screen without awaiting the prompter (the gate has no prompter). */
function RecordWithScript() {
  const Record = require('../record/[id]').default;
  return <Record />;
}

describe('Record: timed take', () => {
  it('counts down, records, stops, saves the take and opens it', async () => {
    useSettings.getState().setPrompter({ countdownSec: 3 });
    const s = await openRecord();
    expect(mockCam.outputOptions.at(-1)).toMatchObject({ enableAudio: true, fileType: 'mp4' });

    await press('record-button');
    expect(screen.getByTestId('record-countdown')).toHaveTextContent('3', { exact: false });
    await advance(1000);
    expect(screen.getByTestId('record-countdown')).toHaveTextContent('2', { exact: false });
    await advance(1000);
    expect(screen.getByTestId('record-countdown')).toHaveTextContent('1', { exact: false });
    expect(mockCam.recorders).toHaveLength(0);
    await advance(1000);
    await waitFor(() => expect(screen.getByTestId('record-timer')).toBeTruthy());
    expect(screen.queryByTestId('record-countdown')).toBeNull();
    expect(mockPrompter.props?.playing).toBe(true); // timed scrolling starts with the take
    expect(recorder().filePath).toBe('/docs/recordings/take_uuid1.mp4');

    await advance(2600);
    expect(screen.getByTestId('record-timer')).toHaveTextContent('0:02', { exact: false });

    const route = await stopTakeAndSave();
    const rows = await mockRepos.recordings.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scriptId: s.id, fileName: 'take_uuid1.mp4', status: 'ready' });
    expect(rows[0]!.durationMs).toBeGreaterThanOrEqual(2600);
    expect(route).toBe(`/take/${rows[0]!.id}`);

    expect(events.map((e) => e.name)).toEqual(['recording_started', 'recording_completed']);
    expect(events[1]).toMatchObject({ mode: 'timed', durationSec: 3 });
    // Analytics never carry script content or file names.
    const payload = JSON.stringify(events);
    expect(payload).not.toMatch(/Hello|welcome|take_uuid|docs/);
  });

  it('cancels the countdown when tapped', async () => {
    useSettings.getState().setPrompter({ countdownSec: 3 });
    await openRecord();
    await press('record-button');
    await press('record-countdown');
    expect(screen.queryByTestId('record-countdown')).toBeNull();
    await advance(5000);
    expect(mockCam.recorders).toHaveLength(0);
  });

  it('ignores a double-tap on Stop: one stop, one saved take', async () => {
    await openRecord();
    await startTake();
    mockCam.autoFinish = false;
    await press('record-button');
    await press('record-button');
    expect(recorder().stopCalls).toBe(1);
    expect(screen.getByTestId('record-finalizing')).toBeTruthy();
    await act(async () => recorder().finish());
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledTimes(1));
    expect(await mockRepos.recordings.list()).toHaveLength(1);
  });

  it('a double-tap on Record starts one take and the second tap stops it', async () => {
    await openRecord();
    await press('record-button');
    await press('record-button');
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledTimes(1));
    expect(mockCam.recorders).toHaveLength(1);
    expect(recorder().stopCalls).toBe(1);
    expect(await mockRepos.recordings.list()).toHaveLength(1);
  });

  it('Stop while the recorder is still starting is queued and the take is saved', async () => {
    let release!: () => void;
    mockCam.startGate = new Promise<void>((r) => (release = r));
    await openRecord();
    await press('record-button');
    await waitFor(() => expect(mockCam.recorders).toHaveLength(1));
    expect(recordButton().props.accessibilityState).toMatchObject({ busy: true });
    await press('record-button'); // status 'starting' → stop is queued
    expect(recorder().stopCalls).toBe(0);
    await act(async () => release());
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledTimes(1));
    expect(recorder().stopCalls).toBe(1);
    expect(await mockRepos.recordings.list()).toHaveLength(1);
  });
});

describe('Record: Voice Follow (iOS)', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'ios');
  });

  it('follows the speaker, resyncs on tap, survives a recognizer error and uses a free trial take', async () => {
    await openRecord('voice');
    expect(mockCam.outputOptions.at(-1)).toMatchObject({ enableAudio: true });
    expect(mockPrompter.props?.followCharOffset).toBe(0);

    await startTake();
    await waitFor(() => expect(mockSpeech.start).toHaveBeenCalledTimes(1));
    expect(mockSpeech.start.mock.calls[0]![0]).toMatchObject({ lang: 'en-US', recordingOptions: undefined });
    expect(await screen.findByText('Listening')).toBeTruthy();
    // Non-Pro: the take used one of the free Voice Follow sessions.
    await waitFor(() => expect(useAccess.getState().usage.voiceFollowSessionsUsed).toBe(1));
    expect(await mockRepos.kv.get(USAGE_VF_KEY, 0)).toBe(1);

    await act(async () => mockSpeech.emit('result', { isFinal: false, results: [{ transcript: 'hello and welcome to the channel today' }] }));
    expect(await screen.findByText('Following')).toBeTruthy();
    const followed = mockPrompter.props!.followCharOffset!;
    expect(followed).toBeGreaterThan(SCRIPT.indexOf('channel'));
    expect(mockPrompter.props!.highlightCharOffset).toBe(followed);

    // Tap a line: the prompter jumps and Voice Follow resyncs to that position.
    const target = SCRIPT.indexOf('cameras');
    await act(async () => mockPrompter.props!.onTapChar(target));
    expect(mockPrompter.handle.jumpToChar).toHaveBeenCalledWith(target);
    // Voice Follow resyncs to just before the tapped word (it has not been read yet).
    await waitFor(() => expect(mockPrompter.props!.followCharOffset).toBeLessThanOrEqual(target));
    expect(mockPrompter.props!.followCharOffset).toBeGreaterThan(SCRIPT.lastIndexOf(' ', target - 2));

    // Recognizer failure: message shown, recording continues.
    await act(async () => mockSpeech.emit('error', { error: 'network', message: 'offline' }));
    expect(await screen.findByText('Voice Follow stopped. Scroll manually or tap to retry.')).toBeTruthy();
    expect(screen.getByTestId('record-timer')).toBeTruthy();
    expect(recorder().stopCalls).toBe(0);
    expect(events.some((e) => e.name === 'voice_follow_failed' && e.code === 'network')).toBe(true);

    await press('record-button');
    await advance(500); // Voice Follow stop waits for the last audio file
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/take\/uuid\d+$/)));
    expect(mockSpeech.stop).toHaveBeenCalled();
    expect(mockMedia.muxAudio).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).not.toMatch(/welcome|channel|cameras/);
  });

  it('does not count trial takes for Pro users', async () => {
    useAccess.setState({ access: { ...FREE_ACCESS, isPro: true, source: 'subscription' } });
    await openRecord('voice');
    await startTake();
    await waitFor(() => expect(mockSpeech.start).toHaveBeenCalled());
    await advance(300);
    expect(useAccess.getState().usage.voiceFollowSessionsUsed).toBe(0);
    expect(await mockRepos.kv.get(USAGE_VF_KEY, 0)).toBe(0);
  });

  it('opens the paywall when the free trial is used up', async () => {
    useAccess.setState({ usage: { voiceFollowSessionsUsed: LIMITS.freeVoiceFollowSessions } });
    await openRecord('voice');
    await press('record-button');
    expect(mockRouter.push).toHaveBeenCalledWith('/paywall?trigger=voiceFollow');
    expect(mockCam.recorders).toHaveLength(0);
  });
});

describe('Record: Voice Follow (Android)', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
  });

  it('records video only and muxes the recognizer audio at the right offsets', async () => {
    await openRecord('voice');
    expect(mockCam.outputOptions.at(-1)).toMatchObject({ enableAudio: false });

    await startTake();
    await waitFor(() => expect(mockSpeech.start).toHaveBeenCalled());
    expect(mockSpeech.start.mock.calls[0]![0]).toMatchObject({ recordingOptions: { persist: true } });
    const startedAt = Date.now();

    // Two recognizer sessions, each persisting a WAV file.
    await act(async () => {
      mockSpeech.emit('audiostart', { uri: 'file:///cache/a1.wav', timestamp: startedAt + 120 });
      mockSpeech.emit('audioend', { uri: 'file:///cache/a1.wav' });
      mockSpeech.emit('audiostart', { uri: 'file:///cache/a2.wav', timestamp: startedAt + 4000 });
    });
    await advance(5000);
    await press('record-button');
    await act(async () => mockSpeech.emit('audioend', { uri: 'file:///cache/a2.wav' })); // arrives after stop
    await advance(500);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());

    expect(mockMedia.muxAudio).toHaveBeenCalledTimes(1);
    const [, video, segments, output] = mockMedia.muxAudio.mock.calls[0]!;
    expect(video).toBe('file:///docs/recordings/take_uuid1.mp4');
    expect(segments).toEqual([
      { uri: 'file:///cache/a1.wav', offsetMs: 120 },
      { uri: 'file:///cache/a2.wav', offsetMs: 4000 },
    ]);
    expect(output).toBe('file:///cache/scratch/take_uuid1_av.mp4');
    const rows = await mockRepos.recordings.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fileName).toBe('take_uuid1_av.mp4');
    expect(mockRouter.replace).toHaveBeenCalledWith(`/take/${rows[0]!.id}`);
    // The muxed take replaced the video-only original.
    expect(mockFs.has('file:///docs/recordings/take_uuid1.mp4')).toBe(false);
    expect(mockFs.has('file:///docs/recordings/take_uuid1_av.mp4')).toBe(true);
  });
});

describe('Record: failures and interruptions', () => {
  it('saves a partial file as a recovered take after a recorder error', async () => {
    await openRecord();
    await startTake();
    await advance(1500);
    await act(async () => recorder().fail());
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    const rows = await mockRepos.recordings.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'recovered', fileName: 'take_uuid1.mp4' });
    expect(mockRouter.replace).toHaveBeenCalledWith(`/take/${rows[0]!.id}?notice=interrupted`);
    expect(events.map((e) => e.name)).toContain('recording_failed');
  });

  it('shows a failure with Retry when the recorder fails before writing anything', async () => {
    await openRecord();
    await startTake();
    mockFs.clear(); // nothing reached the disk
    await act(async () => recorder().fail());
    expect(await screen.findByText('Recording stopped unexpectedly.')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    // The timed prompter stops scrolling once the take has failed.
    expect(mockPrompter.props!.playing).toBe(false);
    await fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => expect(screen.queryByTestId('record-notice')).toBeNull());
    expect(recordButton().props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('stops and saves the take when the app goes to the background', async () => {
    await openRecord();
    await startTake();
    await advance(1000);
    await act(async () => appStateHandler!('background'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    expect(recorder().stopCalls).toBe(1);
    expect(mockCam.isActive.at(-1)).toBe(false);
    const rows = await mockRepos.recordings.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('ready');
    expect(mockRouter.replace).toHaveBeenCalledWith(`/take/${rows[0]!.id}?notice=interrupted`);
  });

  it('keeps recording through an "inactive" app state (Control Center)', async () => {
    await openRecord();
    await startTake();
    await act(async () => appStateHandler!('inactive'));
    expect(recorder().stopCalls).toBe(0);
    expect(screen.getByTestId('record-timer')).toBeTruthy();
  });

  it('blocks a take when storage is low', async () => {
    mockDisk.free = 200 * 1024 * 1024;
    await openRecord();
    expect(screen.getByText('About 0 minutes of storage left')).toBeTruthy();
    await press('record-button');
    expect(await screen.findByText('Your device is almost out of storage. Free up space to record.')).toBeTruthy();
    expect(mockCam.recorders).toHaveLength(0);
    expect(events).toEqual([expect.objectContaining({ name: 'recording_failed', code: 'low_storage' })]);
  });
});

describe('Record: Bluetooth remote', () => {
  const key = (k: string, repeat = false) => act(async () => mockMedia.keyListeners.forEach((cb) => cb({ key: k, repeat })));

  it('nudges the script and toggles play; Enter does nothing unless opted in', async () => {
    await openRecord();
    expect(mockMedia.setRemoteKeysEnabled).toHaveBeenCalledWith(true);
    await key('PageDown');
    expect(mockPrompter.handle.nudgeLines).toHaveBeenLastCalledWith(3);
    await key('ArrowUp');
    expect(mockPrompter.handle.nudgeLines).toHaveBeenLastCalledWith(-3);
    expect(mockPrompter.props!.playing).toBe(false);
    await key('Space');
    expect(mockPrompter.props!.playing).toBe(true);
    await key('MediaPlayPause');
    expect(mockPrompter.props!.playing).toBe(false);
    await key('Enter');
    await advance(100);
    expect(mockCam.recorders).toHaveLength(0);
  });

  it('starts and stops a take from the remote when the setting is on', async () => {
    useSettings.getState().set({ remoteRecordToggle: true });
    await openRecord();
    await key('Enter');
    await waitFor(() => expect(screen.getByTestId('record-timer')).toBeTruthy());
    await key('Enter'); // bounce within the cooldown is ignored
    expect(recorder().stopCalls).toBe(0);
    await advance(1600);
    await key('Enter');
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    expect(await mockRepos.recordings.list()).toHaveLength(1);
  });

  it('does not listen when the remote is turned off', async () => {
    useSettings.getState().set({ remoteEnabled: false });
    await openRecord();
    expect(mockMedia.keyListeners.size).toBe(0);
    expect(mockMedia.setRemoteKeysEnabled).not.toHaveBeenCalled();
  });
});

describe('Record: first-take tip', () => {
  afterEach(() => useFirstRun.getState().reset());

  it('shows a 3 s non-blocking hint on the first take without changing the take', async () => {
    useFirstRun.getState().hydrate(INITIAL_FIRST_RUN);
    await openRecord();
    const tip = screen.getByTestId('record-first-take-tip');
    expect(tip.props.style).toMatchObject({ pointerEvents: 'none', position: 'absolute' });
    expect(screen.getByText('Look at the lens, read the highlighted line')).toBeTruthy();
    // Controls stay usable while the hint is up.
    await startTake();
    await advance(3000);
    expect(screen.queryByTestId('record-first-take-tip')).toBeNull();
    await stopTakeAndSave();
    expect(events.map((e) => e.name)).toEqual(['recording_started', 'recording_completed']);
  });

  it('is not shown once the first take exists', async () => {
    useFirstRun.getState().hydrate({ ...INITIAL_FIRST_RUN, firstScriptCreated: true, firstTakeRecorded: true });
    await openRecord();
    expect(screen.queryByTestId('record-first-take-tip')).toBeNull();
  });
});
