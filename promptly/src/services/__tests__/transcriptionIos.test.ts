/**
 * iOS captions must stay on the device: a language without an on-device model is refused instead of
 * letting the recognizer fall back to Apple's servers.
 */
import { TranscriptionError, transcribeRecording } from '../transcription';

const mockStart = jest.fn();
const mockListeners: Record<string, ((e: unknown) => void)[]> = {};
const emit = (name: string, e: unknown = {}) => (mockListeners[name] ?? []).slice().forEach((cb) => cb(e));
let mockOnDevice: boolean | null = false;

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('../nativeMedia', () => ({
  PromptlyMedia: { isAvailable: () => true, supportsOnDeviceSpeech: () => mockOnDevice },
}));
jest.mock('expo-file-system', () => ({ File: class {}, FileMode: {} }));
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    start: (...a: unknown[]) => mockStart(...a),
    abort: jest.fn(),
    addListener: (name: string, cb: (e: unknown) => void) => {
      (mockListeners[name] ??= []).push(cb);
      return { remove: () => mockListeners[name]!.splice(mockListeners[name]!.indexOf(cb), 1) };
    },
  },
}));

beforeEach(() => mockStart.mockClear());

it('refuses a language with no on-device recognizer and never starts recognition', async () => {
  mockOnDevice = false;
  const err = await transcribeRecording('file:///docs/take.mp4', 'he-IL').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TranscriptionError);
  expect((err as TranscriptionError).code).toBe('language_not_supported');
  expect(mockStart).not.toHaveBeenCalled();
});

it('starts on-device recognition when the language is supported', async () => {
  mockOnDevice = true;
  const ac = new AbortController();
  const p = transcribeRecording('file:///docs/take.mp4', 'en-US', { signal: ac.signal }).catch(() => null);
  await new Promise((r) => setTimeout(r, 0));
  expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en-US', requiresOnDeviceRecognition: true }));
  ac.abort();
  await p;
});

it('ignores a final result delivered twice (the sentence is not repeated)', async () => {
  mockOnDevice = true;
  emit('end'); // the previous test's aborted session ends
  const p = transcribeRecording('file:///docs/take.mp4', 'en-US');
  await new Promise((r) => setTimeout(r, 0));
  expect(mockStart).toHaveBeenCalled();
  const result = (t: string, start: number) => ({
    isFinal: true,
    results: [{ transcript: t, segments: [{ segment: t, startTimeMillis: start, endTimeMillis: start + 800, confidence: 0.9 }] }],
  });
  emit('result', result('hello there', 0));
  emit('result', result('hello there', 0));
  emit('result', result('hello there', 2000)); // said again later: kept
  emit('end');
  const r = await p;
  expect(r.transcript).toBe('hello there hello there');
  expect(r.segments.map((s) => s.startMs)).toEqual([0, 2000]);
});
