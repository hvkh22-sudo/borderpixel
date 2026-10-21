import {
  checklistView,
  completeMilestone,
  firstRunKey,
  INITIAL_FIRST_RUN,
  loadFirstRun,
  newlyReached,
  parseFirstRun,
  reconcileWithLibrary,
  saveFirstRunChanges,
  shouldShowRecordTip,
  shouldShowSetupTip,
  takeTip,
  type FirstRunFlags,
  type FirstRunKv,
} from '../firstRun';

const flags = (patch: Partial<FirstRunFlags> = {}): FirstRunFlags => ({ ...INITIAL_FIRST_RUN, ...patch });

function memoryKv(initial: Record<string, unknown> = {}): FirstRunKv & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: async <T,>(key: string, fallback: T) => (data.has(key) ? (data.get(key) as T) : fallback),
    set: async <T,>(key: string, value: T) => void data.set(key, value),
  };
}

describe('firstRun milestones', () => {
  it('completing a milestone implies the earlier ones', () => {
    expect(completeMilestone(INITIAL_FIRST_RUN, 'firstExport')).toMatchObject({ firstScriptCreated: true, firstTakeRecorded: true, firstExport: true });
    expect(completeMilestone(INITIAL_FIRST_RUN, 'firstScriptCreated')).toMatchObject({ firstScriptCreated: true, firstTakeRecorded: false });
  });

  it('reports newly reached milestones in order', () => {
    const next = completeMilestone(flags({ firstScriptCreated: true }), 'firstExport');
    expect(newlyReached(flags({ firstScriptCreated: true }), next)).toEqual(['firstTakeRecorded', 'firstExport']);
    expect(newlyReached(next, next)).toEqual([]);
  });

  it('reconciles with an existing library without touching dismissals', () => {
    expect(reconcileWithLibrary(INITIAL_FIRST_RUN, { scripts: 0, takes: 0 })).toBe(INITIAL_FIRST_RUN);
    expect(reconcileWithLibrary(INITIAL_FIRST_RUN, { scripts: 2, takes: 0 })).toEqual(flags({ firstScriptCreated: true }));
    expect(reconcileWithLibrary(flags({ checklistHidden: true }), { scripts: 1, takes: 1 })).toEqual(
      flags({ firstScriptCreated: true, firstTakeRecorded: true, checklistHidden: true }),
    );
  });

  it('parses persisted values tolerantly and keeps the chain consistent', () => {
    expect(parseFirstRun({})).toEqual(INITIAL_FIRST_RUN);
    expect(parseFirstRun({ firstScriptCreated: 'yes', checklistHidden: 1 })).toEqual(INITIAL_FIRST_RUN);
    expect(parseFirstRun({ firstExport: true })).toMatchObject({ firstScriptCreated: true, firstTakeRecorded: true, firstExport: true });
  });
});

describe('firstRun persistence', () => {
  it('stores one boolean per firstRun.* key and loads it back', async () => {
    const kv = memoryKv();
    const next = completeMilestone(INITIAL_FIRST_RUN, 'firstTakeRecorded');
    await saveFirstRunChanges(kv, INITIAL_FIRST_RUN, next);
    expect([...kv.data.keys()].sort()).toEqual(['firstRun.firstScriptCreated', 'firstRun.firstTakeRecorded']);
    expect(kv.data.get(firstRunKey('firstTakeRecorded'))).toBe(true);
    expect(await loadFirstRun(kv)).toEqual(next);
  });

  it('loads defaults from an empty or foreign store', async () => {
    expect(await loadFirstRun(memoryKv({ 'settings.v1': { x: 1 } }))).toEqual(INITIAL_FIRST_RUN);
  });
});

describe('firstRun view decisions', () => {
  it('walks the checklist write → record → export, then disappears after the first export', () => {
    expect(checklistView(INITIAL_FIRST_RUN)).toEqual({ current: 'write', done: { write: false, record: false, export: false }, celebrate: false });
    expect(checklistView(flags({ firstScriptCreated: true }))).toMatchObject({ current: 'record', celebrate: false });
    expect(checklistView(completeMilestone(INITIAL_FIRST_RUN, 'firstTakeRecorded'))).toMatchObject({ current: 'export', celebrate: true });
    expect(checklistView(completeMilestone(INITIAL_FIRST_RUN, 'firstExport'))).toBeNull();
  });

  it('never shows the checklist after Hide', () => {
    expect(checklistView(flags({ checklistHidden: true }))).toBeNull();
    expect(checklistView(flags({ checklistHidden: true, firstScriptCreated: true, firstTakeRecorded: true }))).toBeNull();
  });

  it('shows the setup tip once, and only before the first take', () => {
    expect(shouldShowSetupTip(INITIAL_FIRST_RUN)).toBe(true);
    expect(shouldShowSetupTip(flags({ setupTipSeen: true }))).toBe(false);
    expect(shouldShowSetupTip(completeMilestone(INITIAL_FIRST_RUN, 'firstTakeRecorded'))).toBe(false);
  });

  it('shows the record tip until the first take', () => {
    expect(shouldShowRecordTip(INITIAL_FIRST_RUN)).toBe(true);
    expect(shouldShowRecordTip(completeMilestone(INITIAL_FIRST_RUN, 'firstTakeRecorded'))).toBe(false);
  });

  it('points the take tip at captions, then Export, and stops after export or dismissal', () => {
    const took = completeMilestone(INITIAL_FIRST_RUN, 'firstTakeRecorded');
    expect(takeTip(INITIAL_FIRST_RUN, false)).toBeNull();
    expect(takeTip(took, false)).toBe('captions');
    expect(takeTip(took, true)).toBe('export');
    expect(takeTip({ ...took, takeTipDismissed: true }, false)).toBeNull();
    expect(takeTip(completeMilestone(took, 'firstExport'), true)).toBeNull();
  });
});
