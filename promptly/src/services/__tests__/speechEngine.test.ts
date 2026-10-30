/* Session bookkeeping of ExpoSpeechEngine over a fake recognizer module. */
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

import { ExpoSpeechEngine } from '../speechEngine';

const mockListeners = new Map<string, Set<(e: unknown) => void>>();

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    start: jest.fn(),
    stop: jest.fn(),
    addListener: (name: string, cb: (e: unknown) => void) => {
      if (!mockListeners.has(name)) mockListeners.set(name, new Set());
      mockListeners.get(name)?.add(cb);
      return { remove: () => mockListeners.get(name)?.delete(cb) };
    },
  },
  AVAudioSessionCategory: {},
  AVAudioSessionCategoryOptions: {},
  AVAudioSessionMode: {},
}));

const emit = (name: string, e: unknown = {}) => mockListeners.get(name)?.forEach((cb) => cb(e));
const start = ExpoSpeechRecognitionModule.start as jest.Mock;
const opts = { locale: 'en-US', contextualStrings: [], onDevice: true };

beforeEach(() => {
  jest.useFakeTimers();
  mockListeners.clear();
  start.mockClear();
});
afterEach(() => jest.useRealTimers());

describe('ExpoSpeechEngine', () => {
  it('restarts a session that ended on its own', async () => {
    const engine = new ExpoSpeechEngine();
    const ended = jest.fn();
    engine.onEnd(ended);
    await engine.start(opts);
    emit('end');
    jest.advanceTimersByTime(200);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('a late end from a stopped session neither restarts nor ends the new one', async () => {
    const engine = new ExpoSpeechEngine();
    const ended = jest.fn();
    engine.onEnd(ended);
    await engine.start(opts);
    await engine.stop();
    await engine.start(opts); // quick retake: old session's 'end' still pending
    emit('end'); // late end of the first session
    jest.advanceTimersByTime(200);
    expect(start).toHaveBeenCalledTimes(2);
    expect(ended).not.toHaveBeenCalled();
    // The current session's own end still restarts it.
    emit('end');
    jest.advanceTimersByTime(200);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(3);
  });

  it('does not restart after stop', async () => {
    const engine = new ExpoSpeechEngine();
    engine.onEnd(() => {});
    await engine.start(opts);
    await engine.stop();
    emit('end');
    jest.advanceTimersByTime(200);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('retries transient Android errors (busy/client) with backoff before reporting an error', async () => {
    const engine = new ExpoSpeechEngine();
    const errors = jest.fn();
    engine.onEnd(() => {});
    engine.onError(errors);
    await engine.start(opts);
    for (let i = 1; i <= 3; i++) {
      emit('error', { error: i % 2 ? 'busy' : 'client', message: '' });
      emit('end');
      jest.advanceTimersByTime(1000);
      expect(start).toHaveBeenCalledTimes(1 + i);
    }
    expect(errors).not.toHaveBeenCalled();
    emit('error', { error: 'busy', message: '' });
    expect(errors).toHaveBeenCalledWith('unknown', '');
  });

  it('ignores a late error from a session that was already stopped', async () => {
    const engine = new ExpoSpeechEngine();
    const errors = jest.fn();
    engine.onEnd(() => {});
    engine.onError(errors);
    await engine.start(opts);
    await engine.stop();
    await engine.start(opts);
    emit('error', { error: 'audio-capture', message: '' }); // from the stopped session
    expect(errors).not.toHaveBeenCalled();
    emit('end'); // its end
    jest.advanceTimersByTime(200);
    // The new session still restarts on its own end.
    emit('end');
    jest.advanceTimersByTime(200);
    expect(start).toHaveBeenCalledTimes(3);
  });
});
