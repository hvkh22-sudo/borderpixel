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
 * No audio leaves the device unless requiresOnDevice is false AND the user
 * explicitly opted in to cloud recognition (not offered in v1).
 */
import { AudioEncodingAndroid, AudioSourceOptions, ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Platform } from 'react-native';

import { RecognizedSegment } from '../features/captions/captions';
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
}

export async function transcribeRecording(
  videoUri: string,
  locale: string,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  let audioSource: AudioSourceOptions = { uri: videoUri };
  if (Platform.OS === 'android') {
    if (!PromptlyMedia.isAvailable()) throw new TranscriptionError('unsupported_device', 'promptly-media module missing');
    const wav = await PromptlyMedia.extractAudioToWav(videoUri, 16_000);
    audioSource = {
      uri: wav.uri,
      sampleRate: wav.sampleRate,
      audioChannels: 1,
      audioEncoding: AudioEncodingAndroid.ENCODING_PCM_16BIT,
    };
  }

  return new Promise<TranscriptionResult>((resolve, reject) => {
    const segments: RecognizedSegment[] = [];
    const transcripts: string[] = [];
    let settled = false;
    // Segment timestamps are relative to each final result's session on some
    // engines; we offset by the end of the previous final result when needed.
    let offsetMs = 0;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      subs.forEach((s) => s.remove());
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
        finish(() =>
          segments.length || transcripts.length
            ? resolve({ segments, transcript: transcripts.join(' ') })
            : reject(new TranscriptionError('no_speech')),
        );
      }),
    ];

    signal?.addEventListener('abort', () => {
      ExpoSpeechRecognitionModule.abort();
      finish(() => reject(new TranscriptionError('cancelled')));
    });

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
