/**
 * @jest-environment node
 */
import { migrate, MIGRATIONS } from '../migrations';
import { KeyValueStore, RecordingRepository, ScriptRepository, deriveTitle } from '../repositories';
import { createTestDb } from './nodeSqlite';

async function setup() {
  const db = createTestDb();
  await migrate(db);
  let t = 1000;
  let n = 0;
  const deps = { db, now: () => (t += 10), newId: () => `id${++n}` };
  return { db, scripts: new ScriptRepository(deps), recordings: new RecordingRepository(deps), kv: new KeyValueStore(db) };
}

describe('migrations', () => {
  it('migrates to the latest version and is idempotent', async () => {
    const db = createTestDb();
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(await migrate(db)).toBe(MIGRATIONS.length);
  });
});

describe('ScriptRepository', () => {
  it('creates, updates, searches and sorts', async () => {
    const { scripts } = await setup();
    const a = await scripts.create({ title: 'Morning routine', body: 'Wake up early' });
    const b = await scripts.create({ title: 'Camera tips', body: 'Use 100% natural light_' });
    await scripts.update(a.id, { body: 'Wake up early and stretch', favorite: true });

    expect((await scripts.list()).map((s) => s.id)).toEqual([a.id, b.id]);
    expect((await scripts.list({ query: 'stretch' })).map((s) => s.id)).toEqual([a.id]);
    // LIKE wildcards in user input are literal.
    expect((await scripts.list({ query: '100%' })).map((s) => s.id)).toEqual([b.id]);
    expect((await scripts.list({ query: 'light_' })).map((s) => s.id)).toEqual([b.id]);
    expect((await scripts.list({ favoritesOnly: true })).map((s) => s.id)).toEqual([a.id]);
    expect((await scripts.list({ sort: 'title' })).map((s) => s.title)).toEqual(['Camera tips', 'Morning routine']);
  });

  it('duplicates, soft-deletes, restores and purges', async () => {
    const { scripts } = await setup();
    const a = await scripts.create({ title: 'Hook ideas', body: 'body' });
    const copy = await scripts.duplicate(a.id, '(copy)');
    expect(copy?.title).toBe('Hook ideas (copy)');
    await scripts.remove(a.id);
    expect(await scripts.get(a.id)).toBeNull();
    await scripts.restore(a.id);
    expect(await scripts.get(a.id)).not.toBeNull();
    await scripts.remove(a.id);
    expect(await scripts.purgeDeleted(Number.MAX_SAFE_INTEGER)).toBe(1);
    expect((await scripts.list()).length).toBe(1);
  });

  it('keeps a bounded version history', async () => {
    const { scripts } = await setup();
    const a = await scripts.create({ title: 't', body: 'v0' });
    for (let i = 0; i < 35; i++) await scripts.addVersion(a.id, `v${i}`, 'improve');
    const versions = await scripts.listVersions(a.id);
    expect(versions).toHaveLength(30);
    expect(versions[0]!.body).toBe('v34');
  });

  it('derives titles from the first non-empty line', () => {
    expect(deriveTitle('\n\n  Hello world  \nmore', 'Untitled')).toBe('Hello world');
    expect(deriveTitle('', 'Untitled')).toBe('Untitled');
    expect(deriveTitle('x'.repeat(80), 'U').length).toBe(48);
  });
});

describe('RecordingRepository', () => {
  it('stores recordings and captions', async () => {
    const { recordings } = await setup();
    const r = await recordings.add({
      scriptId: null,
      fileName: 'rec1.mov',
      durationMs: 5000,
      width: 1080,
      height: 1920,
      status: 'ready',
    });
    await recordings.saveCaptions(r.id, [{ id: 'c1', startMs: 0, endMs: 1000, text: 'Hi' }], 'clean', 'upper');
    await recordings.markSavedToLibrary(r.id);
    const got = await recordings.get(r.id);
    expect(got).toMatchObject({ captionStyle: 'clean', captionPosition: 'upper', savedToLibrary: true, durationMs: 5000 });
    expect(got?.cues?.[0]?.text).toBe('Hi');
    expect(await recordings.knownFileNames()).toEqual(new Set(['rec1.mov']));
    await recordings.remove(r.id);
    expect(await recordings.list()).toEqual([]);
  });
});

describe('KeyValueStore', () => {
  it('gets, sets and increments JSON values', async () => {
    const { kv } = await setup();
    expect(await kv.get('missing', 42)).toBe(42);
    await kv.set('settings', { fontSize: 32 });
    expect(await kv.get('settings', {})).toEqual({ fontSize: 32 });
    expect(await kv.increment('vf')).toBe(1);
    expect(await kv.increment('vf')).toBe(2);
    await kv.remove('vf');
    expect(await kv.get('vf', 0)).toBe(0);
  });
});
