/**
 * @jest-environment node
 */
/* Export: cancelling a caption burn-in is not an export failure. */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { createRepos, renderScreen } from './testUtils';

let mockRepos: Awaited<ReturnType<typeof createRepos>>;
const mockParams: Record<string, string> = {};
const mockDeleted: string[] = [];
let mockProgress: ((p: number) => void) | undefined;
const mockJob: { resolve?: (uri: string) => void; reject?: (e: Error) => void; cancel: jest.Mock; started: number } = { cancel: jest.fn(), started: 0 };

jest.mock('../../services/db', () => ({ getRepositories: () => Promise.resolve(mockRepos) }));
jest.mock('../../services/files', () => ({
  recordingFile: (name: string) => ({ uri: `file:///docs/${name}`, exists: true }),
  exportsDir: () => ({ uri: 'file:///cache/exports' }),
}));
jest.mock('../../services/deviceSupport', () => ({ support: { burnIn: () => ({ ok: true }) } }));
jest.mock('../../services/nativeMedia', () => ({
  PromptlyMedia: {
    burnInCaptions: (_uri: string, _cues: unknown, _style: unknown, onProgress: (p: number) => void) => {
      mockProgress = onProgress;
      mockJob.started++;
      return {
        id: 'job1',
        promise: new Promise<string>((resolve, reject) => ((mockJob.resolve = resolve), (mockJob.reject = reject))),
        cancel: mockJob.cancel,
      };
    },
  },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    mockUri: string;
    constructor(mockPath: string) {
      this.mockUri = mockPath;
    }
    get uri() {
      return this.mockUri;
    }
    delete() {
      mockDeleted.push(this.mockUri);
    }
    async write() {}
  },
}));
jest.mock('expo-media-library', () => ({ requestPermissionsAsync: jest.fn(), Asset: { create: jest.fn() } }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

/** The native module rejects a cancelled job like this (code differs per platform). */
const cancelledError = (code: string) => Object.assign(new Error('Export cancelled'), { code });

beforeEach(async () => {
  mockRepos = await createRepos();
  mockJob.cancel.mockClear();
  mockJob.started = 0;
  mockDeleted.length = 0;
  jest.mocked(require('expo-sharing').shareAsync).mockClear();
  const r = await mockRepos.recordings.add({ scriptId: null, fileName: 'take.mp4', durationMs: 4000, width: null, height: null, status: 'ready' });
  await mockRepos.recordings.saveCaptions(r.id, [{ id: 'c1', startMs: 0, endMs: 1000, text: 'Hello' }] as never, 'clean');
  mockParams.id = r.id;
});

describe('Export', () => {
  it.each(['Cancelled', 'ERR_CANCELLED'])('shows no error after the user cancels the burn-in (%s)', async (code) => {
    const Export = require('../export/[id]').default;
    await renderScreen(<Export />);
    await fireEvent.press(await screen.findByTestId('export-share-video'));
    await fireEvent.press(await screen.findByLabelText('Cancel'));
    expect(mockJob.cancel).toHaveBeenCalled();
    mockJob.reject!(cancelledError(code));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('export-status')).toBeNull();
  });

  it('still reports a real failure', async () => {
    const Export = require('../export/[id]').default;
    await renderScreen(<Export />);
    await fireEvent.press(await screen.findByTestId('export-share-video'));
    await screen.findByTestId('export-progress');
    mockJob.reject!(Object.assign(new Error('boom'), { code: 'ERR_EXPORT_FAILED' }));
    await waitFor(() => expect(screen.getByTestId('export-status')).toBeTruthy());
  });

  it('shares nothing when the burn-in finishes just as the user cancels', async () => {
    const Export = require('../export/[id]').default;
    await renderScreen(<Export />);
    await fireEvent.press(await screen.findByTestId('export-share-video'));
    await fireEvent.press(await screen.findByLabelText('Cancel'));
    mockJob.resolve!('file:///cache/exports/captioned.mp4');
    await new Promise((r) => setTimeout(r, 20));
    expect(require('expo-sharing').shareAsync).not.toHaveBeenCalled();
    expect(screen.queryByTestId('export-status')).toBeNull();
  });

  it('starts one export for a quick double tap', async () => {
    const Export = require('../export/[id]').default;
    await renderScreen(<Export />);
    const share = await screen.findByTestId('export-share-video');
    await act(async () => {
      fireEvent.press(share);
      fireEvent.press(share);
    });
    await screen.findByTestId('export-progress');
    expect(mockJob.started).toBe(1);
    // Settle the job so the screen is idle before the next test.
    await act(async () => mockJob.reject!(cancelledError('Cancelled')));
  });

  it('deletes the captioned copy once it is in Photos, and a bookkeeping failure is not an export failure', async () => {
    const ml = require('expo-media-library');
    ml.requestPermissionsAsync.mockResolvedValue({ granted: true });
    ml.Asset.create.mockResolvedValue({});
    jest.spyOn(mockRepos.recordings, 'markSavedToLibrary').mockRejectedValueOnce(new Error('db busy'));
    const Export = require('../export/[id]').default;
    await renderScreen(<Export />);
    await fireEvent.press(await screen.findByTestId('export-save-photos'));
    await screen.findByTestId('export-progress');
    mockJob.resolve!('file:///cache/exports/captioned_1.mp4');
    await waitFor(() => expect(screen.getByTestId('export-status')).toHaveTextContent('Saved', { exact: false }));
    expect(mockDeleted).toEqual(['file:///cache/exports/captioned_1.mp4']);
  });

  it('keeps a shared captioned copy (the receiving app may still read it)', async () => {
    const Export = require('../export/[id]').default;
    await renderScreen(<Export />);
    await fireEvent.press(await screen.findByTestId('export-share-video'));
    await screen.findByTestId('export-progress');
    mockJob.resolve!('file:///cache/exports/captioned_2.mp4');
    await waitFor(() => expect(require('expo-sharing').shareAsync).toHaveBeenCalled());
    expect(mockDeleted).toEqual([]);
  });

  it('a progress event after Cancel does not bring the progress bar back', async () => {
    const Export = require('../export/[id]').default;
    await renderScreen(<Export />);
    await fireEvent.press(await screen.findByTestId('export-share-video'));
    await fireEvent.press(await screen.findByLabelText('Cancel'));
    await act(async () => mockProgress!(0.6));
    expect(screen.queryByTestId('export-progress')).toBeNull();
  });
});
