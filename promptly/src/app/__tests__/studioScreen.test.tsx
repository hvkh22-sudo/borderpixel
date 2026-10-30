/**
 * @jest-environment node
 */
/* AI Studio screen: apply once, cancel on leave, clear errors (real SQLite, mocked AI service). */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';

import { useSettings } from '../../state/settings';
import { createRepos, renderScreen } from './testUtils';

let mockRepos: Awaited<ReturnType<typeof createRepos>>;
const mockParams: Record<string, string> = {};
const mockRunStudio = jest.fn();

jest.mock('../../services/db', () => ({ getRepositories: () => Promise.resolve(mockRepos) }));
jest.mock('../../services/ai', () => ({
  ...jest.requireActual('../../services/ai'),
  aiAvailable: () => true,
  runStudio: (...a: unknown[]) => mockRunStudio(...a),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));

beforeEach(async () => {
  mockRepos = await createRepos();
  for (const k of Object.keys(mockParams)) delete mockParams[k];
  mockRunStudio.mockReset();
  jest.mocked(router.back).mockClear();
  jest.mocked(router.push).mockClear();
  useSettings.getState().hydrate({ onboardingDone: true, aiConsent: true });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('Studio', () => {
  it('applies a draft once even when "Use this draft" is tapped twice', async () => {
    const s = await mockRepos.scripts.create({ title: 'T', body: 'original' });
    Object.assign(mockParams, { scriptId: s.id, tool: 'improve' });
    mockRunStudio.mockResolvedValue({ text: 'improved', remaining: 4 });
    const Studio = require('../studio').default;
    await renderScreen(<Studio />);
    await waitFor(() => expect(screen.getByLabelText('Generate').props.accessibilityState?.disabled).toBeFalsy());
    await fireEvent.press(screen.getByLabelText('Generate'));
    const use = await screen.findByLabelText('Use this draft');
    await act(async () => {
      fireEvent.press(use);
      fireEvent.press(use);
    });
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect((await mockRepos.scripts.get(s.id))?.body).toBe('improved');
    expect((await mockRepos.scripts.listVersions(s.id)).map((v) => v.source)).toEqual(['improve', 'before_ai']);
  });

  it('cancels a Generate request when the screen closes and opens no paywall', async () => {
    let signal: AbortSignal | undefined;
    const { AiError } = jest.requireActual('../../services/ai');
    mockRunStudio.mockImplementation(
      (_req: unknown, sig: AbortSignal) =>
        new Promise((_r, reject) => {
          signal = sig;
          sig.addEventListener('abort', () => reject(new AiError('aborted')));
        }),
    );
    const Studio = require('../studio').default;
    const view = await renderScreen(<Studio />);
    await fireEvent.changeText(screen.getByLabelText('What is the video about?'), 'Morning routine');
    await fireEvent.press(screen.getByLabelText('Generate'));
    await waitFor(() => expect(signal).toBeDefined());
    await view.unmount();
    expect(signal!.aborted).toBe(true);
    await act(async () => {});
    expect(router.push).not.toHaveBeenCalled();
  });

  it('says retrying will not help when the AI declines', async () => {
    const { AiError } = jest.requireActual('../../services/ai');
    mockRunStudio.mockRejectedValue(new AiError('refused'));
    const Studio = require('../studio').default;
    await renderScreen(<Studio />);
    await fireEvent.changeText(screen.getByLabelText('What is the video about?'), 'Something');
    await fireEvent.press(screen.getByLabelText('Generate'));
    expect(await screen.findByText(/can’t help with this request/)).toBeTruthy();
  });
});
