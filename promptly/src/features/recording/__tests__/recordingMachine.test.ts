import {
  INITIAL_RECORDING_STATE,
  RecordingEvent,
  RecordingState,
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

describe('storage estimates', () => {
  it('estimates remaining seconds conservatively', () => {
    expect(remainingRecordSeconds(50 * 1024 * 1024)).toBe(0);
    expect(remainingRecordSeconds(1024 * 1024 * 1024)).toBeGreaterThan(400);
  });
});
