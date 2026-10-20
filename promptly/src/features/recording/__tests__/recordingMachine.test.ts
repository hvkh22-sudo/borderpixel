import {
  INITIAL_RECORDING_STATE,
  RecordingEvent,
  RecordingState,
  isBusy,
  recorderMaxFileSize,
  recordingReducer,
  remainingRecordSeconds,
} from '../recordingMachine';

function run(events: RecordingEvent[], from: RecordingState = INITIAL_RECORDING_STATE) {
  return events.reduce(recordingReducer, from);
}

describe('recordingReducer', () => {
  it('walks the happy path', () => {
    const s = run([
      { type: 'PREPARE' },
      { type: 'CAMERA_READY' },
      { type: 'START_COUNTDOWN' },
      { type: 'RECORDING_STARTED', at: 1000 },
      { type: 'STOP' },
      { type: 'RECORDING_FINISHED', filePath: '/a.mov', at: 6000 },
      { type: 'FINALIZED' },
    ]);
    expect(s).toMatchObject({ status: 'previewable', filePath: '/a.mov', durationMs: 5000, takeId: 1 });
  });

  it('ignores double start and repeated stop', () => {
    const recording = run([{ type: 'PREPARE' }, { type: 'CAMERA_READY' }, { type: 'RECORDING_STARTED', at: 0 }]);
    expect(recordingReducer(recording, { type: 'RECORDING_STARTED', at: 5 })).toBe(recording);
    const stopping = recordingReducer(recording, { type: 'STOP' });
    expect(recordingReducer(stopping, { type: 'STOP' })).toBe(stopping);
  });

  it('handles a recording that finishes on its own (max duration)', () => {
    const s = run([
      { type: 'PREPARE' },
      { type: 'CAMERA_READY' },
      { type: 'RECORDING_STARTED', at: 0 },
      { type: 'RECORDING_FINISHED', filePath: '/b.mp4', at: 60_000 },
    ]);
    expect(s.status).toBe('finalizing');
  });

  it('keeps partial files on recoverable failures and can retry', () => {
    const failed = run([
      { type: 'PREPARE' },
      { type: 'CAMERA_READY' },
      { type: 'RECORDING_STARTED', at: 0 },
      { type: 'FAILED', error: 'interrupted', partialFilePath: '/partial.mov' },
    ]);
    expect(failed).toMatchObject({ status: 'recoverableFailure', partialFilePath: '/partial.mov' });
    expect(recordingReducer(failed, { type: 'RETRY' }).status).toBe('preparing');
  });

  it('permission loss is unrecoverable until re-prepared', () => {
    const s = run([{ type: 'PREPARE' }, { type: 'FAILED', error: 'permission_denied' }]);
    expect(s.status).toBe('unrecoverableFailure');
    expect(recordingReducer(s, { type: 'RETRY' })).toBe(s);
    expect(recordingReducer(s, { type: 'PREPARE' }).status).toBe('preparing');
  });

  it('countdown can be cancelled', () => {
    const s = run([{ type: 'PREPARE' }, { type: 'CAMERA_READY' }, { type: 'START_COUNTDOWN' }, { type: 'CANCEL_COUNTDOWN' }]);
    expect(s.status).toBe('ready');
  });
});

describe('starting phase', () => {
  const ready = run([{ type: 'PREPARE' }, { type: 'CAMERA_READY' }]);

  it('is busy, blocks a second start and can be aborted back to ready', () => {
    const starting = recordingReducer(ready, { type: 'START_REQUESTED' });
    expect(starting.status).toBe('starting');
    expect(isBusy('starting')).toBe(true);
    expect(recordingReducer(starting, { type: 'START_REQUESTED' })).toBe(starting);
    expect(recordingReducer(starting, { type: 'START_ABORTED' }).status).toBe('ready');
  });

  it('accepts a finish that arrives before the start promise resolved', () => {
    const s = run([{ type: 'START_REQUESTED' }, { type: 'RECORDING_FINISHED', filePath: '/c.mp4', at: 10 }], ready);
    expect(s.status).toBe('finalizing');
  });
});

describe('storage estimates', () => {
  it('derives a finite recorder size limit with headroom', () => {
    expect(recorderMaxFileSize(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(recorderMaxFileSize(Number.NaN)).toBeUndefined();
    expect(recorderMaxFileSize(100 * 1024 * 1024)).toBe(50 * 1024 * 1024);
    expect(recorderMaxFileSize(1024 ** 3)).toBe(1024 ** 3 - 150 * 1024 * 1024);
  });

  it('estimates remaining seconds conservatively', () => {
    expect(remainingRecordSeconds(50 * 1024 * 1024)).toBe(0);
    expect(remainingRecordSeconds(1024 * 1024 * 1024)).toBeGreaterThan(400);
  });
});
