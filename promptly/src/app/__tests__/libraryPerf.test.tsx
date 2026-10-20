/**
 * @jest-environment node
 */
/* Library search hits SQLite once per typing pause, not once per keystroke. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useSettings } from '../../state/settings';
import { createRepos, renderScreen } from './testUtils';

let mockRepos: Awaited<ReturnType<typeof createRepos>>;

jest.mock('../../services/db', () => ({ getRepositories: () => Promise.resolve(mockRepos) }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
    Stack: { Screen: () => null },
  };
});

beforeEach(async () => {
  mockRepos = await createRepos();
  useSettings.getState().hydrate({ onboardingDone: true });
});

it('debounces search queries while typing', async () => {
  await mockRepos.scripts.create({ title: 'Morning routine', body: 'wake up' });
  await mockRepos.scripts.create({ title: 'Camera tips', body: 'use light' });
  const list = jest.spyOn(mockRepos.scripts, 'list');
  const Library = require('../scripts/index').default;
  await renderScreen(<Library />);
  await screen.findByText('Morning routine');
  const initialCalls = list.mock.calls.length;

  const input = screen.getByLabelText('Search scripts');
  for (const prefix of ['c', 'ca', 'cam', 'came', 'camer', 'camera']) await fireEvent.changeText(input, prefix);
  await waitFor(() => expect(screen.queryByText('Morning routine')).toBeNull());
  expect(screen.getByText('Camera tips')).toBeTruthy();
  const queries = list.mock.calls.slice(initialCalls).map((c) => c[0]?.query);
  // Six keystrokes, one query (was six before debouncing).
  expect(queries).toEqual(['camera']);
});
