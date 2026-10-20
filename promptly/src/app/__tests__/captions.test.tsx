/**
 * @jest-environment node
 */
/* Caption flow: generate (mocked recognizer) → script-aware correction → edit → save. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { FREE_ACCESS } from '../../features/monetization/entitlements';
import { useAccess } from '../../state/access';
import { useSettings } from '../../state/settings';
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
  useAccess.setState({ access: FREE_ACCESS });
  useSettings.setState({ captionWordHighlight: false });
});

const timedResult = {
  transcript: 'write your script',
  segments: ['write', 'your', 'script'].map((w, i) => ({ text: w, startMs: i * 400, endMs: i * 400 + 350, confidence: 0.9 })),
};

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

  it('highlights the spoken word for Pro users with word-timed captions', async () => {
    await setupTake();
    useAccess.setState({ access: { ...FREE_ACCESS, isPro: true, source: 'subscription' } });
    mockTranscribe.mockResolvedValue(timedResult);
    const Captions = require('../captions/[id]').default;
    await renderScreen(<Captions />);
    await fireEvent.press(await screen.findByLabelText('Generate captions'));
    const toggle = await screen.findByLabelText('Highlight the spoken word');
    // Clean has no highlight colour: the row explains which styles show it.
    expect(screen.getByText('Choose Soft Box, Creator Bold or Pop to see the highlight.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Pop'));
    await fireEvent(toggle, 'valueChange', true);
    expect(useSettings.getState().captionWordHighlight).toBe(true);
    // Playback is at 0 ms: the first word is lit.
    expect(screen.getByTestId('caption-active-word')).toHaveTextContent('Write', { exact: false });

    // Editing the cue drops its word timing, so nothing is highlighted any more.
    await fireEvent.changeText(screen.getByDisplayValue('Write your script'), 'Write your scripts');
    expect(screen.queryByTestId('caption-active-word')).toBeNull();
    expect(screen.queryByLabelText('Highlight the spoken word')).toBeNull();
  });

  it('sends free users to the paywall for word highlight', async () => {
    await setupTake();
    mockTranscribe.mockResolvedValue(timedResult);
    const Captions = require('../captions/[id]').default;
    await renderScreen(<Captions />);
    await fireEvent.press(await screen.findByLabelText('Generate captions'));
    await fireEvent.press(await screen.findByLabelText('Soft Box'));
    await fireEvent(screen.getByLabelText('Highlight the spoken word'), 'valueChange', true);
    expect(mockPush).toHaveBeenCalledWith('/paywall?trigger=captionWordHighlight');
    expect(useSettings.getState().captionWordHighlight).toBe(false);
  });

  it('does not offer word highlight on estimated timing', async () => {
    await setupTake();
    mockTranscribe.mockResolvedValue({ transcript: 'write your script', segments: [{ text: 'write your script', startMs: 0, endMs: 1200, confidence: 0.9 }] });
    const Captions = require('../captions/[id]').default;
    await renderScreen(<Captions />);
    await fireEvent.press(await screen.findByLabelText('Generate captions'));
    expect(await screen.findByText('Timing is approximate on this device. Word highlighting is unavailable.')).toBeTruthy();
    expect(screen.queryByLabelText('Highlight the spoken word')).toBeNull();
  });

  it('shows part progress on long takes and can be cancelled', async () => {
    await setupTake();
    mockTranscribe.mockImplementation((_uri: string, _locale: string, opts: { signal: AbortSignal; onProgress: (n: number, t: number) => void }) => {
      opts.onProgress(2, 6);
      const { TranscriptionError } = jest.requireActual('../../services/transcription');
      return new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(new TranscriptionError('cancelled'))));
    });
    const Captions = require('../captions/[id]').default;
    await renderScreen(<Captions />);
    await fireEvent.press(await screen.findByLabelText('Generate captions'));
    expect(await screen.findByText('Part 2 of 6')).toBeTruthy();
    expect(mockTranscribe.mock.calls[0]![2]).toMatchObject({ durationMs: 4000 });
    await fireEvent.press(screen.getByLabelText('Cancel'));
    expect(await screen.findByText('Caption generation was cancelled.')).toBeTruthy();
  });

  it('reports parts of the take that have no captions', async () => {
    await setupTake();
    mockTranscribe.mockResolvedValue({
      ...timedResult,
      gaps: [
        { startMs: 49_000, endMs: 99_000, reason: 'failed' },
        { startMs: 120_000, endMs: 300_000, reason: 'stopped_early' },
      ],
    });
    const Captions = require('../captions/[id]').default;
    await renderScreen(<Captions />);
    await fireEvent.press(await screen.findByLabelText('Generate captions'));
    expect(await screen.findByText('Part of the take couldn’t be transcribed (0:49–1:39). Captions are missing there.')).toBeTruthy();
    expect(screen.getByText(/^Captions stop at 2:00\./)).toBeTruthy();
  });
});
