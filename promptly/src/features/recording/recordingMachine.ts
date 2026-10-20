/**
 * Recording lifecycle as an explicit state machine. The camera screen
 * dispatches events; native callbacks are mapped to events. Illegal
 * transitions (double-tap Record, repeated Stop) are ignored, never thrown.
 */

export type RecordingStatus =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'countdown'
  | 'recording'
  | 'stopping'
  | 'finalizing'
  | 'previewable'
  | 'recoverableFailure'
  | 'unrecoverableFailure';

export type RecordingErrorCode =
  | 'permission_denied'
  | 'camera_unavailable'
  | 'microphone_unavailable'
  | 'low_storage'
  | 'write_failed'
  | 'interrupted'
  | 'unknown';

export interface RecordingState {
  status: RecordingStatus;
  /** Monotonic id of the current take; increments on every start. */
  takeId: number;
  startedAt: number | null;
  filePath: string | null;
  durationMs: number;
  error: RecordingErrorCode | null;
  /** A partially written file that may be salvageable after a failure. */
  partialFilePath: string | null;
}

export type RecordingEvent =
  | { type: 'PREPARE' }
  | { type: 'CAMERA_READY' }
  | { type: 'START_COUNTDOWN' }
  | { type: 'CANCEL_COUNTDOWN' }
  | { type: 'RECORDING_STARTED'; at: number }
  | { type: 'STOP' }
  | { type: 'RECORDING_FINISHED'; filePath: string; at: number }
  | { type: 'FINALIZED' }
  | { type: 'FAILED'; error: RecordingErrorCode; partialFilePath?: string | null }
  | { type: 'RETRY' }
  | { type: 'DISCARD' };

export const INITIAL_RECORDING_STATE: RecordingState = {
  status: 'idle',
  takeId: 0,
  startedAt: null,
  filePath: null,
  durationMs: 0,
  error: null,
  partialFilePath: null,
};

const UNRECOVERABLE: ReadonlySet<RecordingErrorCode> = new Set(['permission_denied', 'camera_unavailable']);

export function recordingReducer(state: RecordingState, event: RecordingEvent): RecordingState {
  switch (event.type) {
    case 'PREPARE':
      if (state.status === 'idle' || state.status === 'recoverableFailure' || state.status === 'unrecoverableFailure') {
        return { ...INITIAL_RECORDING_STATE, takeId: state.takeId, status: 'preparing' };
      }
      return state;
    case 'CAMERA_READY':
      return state.status === 'preparing' ? { ...state, status: 'ready' } : state;
    case 'START_COUNTDOWN':
      return state.status === 'ready' ? { ...state, status: 'countdown' } : state;
    case 'CANCEL_COUNTDOWN':
      return state.status === 'countdown' ? { ...state, status: 'ready' } : state;
    case 'RECORDING_STARTED':
      if (state.status !== 'countdown' && state.status !== 'ready') return state;
      return { ...state, status: 'recording', takeId: state.takeId + 1, startedAt: event.at, error: null };
    case 'STOP':
      return state.status === 'recording' ? { ...state, status: 'stopping' } : state;
    case 'RECORDING_FINISHED':
      if (state.status !== 'recording' && state.status !== 'stopping') return state;
      return {
        ...state,
        status: 'finalizing',
        filePath: event.filePath,
        durationMs: state.startedAt != null ? Math.max(0, event.at - state.startedAt) : 0,
      };
    case 'FINALIZED':
      return state.status === 'finalizing' ? { ...state, status: 'previewable' } : state;
    case 'FAILED': {
      if (state.status === 'idle' || state.status === 'previewable') return state;
      return {
        ...state,
        status: UNRECOVERABLE.has(event.error) ? 'unrecoverableFailure' : 'recoverableFailure',
        error: event.error,
        partialFilePath: event.partialFilePath ?? state.partialFilePath,
      };
    }
    case 'RETRY':
      if (state.status === 'previewable' || state.status === 'recoverableFailure') {
        return { ...INITIAL_RECORDING_STATE, takeId: state.takeId, status: 'preparing' };
      }
      return state;
    case 'DISCARD':
      return { ...INITIAL_RECORDING_STATE, takeId: state.takeId };
    default:
      return state;
  }
}

export function isBusy(status: RecordingStatus): boolean {
  return status === 'recording' || status === 'stopping' || status === 'finalizing' || status === 'countdown';
}

/** Minimum free bytes before allowing a new take (~2 min of 1080p at ~17 Mbps). */
export const MIN_FREE_BYTES_TO_RECORD = 300 * 1024 * 1024;

export function estimateBytesPerSecond(bitRate = 17_000_000, audioBitRate = 128_000): number {
  return (bitRate + audioBitRate) / 8;
}

export function remainingRecordSeconds(freeBytes: number, bytesPerSecond = estimateBytesPerSecond()): number {
  return Math.max(0, Math.floor((freeBytes - 100 * 1024 * 1024) / bytesPerSecond));
}
