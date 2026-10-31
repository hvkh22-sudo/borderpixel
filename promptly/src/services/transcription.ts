/**
 * Caption transcription of a finished recording, on-device first.
 *
 * iOS: SFSpeechURLRecognitionRequest reads the audio track of the recorded
 * movie directly (via expo-speech-recognition `audioSource`).
 * Android: SpeechRecognizer only accepts raw PCM/WAV via EXTRA_AUDIO_SOURCE
 * (API 33+), so the audio track is first decoded to WAV by the local
 * `promptly-media` native module. Word segments are reported on Android 14+
 * with the on-device Google service only; otherwise timing is estimated and
 * flagged so word highlighting is not offered.
 *
 * Long takes: on Android the WAV is split into ~50 s chunks (1 s overlap) in
 * JS and recognized one after another, then merged on the take's timeline
 * (see features/captions/longTake.ts). A chunk that fails is reported as a
 * gap, never filled in. On iOS a single request is kept; if it ends well
 * before the take does, the uncovered tail is reported as a gap.
 *
 * No audio leaves the device unless requiresOnDevice is false AND the user
 * explicitly opted in to cloud recognition (not offered in v1).
 */
import { File, FileMode } from 'expo-file-system';
import { AudioEncodingAndroid, AudioSourceOptions, ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Platform } from 'react-native';

import { RecognizedSegment } from '../features/captions/captions';
import {
  chunkByteRange,
  detectPrematureEnd,
  mergeChunkResults,
  offsetSegments,
  parseWavHeader,
  planChunks,
  wavDurationMs,
  wavHeader,
  type ChunkResult,
  type TranscriptGap,
} from '../features/captions/longTake';
import { PromptlyMedia } from './nativeMedia';

export type TranscriptionErrorCode =
  | 'unsupported_device'
  | 'language_not_supported'
  | 'no_speech'
  | 'cancelled'
  | 'permission_denied'
  | 'failed';

export class TranscriptionError extends Error {
  constructor(readonly code: TranscriptionErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface TranscriptionResult {
  segments: RecognizedSegment[];
  transcript: string;
  /** Parts of the take the engine did not cover (stopped early or failed). */
  gaps?: TranscriptGap[];
}

export interface TranscriptionOptions {
  signal?: AbortSignal;
  /** Take duration, used to detect a premature end on iOS. */
  durationMs?: number;
  /** Called before each part is recognized (1-based). */
  onProgress?: (part: number, total: number) => void;
}

const IOS_PREMATURE_CHECK_MIN_MS = 60_000;

export async function transcribeRecording(videoUri: string, locale: string, opts: TranscriptionOptions = {}): Promise<TranscriptionResult> {
  const { signal, durationMs = 0, onProgress } = opts;
  if (Platform.OS !== 'android') {
    // Captions promise on-device processing; without an on-device model for this language iOS would
    // quietly send the take's audio to Apple's servers instead, so refuse rather than fall back.
    if (PromptlyMedia.supportsOnDeviceSpeech(locale) === false) {
      throw new TranscriptionError('language_not_supported', 'no on-device recognizer for this language');
    }
    onProgress?.(1, 1);
    const result = await recognize({ uri: videoUri }, locale, signal);
    // Short takes often end in silence; only long ones risk the engine giving up.
    const gap = durationMs > IOS_PREMATURE_CHECK_MIN_MS ? detectPrematureEnd(result.segments, durationMs) : null;
    return gap ? { ...result, gaps: [gap] } : result;
  }
  if (!PromptlyMedia.isAvailable()) throw new TranscriptionError('unsupported_device', 'promptly-media module missing');
  const wav = await PromptlyMedia.extractAudioToWav(videoUri, 16_000);
  const wavFile = new File(wav.uri);
  const handle = wavFile.open(FileMode.ReadOnly);
  try {
    const fmt = parseWavHeader(await handle.readBytes(256), handle.size ?? 0);
    const plans = planChunks(wavDurationMs(fmt));
    const results: ChunkResult[] = [];
    const transcripts: string[] = [];
    const gaps: TranscriptGap[] = [];
    let firstError: TranscriptionError | null = null;
    for (const plan of plans) {
      if (signal?.aborted) throw new TranscriptionError('cancelled');
      onProgress?.(plan.index + 1, plans.length);
      // Each part is cut from the full WAV just before it is recognized, then deleted.
      let part: File | null = null;
      if (plans.length > 1) {
        const { offset, length } = chunkByteRange(plan, fmt);
        handle.offset = offset;
        const pcm = await handle.readBytes(length);
        const bytes = new Uint8Array(44 + pcm.length);
        bytes.set(wavHeader(pcm.length, fmt.sampleRate, fmt.channels, fmt.bitsPerSample), 0);
        bytes.set(pcm, 44);
        part = new File(wav.uri.replace(/\.wav$/, `_part${plan.index + 1}.wav`));
        await part.write(bytes);
      }
      const source: AudioSourceOptions = {
        uri: part?.uri ?? wav.uri,
        sampleRate: fmt.sampleRate,
        audioChannels: fmt.channels,
        audioEncoding: AudioEncodingAndroid.ENCODING_PCM_16BIT,
      };
      try {
        const r = await recognize(source, locale, signal);
        // A part with text but no timing becomes one estimated phrase spanning the part.
        const segs = r.segments.length || !r.transcript || plans.length === 1 ? r.segments : [{ text: r.transcript, startMs: 0, endMs: plan.endMs - plan.startMs, confidence: -1 }];
        results.push({ startMs: plan.startMs, endMs: plan.endMs, segments: offsetSegments(segs, plan.startMs) });
        if (r.transcript) transcripts.push(r.transcript);
      } catch (e) {
        const err = e instanceof TranscriptionError ? e : new TranscriptionError('failed', (e as Error).message);
        if (err.code === 'cancelled' || err.code === 'permission_denied' || err.code === 'language_not_supported') throw err;
        // Silence in one part is normal; a failed part is reported as a gap, never filled in.
        if (err.code !== 'no_speech') {
          firstError ??= err;
          gaps.push({ startMs: plan.startMs, endMs: plan.endMs, reason: 'failed' });
        }
      } finally {
        if (part) safeDelete(part);
      }
    }
    const segments = mergeChunkResults(results);
    if (segments.length === 0 && transcripts.length === 0) throw firstError ?? new TranscriptionError('no_speech');
    return { segments, transcript: transcripts.join(' '), ...(gaps.length ? { gaps } : {}) };
  } finally {
    handle.close();
    safeDelete(wavFile);
  }
}

function safeDelete(f: File) {
  try {
    if (f.exists) f.delete();
  } catch {
    // Cache file; the OS reclaims it if deletion fails.
  }
}

/**
 * Longest wait for a settled session's own "end" before the next one starts.
 * On Android, "error" (and abort) are sent at once but "end" only later from a
 * main-thread runnable (ExpoSpeechService.teardownAndEnd); without waiting, that
 * stale "end" would end the next session as "no speech".
 */
const SESSION_END_WAIT_MS = 2_000;
let previousSessionEnd: Promise<void> | null = null;

function awaitSessionEnd(): Promise<void> {
  const p = new Promise<void>((resolve) => {
    const done = () => {
      sub.remove();
      clearTimeout(timer);
      if (previousSessionEnd === p) previousSessionEnd = null;
      resolve();
    };
    const sub = ExpoSpeechRecognitionModule.addListener('end', done);
    const timer = setTimeout(done, SESSION_END_WAIT_MS);
  });
  return p;
}

/** One recognizer session over one audio source. */
async function recognize(audioSource: AudioSourceOptions, locale: string, signal?: AbortSignal): Promise<TranscriptionResult> {
  if (previousSessionEnd) await previousSessionEnd;
  if (signal?.aborted) throw new TranscriptionError('cancelled');

  return new Promise<TranscriptionResult>((resolve, reject) => {
    const segments: RecognizedSegment[] = [];
    const transcripts: string[] = [];
    let settled = false;
    let ended = false;
    // Segment timestamps are relative to each final result's session on some
    // engines; we offset by the end of the previous final result when needed.
    let offsetMs = 0;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      subs.forEach((s) => s.remove());
      // Settled before this session's own "end" arrived: hold the next session until it does.
      if (!ended) previousSessionEnd = awaitSessionEnd();
      signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const subs = [
      ExpoSpeechRecognitionModule.addListener('result', (e) => {
        if (!e.isFinal) return;
        const best = e.results[0];
        if (!best) return;
        transcripts.push(best.transcript);
        const segs = best.segments ?? [];
        const needsOffset = segs.length > 0 && segments.length > 0 && segs[0]!.startTimeMillis < offsetMs;
        const base = needsOffset ? offsetMs : 0;
        for (const s of segs) {
          segments.push({
            text: s.segment,
            startMs: s.startTimeMillis + base,
            endMs: s.endTimeMillis + base,
            confidence: s.confidence,
          });
        }
        const last = segments[segments.length - 1];
        if (last) offsetMs = last.endMs;
      }),
      ExpoSpeechRecognitionModule.addListener('error', (e) => {
        if (e.error === 'no-speech' || e.error === 'speech-timeout') {
          finish(() => (segments.length ? resolve({ segments, transcript: transcripts.join(' ') }) : reject(new TranscriptionError('no_speech'))));
          return;
        }
        const code: TranscriptionErrorCode =
          e.error === 'language-not-supported'
            ? 'language_not_supported'
            : e.error === 'not-allowed'
              ? 'permission_denied'
              : e.error === 'aborted'
                ? 'cancelled'
                : 'failed';
        finish(() => reject(new TranscriptionError(code, e.message)));
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        ended = true;
        finish(() =>
          segments.length || transcripts.length
            ? resolve({ segments, transcript: transcripts.join(' ') })
            : reject(new TranscriptionError('no_speech')),
        );
      }),
    ];

    const onAbort = () => {
      ExpoSpeechRecognitionModule.abort();
      finish(() => reject(new TranscriptionError('cancelled')));
    };
    signal?.addEventListener('abort', onAbort);

    try {
      ExpoSpeechRecognitionModule.start({
        lang: locale,
        interimResults: false,
        continuous: true,
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
        audioSource,
      });
    } catch (e) {
      finish(() => reject(new TranscriptionError('failed', (e as Error).message)));
    }
  });
}
