/**
 * VoiceFollowController — glue between a SpeechEngine (platform recognizer)
 * and the ScriptAligner, plus user-facing status. Time is injected so the
 * controller is deterministic in tests.
 *
 * Failure policy: on recognizer error the script position is preserved and
 * the status becomes 'error'; the UI offers manual control immediately. We
 * never silently switch to timed scrolling.
 */

import { AlignmentResult, AlignerConfig, ScriptAligner } from './aligner';

export type VoiceFollowStatus = 'idle' | 'starting' | 'listening' | 'speaking' | 'lost' | 'error' | 'finished';

export interface SpeechResultEvent {
  transcript: string;
  isFinal: boolean;
}

export type SpeechErrorCode =
  | 'not-allowed'
  | 'language-not-supported'
  | 'audio-capture'
  | 'network'
  | 'interrupted'
  | 'service-not-allowed'
  | 'unknown';

export interface SpeechStartOptions {
  locale: string;
  contextualStrings: string[];
  onDevice: boolean;
  /**
   * Persist the captured microphone audio to files (Android: the recognizer
   * owns the mic while the camera records video only; audio is muxed later).
   */
  persistAudio?: boolean;
}

/** A persisted audio file covering part of the session. */
export interface PersistedAudio {
  uri: string;
  /** Epoch ms when capture of this file started (comparable to Date.now()). */
  startedAt: number;
}

/** Platform recognizer abstraction (implemented in speechEngine.ts). */
export interface SpeechEngine {
  start(options: SpeechStartOptions): Promise<void>;
  stop(): Promise<void>;
  onResult(cb: (e: SpeechResultEvent) => void): () => void;
  onError(cb: (code: SpeechErrorCode, message: string) => void): () => void;
  /** Recognizer ended its session (e.g. Android after final result). */
  onEnd(cb: () => void): () => void;
  /** Fired when a persisted audio file is complete. */
  onAudioPersisted(cb: (a: PersistedAudio) => void): () => void;
}

export interface VoiceFollowSnapshot {
  status: VoiceFollowStatus;
  cursor: number;
  charOffset: number;
  confidence: number;
  error: SpeechErrorCode | null;
}

export interface ControllerOptions {
  /** No forward progress for this long while speech is heard → 'lost'. */
  lostAfterMs: number;
  /** No speech for this long → 'listening' (paused). */
  silenceAfterMs: number;
  aligner?: Partial<AlignerConfig>;
}

const DEFAULTS: ControllerOptions = { lostAfterMs: 5000, silenceAfterMs: 1200 };

export class VoiceFollowController {
  readonly aligner: ScriptAligner;
  private readonly opts: ControllerOptions;
  private status: VoiceFollowStatus = 'idle';
  private error: SpeechErrorCode | null = null;
  private lastSpeechAt = 0;
  private lastAdvanceAt = 0;
  private lastConfidence = 0;
  private listeners = new Set<(s: VoiceFollowSnapshot) => void>();

  constructor(script: string, opts: Partial<ControllerOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.aligner = new ScriptAligner(script, this.opts.aligner);
  }

  subscribe(cb: (s: VoiceFollowSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  snapshot(): VoiceFollowSnapshot {
    return {
      status: this.status,
      cursor: this.aligner.cursor,
      charOffset: this.aligner.charOffsetForCursor(),
      confidence: this.lastConfidence,
      error: this.error,
    };
  }

  markStarting(): void {
    this.setStatus('starting');
  }

  markStarted(now: number): void {
    this.lastSpeechAt = now;
    this.lastAdvanceAt = now;
    this.error = null;
    this.setStatus('listening');
  }

  handleResult(e: SpeechResultEvent, now: number): AlignmentResult {
    const r = this.aligner.update(e.transcript);
    this.lastSpeechAt = now;
    this.lastConfidence = r.confidence;
    if (r.kind !== 'hold') this.lastAdvanceAt = now;
    if (e.isFinal) this.aligner.resetUtterance();
    if (this.aligner.isComplete) this.setStatus('finished');
    else if (this.status !== 'error') this.setStatus('speaking');
    return r;
  }

  /** Recognizer session ended; engines restart sessions so the hypothesis resets. */
  handleSessionEnd(): void {
    this.aligner.resetUtterance();
  }

  handleError(code: SpeechErrorCode): void {
    this.error = code;
    this.setStatus('error');
  }

  /** Call periodically (e.g. every 250 ms) to update silence / lost status. */
  tick(now: number): void {
    if (this.status !== 'speaking' && this.status !== 'lost') return;
    const sinceSpeech = now - this.lastSpeechAt;
    const sinceAdvance = now - this.lastAdvanceAt;
    if (sinceSpeech >= this.opts.silenceAfterMs) this.setStatus('listening');
    else if (sinceAdvance >= this.opts.lostAfterMs) this.setStatus('lost');
  }

  /** Manual override: user dragged or tapped the script. */
  resyncToChar(charOffset: number, now: number): void {
    this.aligner.setCursor(this.aligner.wordIndexAtChar(charOffset));
    this.aligner.resetUtterance();
    this.lastAdvanceAt = now;
    if (this.status === 'lost' || this.status === 'finished') this.setStatus('listening');
    else this.emit();
  }

  stop(): void {
    this.setStatus('idle');
  }

  private setStatus(s: VoiceFollowStatus): void {
    if (this.status === s) {
      this.emit();
      return;
    }
    this.status = s;
    this.emit();
  }

  private emit(): void {
    const snap = this.snapshot();
    this.listeners.forEach((l) => l(snap));
  }
}
