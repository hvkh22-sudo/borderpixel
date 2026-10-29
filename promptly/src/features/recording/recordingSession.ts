/**
 * RecordingSession — orchestrates one camera screen's takes: recorder
 * start/stop, Voice Follow, finalizing and failure salvage. All platform
 * pieces are injected so every race below is unit-tested with fakes
 * (see docs/architecture/recording-reliability.md).
 *
 * Invariants:
 * - At most one take in flight; a second start is ignored until it settles.
 * - Stop while the recorder is still starting is queued, never lost.
 * - The first terminal recorder callback (finished / error / stop watchdog)
 *   wins; later ones are ignored, so a take is finalized at most once.
 * - Voice Follow failures never stop or fail the recording, and a hanging
 *   Voice Follow stop cannot block finalizing (timeout).
 * - A file that exists on disk is always registered (as 'recovered' after a
 *   recorder error) or left in the documents directory for orphan recovery.
 * - After dispose() (screen unmounted) an in-flight take is still stopped and
 *   finalized, but no UI callback fires.
 */
import type { FinalizeInput, FinalizeResult } from './finalizeTake';
import { markRecordingActive } from './orphanRecovery';
import {
  INITIAL_RECORDING_STATE,
  MIN_FREE_BYTES_TO_RECORD,
  recorderMaxFileSize,
  recordingReducer,
  type RecordingErrorCode,
  type RecordingEvent,
  type RecordingState,
} from './recordingMachine';
import type { PersistedAudio } from '../voice-follow/voiceFollowController';

export type RecordingFinishedReason = 'stopped' | 'max-duration-reached' | 'max-file-size-reached';

/** The subset of VisionCamera's `Recorder` the session uses. */
export interface RecorderLike {
  readonly filePath: string;
  startRecording(onFinished: (filePath: string, reason: RecordingFinishedReason) => void, onError: (error: Error) => void): Promise<void>;
  stopRecording(): Promise<void>;
}

export interface VoiceFollowLike {
  start(): Promise<boolean>;
  stop(): Promise<PersistedAudio[]>;
  /** Audio segments persisted so far (used when stop() does not settle in time). */
  collectedAudio(): PersistedAudio[];
}

/** Why the user should be told something on the take screen. */
export type TakeNotice = 'interrupted' | 'storage_full';

export interface SavedTake extends FinalizeResult {
  notice: TakeNotice | null;
  durationMs: number;
  /** True when the file was salvaged after a recorder error (may be truncated). */
  salvaged: boolean;
}

export interface TakeOptions {
  scriptId: string | null;
  voiceFollow: VoiceFollowLike | null;
  /** Android Voice Follow: camera records video only, the recognizer's audio is muxed in. */
  separateAudio: boolean;
}

export interface RecordingSessionDeps {
  createRecorder(settings: { filePath: string; maxFileSize?: number }): Promise<RecorderLike>;
  finalize(input: FinalizeInput): Promise<FinalizeResult>;
  /** Path for the next take (inside the recordings directory). */
  newRecordingPath(): string;
  availableBytes(): number;
  /** Size of a file on disk, 0 when missing. */
  fileSize(path: string): number;
  now(): number;
  /** UI hooks; not called after dispose(). */
  onRecordingStarted?(at: number): void;
  onVoiceFollowStarted?(): void | Promise<void>;
  onTakeSaved?(take: SavedTake): void;
  /** Analytics hooks; called even after dispose(). */
  onTakeCompleted?(durationMs: number): void;
  onFailure?(code: RecordingErrorCode | 'recorder_error'): void;
  log?(message: string, error?: unknown): void;
}

export interface SessionTimeouts {
  /** Max wait for Voice Follow to stop before finalizing without it. */
  voiceFollowStopMs: number;
  /** Max wait after stopRecording() resolved for the finished callback. */
  finishAfterStopMs: number;
  /** Grace period when stopRecording() threw (the take may have finished on its own). */
  finishAfterStopErrorMs: number;
}

export const DEFAULT_TIMEOUTS: SessionTimeouts = {
  voiceFollowStopMs: 3_000,
  finishAfterStopMs: 15_000,
  finishAfterStopErrorMs: 3_000,
};

type Phase = 'starting' | 'recording' | 'stopping' | 'settled';

interface Take {
  opts: TakeOptions;
  plannedPath: string;
  /** Hides the take's files from orphan recovery until it is registered or abandoned. */
  release: () => void;
  recorder: RecorderLike | null;
  requestedAt: number;
  startedAt: number | null;
  phase: Phase;
  stopRequested: boolean;
  notice: TakeNotice | null;
  watchdog: ReturnType<typeof setTimeout> | null;
}

export class RecordingSession {
  private state: RecordingState = INITIAL_RECORDING_STATE;
  private listeners = new Set<() => void>();
  private take: Take | null = null;
  private cameraRunning = false;
  private disposed = false;
  private timeouts: SessionTimeouts;

  constructor(
    private deps: RecordingSessionDeps,
    timeouts: Partial<SessionTimeouts> = {},
  ) {
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
  }

  /** Swap in fresh callbacks (the screen re-renders); in-flight takes keep their options. */
  configure(deps: RecordingSessionDeps): void {
    this.deps = deps;
  }

  getState = (): RecordingState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Raw state-machine events (countdown, discard). Illegal events are ignored by the reducer. */
  dispatch = (event: RecordingEvent): void => {
    const next = recordingReducer(this.state, event);
    if (next === this.state) return;
    this.state = next;
    if (!this.disposed) this.listeners.forEach((l) => l());
  };

  /** True while a take is starting, recording, stopping or finalizing. */
  get hasActiveTake(): boolean {
    return this.take != null;
  }

  prepare(): void {
    this.dispatch({ type: 'PREPARE' });
    if (this.cameraRunning) this.dispatch({ type: 'CAMERA_READY' });
  }

  /** Retry after a recoverable failure. The camera may already be running (no new onStarted). */
  retry(): void {
    if (this.take) return;
    this.dispatch({ type: 'RETRY' });
    if (this.cameraRunning) this.dispatch({ type: 'CAMERA_READY' });
  }

  cameraStarted(): void {
    this.cameraRunning = true;
    // The camera came back after an error with no take running (another app released it): ready again.
    if (!this.take && this.state.status === 'unrecoverableFailure' && this.state.error === 'camera_unavailable') {
      this.dispatch({ type: 'PREPARE' });
    }
    this.dispatch({ type: 'CAMERA_READY' });
  }

  /** "Try again" after the camera failed before a take; the screen also remounts the camera. */
  retryCamera(): void {
    if (this.take || this.state.error !== 'camera_unavailable') return;
    this.cameraRunning = false;
    this.dispatch({ type: 'PREPARE' });
  }

  cameraStopped(): void {
    this.cameraRunning = false;
  }

  /**
   * Camera session error. During a take: stop and save what was recorded
   * (the recorder reports finished or error; both paths keep the file).
   * Otherwise the camera is unusable.
   */
  cameraError(): void {
    if (this.take) {
      void this.stop('interrupted');
      return;
    }
    if (this.state.status === 'countdown') this.dispatch({ type: 'CANCEL_COUNTDOWN' });
    this.cameraRunning = false;
    this.dispatch({ type: 'FAILED', error: 'camera_unavailable' });
  }

  /** Phone call, Siri, app backgrounded, split view: stop cleanly and keep the take. */
  interrupt(): void {
    if (this.state.status === 'countdown') {
      this.dispatch({ type: 'CANCEL_COUNTDOWN' });
      return;
    }
    if (this.take) void this.stop('interrupted');
  }

  async start(opts: TakeOptions): Promise<void> {
    if (this.take || this.disposed) return;
    if (this.state.status !== 'ready' && this.state.status !== 'countdown') return;
    const free = this.deps.availableBytes();
    if (free < MIN_FREE_BYTES_TO_RECORD) {
      this.dispatch({ type: 'FAILED', error: 'low_storage' });
      this.deps.onFailure?.('low_storage');
      return;
    }
    const plannedPath = this.deps.newRecordingPath();
    const take: Take = {
      opts,
      plannedPath,
      release: markRecordingActive(plannedPath),
      recorder: null,
      requestedAt: this.deps.now(),
      startedAt: null,
      phase: 'starting',
      stopRequested: false,
      notice: null,
      watchdog: null,
    };
    this.take = take;
    this.dispatch({ type: 'START_REQUESTED' });

    let recorder: RecorderLike;
    try {
      recorder = await this.deps.createRecorder({ filePath: take.plannedPath, maxFileSize: recorderMaxFileSize(free) });
    } catch (e) {
      this.deps.log?.('createRecorder failed', e);
      this.endTake(take);
      this.dispatch({ type: 'FAILED', error: 'unknown' });
      this.deps.onFailure?.('unknown');
      return;
    }
    if (take.stopRequested || this.disposed) {
      // Nothing was recorded yet: abandon quietly (the recorder was never started).
      this.endTake(take);
      this.dispatch({ type: 'START_ABORTED' });
      return;
    }
    take.recorder = recorder;

    try {
      await recorder.startRecording(
        (path, reason) => void this.handleFinished(take, path, reason),
        (error) => void this.handleRecorderError(take, error),
      );
    } catch (e) {
      this.deps.log?.('startRecording failed', e);
      if (take.phase === 'settled') return;
      take.phase = 'settled';
      this.endTake(take);
      this.dispatch({ type: 'FAILED', error: 'unknown' });
      this.deps.onFailure?.('unknown');
      return;
    }
    if (take.phase !== 'starting') return; // finished/failed before the start promise resolved

    take.phase = 'recording';
    take.startedAt = this.deps.now();
    this.dispatch({ type: 'RECORDING_STARTED', at: take.startedAt });
    if (!this.disposed) this.deps.onRecordingStarted?.(take.startedAt);

    if (take.stopRequested || this.disposed) {
      await this.requestStop(take);
      return;
    }
    if (opts.voiceFollow) void this.startVoiceFollow(take, opts.voiceFollow);
  }

  /** User stop / interruption. Safe to call at any time and repeatedly. */
  async stop(notice?: TakeNotice): Promise<void> {
    const take = this.take;
    if (!take || take.phase === 'settled') return;
    if (notice && !take.notice) take.notice = notice;
    if (take.phase === 'starting') {
      take.stopRequested = true;
      return;
    }
    if (take.phase === 'recording') await this.requestStop(take);
  }

  /** (Re)attach to a mounted screen. React StrictMode disposes and re-attaches on mount. */
  attach(): void {
    this.disposed = false;
  }

  /** Screen unmounted: stop any running take (it is still finalized), silence UI callbacks. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const take = this.take;
    if (!take) return;
    if (take.phase === 'starting') take.stopRequested = true;
    else if (take.phase === 'recording') void this.requestStop(take);
  }

  // ---------------------------------------------------------------------------

  private async requestStop(take: Take): Promise<void> {
    if (take.phase !== 'recording' || !take.recorder) return;
    take.phase = 'stopping';
    this.dispatch({ type: 'STOP' });
    try {
      await take.recorder.stopRecording();
      this.armWatchdog(take, this.timeouts.finishAfterStopMs);
    } catch (e) {
      // Android throws "Not currently recording!" when the take already finalized itself
      // (size limit, source inactive); its finished callback is on the way or already ran.
      this.deps.log?.('stopRecording failed', e);
      this.armWatchdog(take, this.timeouts.finishAfterStopErrorMs);
    }
  }

  private armWatchdog(take: Take, ms: number): void {
    if (take.phase === 'settled') return;
    if (take.watchdog) clearTimeout(take.watchdog);
    take.watchdog = setTimeout(() => {
      take.watchdog = null;
      if (take.phase === 'settled') return;
      this.deps.log?.('recorder never reported finished; salvaging');
      void this.salvage(take);
    }, ms);
  }

  private settle(take: Take): boolean {
    if (take.phase === 'settled') return false;
    take.phase = 'settled';
    if (take.watchdog) clearTimeout(take.watchdog);
    take.watchdog = null;
    return true;
  }

  private async handleFinished(take: Take, path: string, reason: RecordingFinishedReason): Promise<void> {
    if (!this.settle(take)) return;
    if (reason === 'max-file-size-reached') take.notice = 'storage_full';
    const finishedAt = this.deps.now();
    this.dispatch({ type: 'RECORDING_FINISHED', filePath: path, at: finishedAt });
    await this.complete(take, path || take.plannedPath, finishedAt, false);
  }

  private async handleRecorderError(take: Take, error: Error): Promise<void> {
    this.deps.log?.('recorder error', error);
    if (take.phase === 'settled') return;
    await this.salvage(take);
  }

  /** Recorder error or stop watchdog: register whatever reached the disk. */
  private async salvage(take: Take): Promise<void> {
    if (!this.settle(take)) return;
    const finishedAt = this.deps.now();
    const path = take.recorder?.filePath || take.plannedPath;
    this.deps.onFailure?.('recorder_error');
    if (this.deps.fileSize(path) > 0) {
      if (!take.notice) take.notice = 'interrupted';
      this.dispatch({ type: 'RECORDING_FINISHED', filePath: path, at: finishedAt });
      await this.complete(take, path, finishedAt, true);
      return;
    }
    await this.stopVoiceFollow(take);
    this.endTake(take);
    this.dispatch({ type: 'FAILED', error: 'unknown', partialFilePath: null });
  }

  private async complete(take: Take, path: string, finishedAt: number, salvaged: boolean): Promise<void> {
    const audio = await this.stopVoiceFollow(take);
    const startedAt = take.startedAt ?? take.requestedAt;
    const durationMs = Math.max(0, finishedAt - startedAt);
    try {
      const result = await this.deps.finalize({
        filePath: path,
        scriptId: take.opts.scriptId,
        durationMs,
        recordingStartedAt: startedAt,
        separateAudio: take.opts.separateAudio ? audio : [],
        expectSeparateAudio: take.opts.separateAudio,
        status: salvaged ? 'recovered' : 'ready',
      });
      this.endTake(take);
      this.dispatch({ type: 'FINALIZED' });
      this.deps.onTakeCompleted?.(durationMs);
      if (!this.disposed) this.deps.onTakeSaved?.({ ...result, notice: take.notice, durationMs, salvaged });
    } catch (e) {
      // The file stays in the documents directory; orphan recovery registers it on next launch.
      this.deps.log?.('finalize failed', e);
      this.endTake(take);
      this.dispatch({ type: 'FAILED', error: 'write_failed', partialFilePath: path });
      this.deps.onFailure?.('write_failed');
    }
  }

  private async startVoiceFollow(take: Take, vf: VoiceFollowLike): Promise<void> {
    let ok = false;
    try {
      ok = await vf.start();
    } catch (e) {
      // Voice Follow is best effort: the recording keeps running with manual scrolling.
      this.deps.log?.('voice follow start failed', e);
    }
    if (take.phase !== 'recording') {
      // The take ended while the recognizer was starting: make sure it does not keep the mic.
      if (ok) void vf.stop().catch(() => {});
      return;
    }
    if (ok && !this.disposed) {
      try {
        await this.deps.onVoiceFollowStarted?.();
      } catch (e) {
        this.deps.log?.('voice follow usage update failed', e);
      }
    }
  }

  private async stopVoiceFollow(take: Take): Promise<PersistedAudio[]> {
    const vf = take.opts.voiceFollow;
    if (!vf) return [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), this.timeouts.voiceFollowStopMs);
      });
      const audio = await Promise.race([vf.stop(), timeout]);
      if (audio) return audio;
      this.deps.log?.('voice follow stop timed out');
    } catch (e) {
      this.deps.log?.('voice follow stop failed', e);
    } finally {
      if (timer) clearTimeout(timer);
    }
    try {
      return vf.collectedAudio();
    } catch {
      return [];
    }
  }

  private endTake(take: Take): void {
    take.release();
    take.phase = 'settled';
    if (take.watchdog) clearTimeout(take.watchdog);
    take.watchdog = null;
    if (this.take === take) this.take = null;
  }
}
