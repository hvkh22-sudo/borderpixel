/**
 * First-run guidance ("first take"): lightweight, skippable progress toward the activation
 * event (first completed recording, docs/product/prd.md REQ-ON-1/2). Pure: flags in, view
 * decisions out. Persisted as one boolean per key under `firstRun.*` in the KV store.
 *
 * Nothing here blocks a flow: every tip is optional, dismissible and shown at most until the
 * milestone it helps with is reached.
 */

export interface FirstRunFlags {
  /** Milestones. Later milestones imply the earlier ones. */
  firstScriptCreated: boolean;
  firstTakeRecorded: boolean;
  firstExport: boolean;
  /** The Home checklist was hidden by the user. */
  checklistHidden: boolean;
  /** The setup-screen hint was shown once (it never returns). */
  setupTipSeen: boolean;
  /** The take-screen "captions, then export" hint was dismissed. */
  takeTipDismissed: boolean;
}

export type FirstRunFlag = keyof FirstRunFlags;
export type FirstRunMilestone = 'firstScriptCreated' | 'firstTakeRecorded' | 'firstExport';

export const FIRST_RUN_KEY_PREFIX = 'firstRun.';

export const INITIAL_FIRST_RUN: FirstRunFlags = {
  firstScriptCreated: false,
  firstTakeRecorded: false,
  firstExport: false,
  checklistHidden: false,
  setupTipSeen: false,
  takeTipDismissed: false,
};

export const FIRST_RUN_FLAGS = Object.keys(INITIAL_FIRST_RUN) as FirstRunFlag[];

export function firstRunKey(flag: FirstRunFlag): string {
  return `${FIRST_RUN_KEY_PREFIX}${flag}`;
}

const MILESTONE_ORDER: FirstRunMilestone[] = ['firstScriptCreated', 'firstTakeRecorded', 'firstExport'];

/** Sets a milestone and every earlier one (an export implies a take implies a script). */
export function completeMilestone(flags: FirstRunFlags, milestone: FirstRunMilestone): FirstRunFlags {
  const upTo = MILESTONE_ORDER.indexOf(milestone);
  const next = { ...flags };
  for (const m of MILESTONE_ORDER.slice(0, upTo + 1)) next[m] = true;
  return next;
}

/** Milestones newly reached by `next` compared with `prev`, in order. */
export function newlyReached(prev: FirstRunFlags, next: FirstRunFlags): FirstRunMilestone[] {
  return MILESTONE_ORDER.filter((m) => next[m] && !prev[m]);
}

/**
 * Catches up with data created outside the guided path (AI Studio, the library, a restored
 * backup, or an app version without first-run flags): existing scripts/takes count.
 */
export function reconcileWithLibrary(flags: FirstRunFlags, library: { scripts: number; takes: number }): FirstRunFlags {
  if (library.takes > 0 && !flags.firstTakeRecorded) return completeMilestone(flags, 'firstTakeRecorded');
  if (library.scripts > 0 && !flags.firstScriptCreated) return completeMilestone(flags, 'firstScriptCreated');
  return flags;
}

/** Tolerant parse of persisted values (missing or malformed → false). */
export function parseFirstRun(values: Partial<Record<FirstRunFlag, unknown>>): FirstRunFlags {
  const out = { ...INITIAL_FIRST_RUN };
  for (const f of FIRST_RUN_FLAGS) out[f] = values[f] === true;
  // Keep the implication chain consistent even if only a later flag survived.
  if (out.firstExport) return completeMilestone(out, 'firstExport');
  if (out.firstTakeRecorded) return completeMilestone(out, 'firstTakeRecorded');
  return out;
}

export interface FirstRunKv {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
}

export async function loadFirstRun(kv: FirstRunKv): Promise<FirstRunFlags> {
  const values = await Promise.all(FIRST_RUN_FLAGS.map((f) => kv.get<unknown>(firstRunKey(f), false)));
  return parseFirstRun(Object.fromEntries(FIRST_RUN_FLAGS.map((f, i) => [f, values[i]])));
}

/** Persists the flags that changed between `prev` and `next`. */
export async function saveFirstRunChanges(kv: FirstRunKv, prev: FirstRunFlags, next: FirstRunFlags): Promise<void> {
  const changed = FIRST_RUN_FLAGS.filter((f) => next[f] !== prev[f]);
  await Promise.all(changed.map((f) => kv.set(firstRunKey(f), next[f])));
}

// ---------------------------------------------------------------------------
// View decisions

export type ChecklistStep = 'write' | 'record' | 'export';
export const CHECKLIST_STEPS: readonly ChecklistStep[] = ['write', 'record', 'export'];

export interface ChecklistView {
  current: ChecklistStep;
  done: Record<ChecklistStep, boolean>;
  /** The first take exists: celebrate (subtly) and point at Export. */
  celebrate: boolean;
}

/** Home checklist, or null once hidden or after the first export. */
export function checklistView(flags: FirstRunFlags): ChecklistView | null {
  if (flags.checklistHidden || flags.firstExport) return null;
  const done = { write: flags.firstScriptCreated, record: flags.firstTakeRecorded, export: false };
  const current: ChecklistStep = !done.write ? 'write' : !done.record ? 'record' : 'export';
  return { current, done, celebrate: flags.firstTakeRecorded };
}

/** Setup screen hint: only on the very first visit, before any take. */
export function shouldShowSetupTip(flags: FirstRunFlags): boolean {
  return !flags.setupTipSeen && !flags.firstTakeRecorded;
}

/** Record screen overlay hint: until the first take is recorded. */
export function shouldShowRecordTip(flags: FirstRunFlags): boolean {
  return !flags.firstTakeRecorded;
}

export type TakeTip = 'captions' | 'export';

/** Take screen hint after the first take: captions first, then export. */
export function takeTip(flags: FirstRunFlags, hasCaptions: boolean): TakeTip | null {
  if (!flags.firstTakeRecorded || flags.firstExport || flags.takeTipDismissed) return null;
  return hasCaptions ? 'export' : 'captions';
}
