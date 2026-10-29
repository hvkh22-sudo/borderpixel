import type { FinalizeInput, FinalizeResult } from '../finalizeTake';
import {
  RecordingSession,
  type RecorderLike,
  type RecordingFinishedReason,
  type RecordingSessionDeps,
  type TakeOptions,
  type VoiceFollowLike,
} from '../recordingSession';
import { isRecordingActive } from '../orphanRecovery';
import type { PersistedAudio } from '../../voice-follow/voiceFollowController';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise chains run (fake timers do not touch microtasks). */
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

class FakeRecorder implements RecorderLike {
  onFinished?: (path: string, reason: RecordingFinishedReason) => void;
  onError?: (e: Error) => void;
  started = deferred<void>();
  stopCalls = 0;
  stopImpl: () => Promise<void> = () => Promise.resolve();
  constructor(readonly filePath: string) {}
  startRecording(onFinished: (path: string, reason: RecordingFinishedReason) => void, onError: (e: Error) => void) {
    this.onFinished = onFinished;
    this.onError = onError;
    return this.started.promise;
  }
  stopRecording() {
    this.stopCalls++;
    return this.stopImpl();
  }
  finish(reason: RecordingFinishedReason = 'stopped') {
    this.onFinished?.(this.filePath, reason);
  }
}

function fakeVoiceFollow(over: Partial<VoiceFollowLike> = {}) {
  const audio: PersistedAudio[] = [{ uri: '/cache/a0.wav', startedAt: 1_000 }];
  return {
    start: jest.fn(async () => true),
    stop: jest.fn(async () => audio),
    collectedAudio: jest.fn(() => audio),
    ...over,
  } satisfies VoiceFollowLike;
}

function setup(opts: { manualCreate?: boolean; free?: number; finalize?: (i: FinalizeInput) => Promise<FinalizeResult> } = {}) {
  let clock = 1_000;
  let n = 0;
  const recorders: FakeRecorder[] = [];
  const creates: Deferred<RecorderLike>[] = [];
  const files = new Map<string, number>();
  const finalize = jest.fn(opts.finalize ?? (async () => ({ recordingId: 'rec1', audioMergeFailed: false })));
  const deps = {
    createRecorder: jest.fn((s: { filePath: string; maxFileSize?: number }) => {
      const r = new FakeRecorder(s.filePath);
      recorders.push(r);
      if (!opts.manualCreate) return Promise.resolve(r);
      const d = deferred<RecorderLike>();
      creates.push(d);
      return d.promise.then(() => r);
    }),
    finalize,
    newRecordingPath: () => `/docs/recordings/take_${++n}.mp4`,
    availableBytes: () => opts.free ?? 10 * 1024 ** 3,
    fileSize: (p: string) => files.get(p) ?? 0,
    now: () => clock,
    onRecordingStarted: jest.fn(),
    onVoiceFollowStarted: jest.fn(),
    onTakeSaved: jest.fn(),
    onTakeCompleted: jest.fn(),
    onFailure: jest.fn(),
  } satisfies RecordingSessionDeps;
  const session = new RecordingSession(deps, { voiceFollowStopMs: 3_000, finishAfterStopMs: 15_000, finishAfterStopErrorMs: 3_000 });
  session.cameraStarted();
  session.prepare();
  const at = <T,>(xs: T[], i: number): T => {
    const x = xs[i < 0 ? xs.length + i : i];
    if (!x) throw new Error(`no item ${i}`);
    return x;
  };
  return {
    session,
    deps,
    rec: (i = -1) => at(recorders, i),
    create: (i: number) => at(creates, i),
    files,
    finalize,
    tick: (ms: number) => (clock += ms),
    status: () => session.getState().status,
  };
}

const manual: TakeOptions = { scriptId: 's1', voiceFollow: null, separateAudio: false };

/** Starts a take and lets the fake recorder report started. */
async function startRecording(h: ReturnType<typeof setup>, opts: TakeOptions = manual) {
  const p = h.session.start(opts);
  await flush();
  h.rec().started.resolve();
  await p;
  await flush();
  return h.rec();
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('RecordingSession', () => {
  it('records, stops and finalizes a take once', async () => {
    const h = setup();
    expect(h.status()).toBe('ready');
    const rec = await startRecording(h);
    expect(h.status()).toBe('recording');
    expect(rec.filePath).toBe('/docs/recordings/take_1.mp4');
    h.tick(5_000);
    await h.session.stop();
    expect(h.status()).toBe('stopping');
    rec.finish();
    await flush();
    expect(h.finalize).toHaveBeenCalledTimes(1);
    expect(h.finalize.mock.calls[0]?.[0]).toMatchObject({ filePath: rec.filePath, scriptId: 's1', durationMs: 5_000, status: 'ready', separateAudio: [] });
    expect(h.deps.onTakeSaved).toHaveBeenCalledWith(expect.objectContaining({ recordingId: 'rec1', notice: null, salvaged: false }));
    expect(h.status()).toBe('previewable');
  });

  it('passes a finite size limit, never Infinity', async () => {
    const h = setup({ free: Number.POSITIVE_INFINITY });
    await startRecording(h);
    expect(h.deps.createRecorder.mock.calls[0]?.[0]?.maxFileSize).toBeUndefined();
    const h2 = setup({ free: 2 * 1024 ** 3 });
    await startRecording(h2);
    expect(h2.deps.createRecorder.mock.calls[0]?.[0]?.maxFileSize).toBe(2 * 1024 ** 3 - 150 * 1024 * 1024);
  });

  it('ignores a second start while the first is still creating the recorder', async () => {
    const h = setup({ manualCreate: true });
    void h.session.start(manual);
    void h.session.start(manual);
    await flush();
    expect(h.deps.createRecorder).toHaveBeenCalledTimes(1);
    expect(h.status()).toBe('starting');
  });

  it('stop while creating the recorder abandons the start without recording', async () => {
    const h = setup({ manualCreate: true });
    const p = h.session.start(manual);
    await flush();
    await h.session.stop();
    h.create(0).resolve(h.rec(0));
    await p;
    expect(h.rec(0).onFinished).toBeUndefined(); // never started
    expect(h.status()).toBe('ready');
    expect(h.session.hasActiveTake).toBe(false);
  });

  it('stop while startRecording is pending stops right after it starts and keeps the take', async () => {
    const h = setup();
    const p = h.session.start(manual);
    await flush();
    await h.session.stop();
    expect(h.rec(0).stopCalls).toBe(0);
    h.rec(0).started.resolve();
    await p;
    expect(h.rec(0).stopCalls).toBe(1);
    h.rec(0).finish();
    await flush();
    expect(h.finalize).toHaveBeenCalledTimes(1);
    expect(h.status()).toBe('previewable');
  });

  it('finalizes only once on duplicate finished callbacks and ignores an error after stop', async () => {
    const h = setup();
    const rec = await startRecording(h);
    await h.session.stop();
    rec.finish();
    rec.finish();
    rec.onError?.(new Error('late'));
    await flush();
    expect(h.finalize).toHaveBeenCalledTimes(1);
    expect(h.status()).toBe('previewable');
  });

  it('salvages the file on a recorder error when it exists on disk', async () => {
    const h = setup();
    const rec = await startRecording(h);
    h.files.set(rec.filePath, 4_000_000);
    rec.onError?.(new Error('session interrupted'));
    await flush();
    expect(h.finalize).toHaveBeenCalledWith(expect.objectContaining({ filePath: rec.filePath, status: 'recovered' }));
    expect(h.deps.onTakeSaved).toHaveBeenCalledWith(expect.objectContaining({ notice: 'interrupted', salvaged: true }));
  });

  it('reports a failure without a take when the recorder errors before writing anything', async () => {
    const h = setup();
    const vf = fakeVoiceFollow();
    const rec = await startRecording(h, { scriptId: 's1', voiceFollow: vf, separateAudio: false });
    rec.onError?.(new Error('boom'));
    await flush();
    expect(h.finalize).not.toHaveBeenCalled();
    expect(vf.stop).toHaveBeenCalled();
    expect(h.session.getState()).toMatchObject({ status: 'recoverableFailure', partialFilePath: null });
  });

  it('a Voice Follow start failure never stops the recording', async () => {
    const h = setup();
    const vf = fakeVoiceFollow({ start: jest.fn(() => Promise.reject(new Error('no recognizer'))) });
    const rec = await startRecording(h, { scriptId: 's1', voiceFollow: vf, separateAudio: false });
    expect(h.status()).toBe('recording');
    expect(h.deps.onVoiceFollowStarted).not.toHaveBeenCalled();
    await h.session.stop();
    rec.finish();
    await flush();
    expect(h.status()).toBe('previewable');
  });

  it('releases the recognizer when Voice Follow finishes starting after the take ended', async () => {
    const h = setup();
    const started = deferred<boolean>();
    const vf = fakeVoiceFollow({ start: jest.fn(() => started.promise) });
    const rec = await startRecording(h, { scriptId: 's1', voiceFollow: vf, separateAudio: false });
    await h.session.stop();
    rec.finish();
    await flush();
    expect(vf.stop).toHaveBeenCalledTimes(1);
    started.resolve(true);
    await flush();
    expect(vf.stop).toHaveBeenCalledTimes(2);
    expect(h.deps.onVoiceFollowStarted).not.toHaveBeenCalled();
  });

  it('does not let a hanging Voice Follow stop block finalizing', async () => {
    const h = setup();
    const vf = fakeVoiceFollow({ stop: jest.fn(() => new Promise<PersistedAudio[]>(() => {})) });
    const rec = await startRecording(h, { scriptId: 's1', voiceFollow: vf, separateAudio: true });
    await h.session.stop();
    rec.finish();
    await flush();
    expect(h.finalize).not.toHaveBeenCalled();
    jest.advanceTimersByTime(3_000);
    await flush();
    expect(h.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ separateAudio: [{ uri: '/cache/a0.wav', startedAt: 1_000 }], expectSeparateAudio: true }),
    );
  });

  it('passes separately captured audio only for separate-audio takes', async () => {
    const h = setup();
    const vf = fakeVoiceFollow();
    const rec = await startRecording(h, { scriptId: 's1', voiceFollow: vf, separateAudio: false });
    await h.session.stop();
    rec.finish();
    await flush();
    expect(h.finalize.mock.calls[0]?.[0]).toMatchObject({ separateAudio: [], expectSeparateAudio: false });
  });

  it('finalizes normally with a notice when the size limit is reached', async () => {
    const h = setup();
    const rec = await startRecording(h);
    rec.finish('max-file-size-reached');
    await flush();
    expect(h.finalize).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }));
    expect(h.deps.onTakeSaved).toHaveBeenCalledWith(expect.objectContaining({ notice: 'storage_full' }));
  });

  it('when stopRecording throws (take already ended) waits briefly, then salvages', async () => {
    const h = setup();
    const rec = await startRecording(h);
    rec.stopImpl = () => Promise.reject(new Error('Not currently recording!'));
    h.files.set(rec.filePath, 1_000);
    await h.session.stop();
    expect(h.status()).toBe('stopping');
    jest.advanceTimersByTime(2_999);
    await flush();
    expect(h.finalize).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await flush();
    expect(h.finalize).toHaveBeenCalledWith(expect.objectContaining({ status: 'recovered' }));
  });

  it('a finished callback that arrives within the grace period wins over salvage', async () => {
    const h = setup();
    const rec = await startRecording(h);
    rec.stopImpl = () => Promise.reject(new Error('Not currently recording!'));
    await h.session.stop();
    rec.finish('max-file-size-reached');
    await flush();
    jest.advanceTimersByTime(10_000);
    await flush();
    expect(h.finalize).toHaveBeenCalledTimes(1);
    expect(h.finalize).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }));
  });

  it('salvages when the recorder never reports finished after stop, and ignores the late callback', async () => {
    const h = setup();
    const rec = await startRecording(h);
    h.files.set(rec.filePath, 1_000);
    await h.session.stop();
    jest.advanceTimersByTime(15_000);
    await flush();
    expect(h.finalize).toHaveBeenCalledTimes(1);
    rec.finish();
    await flush();
    expect(h.finalize).toHaveBeenCalledTimes(1);
  });

  it('keeps the file and reports write_failed when finalizing throws; retry works with a running camera', async () => {
    const h = setup({ finalize: () => Promise.reject(new Error('disk')) });
    const rec = await startRecording(h);
    await h.session.stop();
    rec.finish();
    await flush();
    expect(h.session.getState()).toMatchObject({ status: 'recoverableFailure', error: 'write_failed', partialFilePath: rec.filePath });
    expect(h.deps.onFailure).toHaveBeenCalledWith('write_failed');
    h.session.retry();
    expect(h.status()).toBe('ready');
  });

  it('blocks a take on low storage', async () => {
    const h = setup({ free: 100 * 1024 * 1024 });
    await h.session.start(manual);
    expect(h.deps.createRecorder).not.toHaveBeenCalled();
    expect(h.session.getState().error).toBe('low_storage');
  });

  it('unmount while recording stops the recorder and still finalizes, without UI callbacks', async () => {
    const h = setup();
    const rec = await startRecording(h);
    h.session.dispose();
    expect(rec.stopCalls).toBe(1);
    rec.finish();
    await flush();
    expect(h.finalize).toHaveBeenCalledTimes(1);
    expect(h.deps.onTakeCompleted).toHaveBeenCalled();
    expect(h.deps.onTakeSaved).not.toHaveBeenCalled();
  });

  it('unmount during finalize lets it complete without navigating', async () => {
    const done = deferred<FinalizeResult>();
    const h = setup({ finalize: () => done.promise });
    const rec = await startRecording(h);
    await h.session.stop();
    rec.finish();
    await flush();
    h.session.dispose();
    done.resolve({ recordingId: 'r', audioMergeFailed: false });
    await flush();
    expect(h.deps.onTakeSaved).not.toHaveBeenCalled();
    expect(h.deps.onTakeCompleted).toHaveBeenCalled();
  });

  it('unmount while creating the recorder never starts it', async () => {
    const h = setup({ manualCreate: true });
    const p = h.session.start(manual);
    await flush();
    h.session.dispose();
    h.create(0).resolve(h.rec(0));
    await p;
    expect(h.rec(0).onFinished).toBeUndefined();
  });

  it('an interruption cancels a countdown and stops a take with a notice', async () => {
    const h = setup();
    h.session.dispatch({ type: 'START_COUNTDOWN' });
    h.session.interrupt();
    expect(h.status()).toBe('ready');
    const rec = await startRecording(h);
    h.session.interrupt();
    await flush();
    expect(rec.stopCalls).toBe(1);
    rec.finish();
    await flush();
    expect(h.deps.onTakeSaved).toHaveBeenCalledWith(expect.objectContaining({ notice: 'interrupted' }));
  });

  it('a camera error during a take stops and keeps it; outside a take the camera is unavailable', async () => {
    const h = setup();
    const rec = await startRecording(h);
    h.session.cameraError();
    await flush();
    expect(rec.stopCalls).toBe(1);
    rec.finish();
    await flush();
    expect(h.finalize).toHaveBeenCalledTimes(1);
    const h2 = setup();
    h2.session.cameraError();
    expect(h2.session.getState()).toMatchObject({ status: 'unrecoverableFailure', error: 'camera_unavailable' });
  });

  it('recovers from a camera error before a take: when the camera restarts, or via Try again', () => {
    const h = setup();
    h.session.cameraError();
    expect(h.status()).toBe('unrecoverableFailure');
    h.session.cameraStarted();
    expect(h.status()).toBe('ready');
    h.session.cameraError();
    h.session.retryCamera();
    expect(h.status()).toBe('preparing');
    h.session.cameraStarted();
    expect(h.status()).toBe('ready');
  });

  it('prepare goes straight to ready when the camera already runs', () => {
    const h = setup();
    h.session.dispatch({ type: 'DISCARD' });
    h.session.prepare();
    expect(h.status()).toBe('ready');
  });
});

it('marks the take file as in progress (hidden from orphan recovery) until the take is finalized', async () => {
  let activeWhileFinalizing: boolean | null = null;
  const h = setup({
    finalize: async () => {
      activeWhileFinalizing = isRecordingActive('take_vis.mp4');
      return { recordingId: 'rec1', audioMergeFailed: false };
    },
  });
  // Unique name: other tests in this file leave takes in flight.
  h.deps.newRecordingPath = () => '/docs/recordings/take_vis.mp4';
  const rec = await startRecording(h);
  expect(isRecordingActive('take_vis.mp4')).toBe(true);
  await h.session.stop();
  rec.finish();
  await flush();
  expect(activeWhileFinalizing).toBe(true);
  expect(isRecordingActive('take_vis.mp4')).toBe(false);
});
