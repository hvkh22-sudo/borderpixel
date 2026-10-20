/**
 * The creator's learned speaking rate (persisted in the KV store under its
 * own key, so resetting display settings does not forget it).
 */
import { create } from 'zustand';

import {
  addSample,
  durationWpm,
  EMPTY_RATE_HISTORY,
  estimateWpm,
  parseRateHistory,
  type RateSample,
  type SpeakingRateHistory,
} from '../features/teleprompter/speakingRate';
import { getRepositories } from '../services/db';

export const SPEAKING_RATE_KEY = 'speakingRate.v1';

interface SpeakingRateStore {
  history: SpeakingRateHistory;
  hydrate(raw: unknown): void;
  /** Adds a sample and persists it (best effort; never throws). */
  record(sample: RateSample): Promise<void>;
  reset(): void;
}

export const useSpeakingRate = create<SpeakingRateStore>((set, get) => ({
  history: EMPTY_RATE_HISTORY,
  hydrate: (raw) => set({ history: parseRateHistory(raw) }),
  record: async (sample) => {
    const history = addSample(get().history, sample);
    set({ history });
    try {
      await (await getRepositories()).kv.set(SPEAKING_RATE_KEY, history);
    } catch (e) {
      if (__DEV__) console.warn('speaking rate not saved', e);
    }
  },
  reset: () => set({ history: EMPTY_RATE_HISTORY }),
}));

/** Personal pace in WPM, or null until enough takes were measured. */
export function useLearnedWpm(): number | null {
  return useSpeakingRate((s) => estimateWpm(s.history));
}

/** WPM for duration estimates (personal pace, or the default). */
export function useDurationWpm(): number {
  return useSpeakingRate((s) => durationWpm(s.history));
}
