/** Ephemeral, per-launch app state (not persisted). */
import { create } from 'zustand';

interface SessionStore {
  /** Takes found on disk at start-up that were never registered (app killed while saving). */
  recoveredTakes: number;
  setRecoveredTakes(n: number): void;
  dismissRecovered(): void;
}

export const useSession = create<SessionStore>((set) => ({
  recoveredTakes: 0,
  setRecoveredTakes: (n) => set({ recoveredTakes: n }),
  dismissRecovered: () => set({ recoveredTakes: 0 }),
}));
