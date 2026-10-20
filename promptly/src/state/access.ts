/** Purchase access + usage counters (derived from RevenueCat; never hardcoded). */
import { create } from 'zustand';

import { AccessState, FREE_ACCESS, UsageState } from '../features/monetization/entitlements';

interface AccessStore {
  access: AccessState;
  usage: UsageState;
  loaded: boolean;
  setAccess(a: AccessState): void;
  setUsage(u: Partial<UsageState>): void;
}

export const useAccess = create<AccessStore>((set) => ({
  access: FREE_ACCESS,
  usage: { voiceFollowSessionsUsed: 0 },
  loaded: false,
  setAccess: (access) => set({ access, loaded: true }),
  setUsage: (u) => set((s) => ({ usage: { ...s.usage, ...u } })),
}));
