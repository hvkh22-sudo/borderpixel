/**
 * @jest-environment node
 */
/* Export: cancelling a caption burn-in is not an export failure. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { createRepos, renderScreen } from './testUtils';

let mockRepos: Awaited<ReturnType<typeof createRepos>>;
const mockParams: Record<string, string> = {};
const mockJob: { reject?: (e: Error) => void; cancel: jest.Mock } = { cancel: jest.fn() };

jest.mock('../../services/db', () => ({ getRepositories: () => Promise.resolve(mockRepos) }));
jest.mock('../../services/files', () => ({
  recordingFile: (name: string) => ({ uri: `file:///docs/${name}`, exists: true }),
  exportsDir: () => ({ uri: 'file:///cache/exports' }),
}));
jest.mock('../../services/deviceSupport', () => ({ support: { burnIn: () => ({ ok: true }) } }));
jest.mock('../../services/nativeMedia', () => ({
  PromptlyMedia: {
    burnInCaptions: () => ({
      id: 'job1',
      promise: new Promise<string>((_resolve, reject) => (mockJob.reject = reject)),
      cancel: mockJob.cancel,
    }),
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
});
