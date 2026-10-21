/**
 * @jest-environment node
 */
import type { StudioRequest } from '../../features/ai-script-studio/studio';
import { AiError, runStudio } from '../ai';
import { DEFAULT_OVERRIDES, useDiagnosticsOverrides } from '../diagnosticsOverrides';

const mockIntegrity = { headersFor: jest.fn(), reset: jest.fn() };

jest.mock('../config', () => {
  const actual = jest.requireActual('../config');
  return { ...actual, config: { ...actual.config, aiBaseUrl: 'https://ai.test' }, flags: { ...actual.flags, aiStudio: true } };
});
jest.mock('../db', () => ({ getRepositories: () => Promise.reject(new Error('no db in this test')) }));
jest.mock('../purchases', () => ({ appUserId: async () => 'user1' }));
jest.mock('../integrity', () => ({
  integrity: { headersFor: (...a: unknown[]) => mockIntegrity.headersFor(...a), reset: () => mockIntegrity.reset() },
}));

const req = { tool: 'generate', topic: 'Morning routine', durationSec: 30 } as StudioRequest;
const fetchMock = jest.fn();

beforeEach(() => {
  mockIntegrity.headersFor.mockReset().mockResolvedValue({ 'x-integrity-platform': 'ios' });
  mockIntegrity.reset.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'integrity_required' }) });
  global.fetch = fetchMock as unknown as typeof fetch;
  useDiagnosticsOverrides.setState(DEFAULT_OVERRIDES);
});

describe('runStudio integrity_required', () => {
  it('re-attests from scratch when the integrity headers it sent were rejected', async () => {
    await expect(runStudio(req)).rejects.toEqual(new AiError('unauthorized'));
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'x-integrity-platform': 'ios' });
    expect(mockIntegrity.reset).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored key when the diagnostics override withheld the headers', async () => {
    useDiagnosticsOverrides.setState({ integrityHeaders: false });
    await expect(runStudio(req)).rejects.toEqual(new AiError('unauthorized'));
    expect(mockIntegrity.headersFor).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('x-integrity-platform');
    expect(mockIntegrity.reset).not.toHaveBeenCalled();
  });
});
