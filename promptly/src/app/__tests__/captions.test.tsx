/**
 * @jest-environment node
 */
/* Caption flow: generate (mocked recognizer) → script-aware correction → edit → save. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { createRepos, renderScreen } from './testUtils';

let mockRepos: Awaited<ReturnType<typeof createRepos>>;
const mockParams: Record<string, string> = {};
const mockPush = jest.fn();
const mockTranscribe = jest.fn();

jest.mock('../../services/db', () => ({ getRepositories: () => Promise.resolve(mockRepos) }));
jest.mock('../../services/transcription', () => ({
  ...jest.requireActual('../../services/transcription'),
  transcribeRecording: (...a: unknown[]) => mockTranscribe(...a),
}));
jest.mock('../../services/files', () => ({ recordingFile: (name: string) => ({ uri: `file:///docs/${name}`, exists: true }) }));
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ currentTime: 0, duration: 10, play: jest.fn(), pause: jest.fn() }),
  VideoView: () => null,
}));
jest.mock('expo', () => ({
  ...jest.requireActual('expo'),
  useEvent: (_p: unknown, _e: string, initial: unknown) => initial,
}));
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

beforeEach(async () => {
  mockRepos = await createRepos();
  mockPush.mockClear();
  mockTranscribe.mockReset();
});

async function setupTake() {
  const s = await mockRepos.scripts.create({ title: 'T', body: 'Write your script before you hit record.' });
  const r = await mockRepos.recordings.add({ scriptId: s.id, fileName: 'take.mp4', durationMs: 4000, width: null, height: null, status: 'ready' });
  mockParams.id = r.id;
  return r;
}

describe('Captions editor', () => {
  it('generates captions with script spelling and saves them', async () => {
    const r = await setupTake();
    mockTranscribe.mockResolvedValue({
      transcript: 'write your scrip before you hit record',
      segments: ['write', 'your', 'scrip', 'before', 'you', 'hit', 'record'].map((w, i) => ({
        text: w,
        startMs: i * 400,
        endMs: i * 400 + 350,
        confidence: 0.9,
      })),
    });
    const Captions = require('../captions/[id]').default;
    await renderScreen(<Captions />);
    await fireEvent.press(await screen.findByLabelText('Generate captions'));
    // "scrip" corrected to the script's "script"; segmentation splits into short cues.
    expect(await screen.findByDisplayValue('Write your script before you')).toBeTruthy();
    expect(screen.getByDisplayValue('hit record.')).toBeTruthy();

    await fireEvent.changeText(screen.getByDisplayValue('hit record.'), 'hit Record!');
    await fireEvent.press(screen.getByLabelText('Save captions'));
    await waitFor(async () => expect((await mockRepos.recordings.get(r.id))?.cues?.map((c) => c.text)).toEqual(['Write your script before you', 'hit Record!']));
  });

  it('tells the user when no speech was heard and never invents text', async () => {
    await setupTake();
    const { TranscriptionError } = jest.requireActual('../../services/transcription');
    mockTranscribe.mockRejectedValue(new TranscriptionError('no_speech'));
    const Captions = require('../captions/[id]').default;
    await renderScreen(<Captions />);
    await fireEvent.press(await screen.findByLabelText('Generate captions'));
    expect(await screen.findByText('We didn’t hear any speech in this take.')).toBeTruthy();
    expect(screen.queryByLabelText('Save captions')).toBeNull();
  });

  it('sends free users to the paywall for premium caption styles', async () => {
    await setupTake();
    mockTranscribe.mockResolvedValue({ transcript: 'hello', segments: [{ text: 'hello', startMs: 0, endMs: 500, confidence: 0.9 }] });
    const Captions = require('../captions/[id]').default;
    await renderScreen(<Captions />);
    await fireEvent.press(await screen.findByLabelText('Generate captions'));
    await fireEvent.press(await screen.findByLabelText('Creator Bold, PRO'));
    expect(mockPush).toHaveBeenCalledWith('/paywall?trigger=captionStyle');
  });
});
