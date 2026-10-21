/**
 * Per-device test overrides set from the hidden diagnostics screen and kept
 * in KV. They exist for device testing (switch the iOS Voice Follow audio
 * strategy if VF-01 fails, try burn-in, send AI requests without integrity
 * headers) and never block recording: every value falls back to the build
 * default when unset or unreadable.
 */
import { create } from 'zustand';

import { parseIosVoiceFollowAudio, type IosVoiceFollowAudio } from '../features/platform/audioStrategy';
import type { FeatureFlags } from '../features/platform/support';
import { config, flags } from './config';
import { getRepositories } from './db';

export type FlagOverride = 'default' | 'on' | 'off';

export interface DiagnosticsOverrides {
  /** null = build default (`config.iosVoiceFollowAudio`). */
  iosVoiceFollowAudio: IosVoiceFollowAudio | null;
  burnIn: FlagOverride;
  /** Send App Attest / Play Integrity headers with AI requests (on by default). */
  integrityHeaders: boolean;
}

export const DEFAULT_OVERRIDES: DiagnosticsOverrides = { iosVoiceFollowAudio: null, burnIn: 'default', integrityHeaders: true };
export const OVERRIDES_KEY = 'diagnostics.overrides.v1';

/** Validates a stored value field by field; anything unknown becomes the default. */
export function parseOverrides(raw: unknown): DiagnosticsOverrides {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    iosVoiceFollowAudio: parseIosVoiceFollowAudio(o.iosVoiceFollowAudio),
    burnIn: o.burnIn === 'on' || o.burnIn === 'off' ? o.burnIn : 'default',
    integrityHeaders: typeof o.integrityHeaders === 'boolean' ? o.integrityHeaders : true,
  };
}

interface OverridesStore extends DiagnosticsOverrides {
  hydrate(raw: unknown): void;
  /** Applies at once and persists (best effort). */
  set(patch: Partial<DiagnosticsOverrides>): Promise<void>;
  reset(): Promise<void>;
}

const snapshot = (s: DiagnosticsOverrides): DiagnosticsOverrides => ({
  iosVoiceFollowAudio: s.iosVoiceFollowAudio,
  burnIn: s.burnIn,
  integrityHeaders: s.integrityHeaders,
});

async function save(o: DiagnosticsOverrides): Promise<void> {
  try {
    await (await getRepositories()).kv.set(OVERRIDES_KEY, o);
  } catch {
    // Kept for this session only.
  }
}

export const useDiagnosticsOverrides = create<OverridesStore>((set, get) => ({
  ...DEFAULT_OVERRIDES,
  hydrate: (raw) => set(parseOverrides(raw)),
  set: async (patch) => {
    set(parseOverrides({ ...snapshot(get()), ...patch }));
    await save(snapshot(get()));
  },
  reset: async () => {
    set(DEFAULT_OVERRIDES);
    await save(DEFAULT_OVERRIDES);
  },
}));

export function effectiveIosVoiceFollowAudio(o: DiagnosticsOverrides = useDiagnosticsOverrides.getState()): IosVoiceFollowAudio {
  return o.iosVoiceFollowAudio ?? config.iosVoiceFollowAudio;
}

/** Build flags with the device overrides applied. */
export function effectiveFlags(o: DiagnosticsOverrides = useDiagnosticsOverrides.getState()): FeatureFlags & { aiStudio: boolean } {
  return { ...flags, burnIn: o.burnIn === 'default' ? flags.burnIn : o.burnIn === 'on' };
}

export function integrityHeadersEnabled(): boolean {
  return useDiagnosticsOverrides.getState().integrityHeaders;
}
