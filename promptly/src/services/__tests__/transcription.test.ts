/**
 * Long-take transcription on Android: the WAV is cut into parts in JS, each
 * part is recognized in turn (fake recognizer), and results are merged onto
 * the take's timeline. A failed part becomes a reported gap.
 */
import { transcribeRecording } from '../transcription';

type Listener = (e: unknown) => void;
const mockListeners: Record<string, Listener[]> = {};
const mockFiles = new Map<string, Uint8Array>();
const mockStarted: string[] = [];
/** Per part file name: what the fake engine "hears". */
let mockScript: (uri: string) => { error?: string; segments?: { segment: string; startTimeMillis: number; endTimeMillis: number }[] };

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('../nativeMedia', () => ({
  PromptlyMedia: {
    isAvailable: () => true,
    extractAudioToWav: jest.fn(async () => {
      const dataBytes = 120_000 * 32; // 120 s, 16 kHz mono 16-bit
      const bytes = new Uint8Array(44 + dataBytes);
      const { wavHeader } = jest.requireActual('../../features/captions/longTake');
      bytes.set(wavHeader(dataBytes, 16_000), 0);
      mockFiles.set('file:///cache/audio_1.wav', bytes);
      return { uri: 'file:///cache/audio_1.wav', sampleRate: 16_000, durationMs: 120_000 };
    }),
  },
}));
jest.mock('expo-file-system', () => ({
  FileMode: { ReadOnly: 'r' },
  File: class {
    uri: string;
    constructor(fileUri: string) {
      this.uri = fileUri;
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    async write(bytes: Uint8Array) {
      mockFiles.set(this.uri, bytes);
    }
    open() {
      const data = mockFiles.get(this.uri)!;
      return {
        offset: 0,
        size: data.length,
        async readBytes(n: number) {
          const out = data.slice(this.offset, this.offset + n);
          this.offset += out.length;
          return out;
        },
        close() {},
      };
    }
  },
}));
jest.mock('expo-speech-recognition', () => ({
  AudioEncodingAndroid: { ENCODING_PCM_16BIT: 2 },
  ExpoSpeechRecognitionModule: {
    addListener: (name: string, cb: Listener) => {
      (mockListeners[name] ??= []).push(cb);
      return { remove: () => (mockListeners[name] = mockListeners[name]!.filter((l) => l !== cb)) };
    },
    abort: jest.fn(),
    start: ({ audioSource }: { audioSource: { uri: string } }) => {
      mockStarted.push(audioSource.uri);
      const out = mockScript(audioSource.uri);
      setTimeout(() => {
        const emit = (n: string, e: unknown) => [...(mockListeners[n] ?? [])].forEach((l) => l(e));
        if (out.error) {
          emit('error', { error: out.error, message: out.error });
          return;
        }
        const segments = (out.segments ?? []).map((s) => ({ ...s, confidence: 0.9 }));
        emit('result', { isFinal: true, results: [{ transcript: segments.map((s) => s.segment).join(' '), segments }] });
        emit('end', {});
      }, 0);
    },
  },
}));

const part = (uri: string) => Number(/_part(\d+)\.wav$/.exec(uri)?.[1] ?? 0);

beforeEach(() => {
  mockFiles.clear();
  mockStarted.length = 0;
});

it('recognizes a 2-minute take in three parts, offsets and de-duplicates the overlaps', async () => {
  mockScript = (uri) => {
    switch (part(uri)) {
      case 1: // 0–50 s
        return { segments: [{ segment: 'start', startTimeMillis: 1_000, endTimeMillis: 1_400 }, { segment: 'bridge', startTimeMillis: 49_100, endTimeMillis: 49_400 }] };
      case 2: // 49–99 s: hears "bridge" again at its start
        return { segments: [{ segment: 'bridge', startTimeMillis: 120, endTimeMillis: 420 }, { segment: 'middle', startTimeMillis: 20_000, endTimeMillis: 20_300 }] };
      default: // 98–120 s
        return { segments: [{ segment: 'end', startTimeMillis: 10_000, endTimeMillis: 10_400 }] };
    }
  };
  const progress: string[] = [];
  const r = await transcribeRecording('file:///docs/take.mp4', 'en-US', { durationMs: 120_000, onProgress: (n, total) => progress.push(`${n}/${total}`) });
  expect(progress).toEqual(['1/3', '2/3', '3/3']);
  expect(mockStarted.map(part)).toEqual([1, 2, 3]);
  expect(r.segments.map((s) => [s.text, s.startMs])).toEqual([
    ['start', 1_000],
    ['bridge', 49_100],
    ['middle', 69_000],
    ['end', 108_000],
  ]);
  expect(r.gaps).toBeUndefined();
  // Parts and the extracted WAV are cleaned up.
  expect(mockFiles.size).toBe(0);
});

it('writes each part as a valid WAV of the planned length', async () => {
  const sizes: number[] = [];
  mockScript = (uri) => {
    sizes.push(mockFiles.get(uri)!.length);
    return { segments: [{ segment: 'x', startTimeMillis: 0, endTimeMillis: 100 }] };
  };
  await transcribeRecording('file:///docs/take.mp4', 'en-US');
  expect(sizes).toEqual([44 + 50_000 * 32, 44 + 50_000 * 32, 44 + 22_000 * 32]);
});

it('reports a failed part as a gap instead of failing the whole take', async () => {
  mockScript = (uri) =>
    part(uri) === 2 ? { error: 'network' } : { segments: [{ segment: `p${part(uri)}`, startTimeMillis: 5_000, endTimeMillis: 5_300 }] };
  const r = await transcribeRecording('file:///docs/take.mp4', 'en-US');
  expect(r.segments.map((s) => s.text)).toEqual(['p1', 'p3']);
  expect(r.gaps).toEqual([{ startMs: 49_000, endMs: 99_000, reason: 'failed' }]);
});

it('treats a silent part as normal and stops on cancel', async () => {
  mockScript = (uri) => (part(uri) === 1 ? { error: 'no-speech' } : { segments: [{ segment: 'hi', startTimeMillis: 5_000, endTimeMillis: 5_200 }] });
  const r = await transcribeRecording('file:///docs/take.mp4', 'en-US');
  expect(r.gaps).toBeUndefined();
  expect(r.segments).toHaveLength(2);

  const ctrl = new AbortController();
  mockScript = () => {
    ctrl.abort();
    return { segments: [] };
  };
  await expect(transcribeRecording('file:///docs/take.mp4', 'en-US', { signal: ctrl.signal })).rejects.toMatchObject({ code: 'cancelled' });
  expect(mockStarted.filter((u) => part(u) > 1).length).toBe(2); // from the first run only
  expect(mockFiles.size).toBe(0);
});
