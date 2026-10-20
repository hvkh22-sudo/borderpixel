/**
 * @jest-environment node
 */
import { migrate, MIGRATIONS } from '../migrations';
import { FolderRepository, KeyValueStore, RecordingRepository, ScriptRepository, deriveTitle, normalizeFolderName } from '../repositories';
import { createTestDb } from './nodeSqlite';

async function setup() {
  const db = createTestDb();
  await migrate(db);
  let t = 1000;
  let n = 0;
  const deps = { db, now: () => (t += 10), newId: () => `id${++n}` };
  return { db, scripts: new ScriptRepository(deps), folders: new FolderRepository(deps), recordings: new RecordingRepository(deps), kv: new KeyValueStore(db) };
}

describe('migrations', () => {
  it('migrates to the latest version and is idempotent', async () => {
    const db = createTestDb();
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(await migrate(db)).toBe(MIGRATIONS.length);
  });

  it('adds folders to a database created before folders existed, keeping scripts', async () => {
    const db = createTestDb();
    // Apply only the shipped pre-folder migrations, then add a script the old way.
    for (const [i, sql] of MIGRATIONS.slice(0, 2).entries()) {
      await db.execAsync(sql);
      await db.execAsync(`PRAGMA user_version = ${i + 1}`);
    }
    await db.runAsync('INSERT INTO scripts (id, title, body, favorite, created_at, updated_at) VALUES (?, ?, ?, 0, 1, 1)', ['old', 'Old', 'kept']);
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    const scripts = new ScriptRepository({ db, now: () => 5, newId: () => 'x' });
    expect(await scripts.get('old')).toMatchObject({ title: 'Old', body: 'kept', folderId: null });
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

describe('FolderRepository', () => {
  it('creates, renames and lists folders with live script counts', async () => {
    const { scripts, folders } = await setup();
    const hooks = await folders.create('  Hooks  ');
    const ads = await folders.create('Ads');
    expect(hooks.name).toBe('Hooks');
    expect(ads.sortOrder).toBe(hooks.sortOrder + 1);
    await expect(folders.create('   ')).rejects.toThrow();

    const a = await scripts.create({ title: 'a', body: '' });
    await scripts.create({ title: 'b', body: '', folderId: hooks.id });
    await scripts.moveToFolder(a.id, hooks.id);
    const gone = await scripts.create({ title: 'gone', body: '', folderId: hooks.id });
    await scripts.remove(gone.id);

    await folders.rename(ads.id, 'Sponsored');
    await folders.rename(ads.id, '   '); // ignored
    expect((await folders.listWithCounts()).map((f) => [f.name, f.scriptCount])).toEqual([
      ['Hooks', 2],
      ['Sponsored', 0],
    ]);
  });

  it('lists scripts by folder and keeps search and sort inside the folder', async () => {
    const { scripts, folders } = await setup();
    const f = await folders.create('Series');
    const ep2 = await scripts.create({ title: 'Episode 2', body: 'second', folderId: f.id });
    const ep1 = await scripts.create({ title: 'Episode 1', body: 'first', folderId: f.id });
    const loose = await scripts.create({ title: 'Loose idea', body: 'first thought' });
    await scripts.update(ep1.id, { favorite: true });

    expect((await scripts.list({ folderId: f.id, sort: 'title' })).map((s) => s.id)).toEqual([ep1.id, ep2.id]);
    expect((await scripts.list({ folderId: f.id, query: 'first' })).map((s) => s.id)).toEqual([ep1.id]);
    expect((await scripts.list({ folderId: null })).map((s) => s.id)).toEqual([loose.id]);
    expect((await scripts.list({ folderId: f.id, favoritesOnly: true })).map((s) => s.id)).toEqual([ep1.id]);
    expect(await scripts.list()).toHaveLength(3);
  });

  it('moving does not change the last-edited time; duplicates stay in the folder', async () => {
    const { scripts, folders } = await setup();
    const f = await folders.create('Drafts');
    const s = await scripts.create({ title: 'x', body: 'y' });
    await scripts.moveToFolder(s.id, f.id);
    const moved = await scripts.get(s.id);
    expect(moved).toMatchObject({ folderId: f.id, updatedAt: s.updatedAt });
    expect((await scripts.duplicate(s.id, '(copy)'))?.folderId).toBe(f.id);
    await scripts.moveToFolder(s.id, null);
    expect((await scripts.get(s.id))?.folderId).toBeNull();
  });

  it('deleting a folder moves its scripts to No folder and never deletes them', async () => {
    const { scripts, folders } = await setup();
    const f = await folders.create('Old campaign');
    const a = await scripts.create({ title: 'a', body: 'keep me', folderId: f.id });
    const b = await scripts.create({ title: 'b', body: 'trash', folderId: f.id });
    await scripts.remove(b.id); // soft-deleted, still undoable
    await folders.remove(f.id);

    expect(await folders.get(f.id)).toBeNull();
    expect(await scripts.get(a.id)).toMatchObject({ body: 'keep me', folderId: null });
    await scripts.restore(b.id);
    expect((await scripts.get(b.id))?.folderId).toBeNull();
    expect(await scripts.list({ folderId: null })).toHaveLength(2);
  });

  it('normalizes folder names', () => {
    expect(normalizeFolderName('  a \n  b ')).toBe('a b');
    expect(normalizeFolderName('x'.repeat(60))).toHaveLength(40);
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
