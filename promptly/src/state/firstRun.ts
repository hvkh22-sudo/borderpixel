/**
 * First-take guidance flags (src/features/onboarding/firstRun.ts), hydrated at start-up and
 * persisted to the KV store under `firstRun.*` on every change (best effort; never throws).
 * Until hydration no tip is shown, so a slow or failed storage read never flashes guidance.
 */
import { create } from 'zustand';

import {
  completeMilestone,
  INITIAL_FIRST_RUN,
  newlyReached,
  reconcileWithLibrary,
  saveFirstRunChanges,
  type FirstRunFlags,
  type FirstRunMilestone,
} from '../features/onboarding/firstRun';
import { track, type FirstRunStep } from '../services/analytics';
import { getRepositories } from '../services/db';

const MILESTONE_STEP: Record<FirstRunMilestone, FirstRunStep> = {
  firstScriptCreated: 'script_created',
  firstTakeRecorded: 'take_recorded',
  firstExport: 'exported',
};

type Dismissal = 'checklistHidden' | 'setupTipSeen' | 'takeTipDismissed';

interface FirstRunStore {
  hydrated: boolean;
  flags: FirstRunFlags;
  hydrate(flags: FirstRunFlags): void;
  /** Marks a milestone (and earlier ones); tracks each newly reached step once. */
  complete(milestone: FirstRunMilestone): void;
  /** Counts scripts/takes that exist already (created elsewhere or before this feature). Never tracked. */
  reconcile(library: { scripts: number; takes: number }): void;
  /** Hides a piece of guidance for good. `step` is tracked when the user dismissed it. */
  dismiss(flag: Dismissal, step?: FirstRunStep): void;
  reset(): void;
}

function persist(prev: FirstRunFlags, next: FirstRunFlags): void {
  void getRepositories()
    .then((r) => saveFirstRunChanges(r.kv, prev, next))
    .catch((e: unknown) => {
      if (__DEV__) console.warn('first-run flags not saved', e);
    });
}

export const useFirstRun = create<FirstRunStore>((set, get) => {
  /** `trackSteps: false` marks milestones silently (reconcile catches up on past work, not a step taken now). */
  const apply = (next: FirstRunFlags, trackSteps = true) => {
    const prev = get().flags;
    if (next === prev) return;
    set({ flags: next });
    persist(prev, next);
    if (!trackSteps) return;
    for (const m of newlyReached(prev, next)) track({ name: 'first_run_step', step: MILESTONE_STEP[m] });
  };
  return {
    hydrated: false,
    flags: INITIAL_FIRST_RUN,
    hydrate: (flags) => set({ flags, hydrated: true }),
    complete: (milestone) => {
      if (get().flags[milestone]) return;
      apply(completeMilestone(get().flags, milestone));
    },
    reconcile: (library) => apply(reconcileWithLibrary(get().flags, library), false),
    dismiss: (flag, step) => {
      if (get().flags[flag]) return;
      apply({ ...get().flags, [flag]: true });
      if (step) track({ name: 'first_run_step', step });
    },
    reset: () => set({ flags: INITIAL_FIRST_RUN, hydrated: false }),
  };
});
