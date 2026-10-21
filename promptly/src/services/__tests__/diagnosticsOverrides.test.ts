/**
 * @jest-environment node
 */
import { migrate } from '../../storage/migrations';
import { KeyValueStore } from '../../storage/repositories';
import { createTestDb } from '../../storage/__tests__/nodeSqlite';
import { flags } from '../config';
import {
  DEFAULT_OVERRIDES,
  OVERRIDES_KEY,
  effectiveFlags,
  effectiveIosVoiceFollowAudio,
  integrityHeadersEnabled,
  parseOverrides,
  useDiagnosticsOverrides,
} from '../diagnosticsOverrides';

let mockKv: KeyValueStore;
jest.mock('../db', () => ({ getRepositories: async () => ({ kv: mockKv }) }));

beforeEach(async () => {
  const db = createTestDb();
  await migrate(db);
  mockKv = new KeyValueStore(db);
  useDiagnosticsOverrides.setState(DEFAULT_OVERRIDES);
});

describe('diagnostics overrides', () => {
  it('validates stored values field by field', () => {
    expect(parseOverrides(null)).toEqual(DEFAULT_OVERRIDES);
    expect(parseOverrides({ iosVoiceFollowAudio: 'separate', burnIn: 'on', integrityHeaders: false })).toEqual({
      iosVoiceFollowAudio: 'separate',
      burnIn: 'on',
      integrityHeaders: false,
    });
    expect(parseOverrides({ iosVoiceFollowAudio: 'loud', burnIn: 'maybe', integrityHeaders: 'no' })).toEqual(DEFAULT_OVERRIDES);
  });

  it('persists every change to KV and hydrates it back', async () => {
    await useDiagnosticsOverrides.getState().set({ iosVoiceFollowAudio: 'separate' });
    await useDiagnosticsOverrides.getState().set({ integrityHeaders: false });
    expect(await mockKv.get(OVERRIDES_KEY, null)).toEqual({ iosVoiceFollowAudio: 'separate', burnIn: 'default', integrityHeaders: false });

    useDiagnosticsOverrides.setState(DEFAULT_OVERRIDES);
    useDiagnosticsOverrides.getState().hydrate(await mockKv.get(OVERRIDES_KEY, null));
    expect(effectiveIosVoiceFollowAudio()).toBe('separate');
    expect(integrityHeadersEnabled()).toBe(false);

    await useDiagnosticsOverrides.getState().reset();
    expect(await mockKv.get(OVERRIDES_KEY, null)).toEqual(DEFAULT_OVERRIDES);
    expect(effectiveIosVoiceFollowAudio()).toBe('shared'); // build default in tests
  });

  it('applies the burn-in override on top of the build flag', () => {
    expect(effectiveFlags().burnIn).toBe(flags.burnIn);
    expect(effectiveFlags({ ...DEFAULT_OVERRIDES, burnIn: 'on' }).burnIn).toBe(true);
    expect(effectiveFlags({ ...DEFAULT_OVERRIDES, burnIn: 'off' }).burnIn).toBe(false);
    expect(effectiveFlags({ ...DEFAULT_OVERRIDES, burnIn: 'on' }).voiceFollow).toBe(flags.voiceFollow);
  });
});
