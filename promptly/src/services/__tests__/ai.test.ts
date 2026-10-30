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

describe('runStudio error codes', () => {
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: AiError) => e.code);

  it('tells a refusal apart from a server failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: 'refused' }) });
    expect(await code(runStudio(req))).toBe('refused');
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) });
    expect(await code(runStudio(req))).toBe('server_error');
  });

  it('names an over-long script instead of a generic field error', async () => {
    const long = { tool: 'improve', script: 'x'.repeat(20000) } as StudioRequest;
    expect(await code(runStudio(long))).toBe('script_too_long');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'script_too_long' }) });
    expect(await code(runStudio({ tool: 'improve', script: 'short' } as StudioRequest))).toBe('script_too_long');
  });

  it('reports a cancelled request as aborted', async () => {
    const ac = new AbortController();
    fetchMock.mockImplementation((_u: string, init: { signal: AbortSignal }) =>
      new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    );
    const p = code(runStudio(req, ac.signal));
    await new Promise((r) => setTimeout(r, 0));
    ac.abort();
    expect(await p).toBe('aborted');
  });
});
