/**
 * @jest-environment node
 */
import { BACKUP_FORMAT, BACKUP_VERSION, BackupError, backupFileName, collectBackup, importBackup, parseBackup, planMerge, serializeBackup } from '../backup';
import { migrate } from '../migrations';
import { FolderRepository, ScriptRepository } from '../repositories';
import { createTestDb } from './nodeSqlite';

async function setup(prefix: string) {
  const db = createTestDb();
  await migrate(db);
  let t = 1000;
  let n = 0;
  const deps = { db, now: () => (t += 10), newId: () => `${prefix}${++n}` };
  return { scripts: new ScriptRepository(deps), folders: new FolderRepository(deps) };
}

/** A device with two folders, three scripts (one soft-deleted) and version history. */
async function seeded(prefix = 'id') {
  const repos = await setup(prefix);
  const hooks = await repos.folders.create('Hooks');
  await repos.folders.create('Empty');
  const a = await repos.scripts.create({ title: 'Hook one', body: 'Stop scrolling — שלום', folderId: hooks.id });
  await repos.scripts.update(a.id, { favorite: true });
  await repos.scripts.addVersion(a.id, 'older draft', 'before_ai');
  const b = await repos.scripts.create({ title: 'Loose', body: 'no folder' });
  const trashed = await repos.scripts.create({ title: 'Trashed', body: 'x' });
  await repos.scripts.remove(trashed.id);
  return { repos, a, b };
}

const fresh = () => {
  let n = 0;
  return () => `new${++n}`;
};

describe('backup format', () => {
  it('round-trips scripts, versions and folders without loss', async () => {
    const { repos } = await seeded();
    const data = await collectBackup(repos);
    expect(data.scripts.map((s) => s.title)).toEqual(['Hook one', 'Loose']); // soft-deleted excluded
    expect(data.versions).toHaveLength(1);
    expect(data.folders.map((f) => f.name)).toEqual(['Hooks', 'Empty']);

    const text = serializeBackup(data, 1234);
    const json = JSON.parse(text);
    expect(json).toMatchObject({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: 1234 });
    expect(parseBackup(text)).toEqual(data);
  });

  it('rejects malformed input with a typed error', () => {
    const valid = JSON.parse(serializeBackup({ folders: [], scripts: [], versions: [] }, 1));
    const code = (text: string) => {
      try {
        parseBackup(text);
        return 'ok';
      } catch (e) {
        expect(e).toBeInstanceOf(BackupError);
        return (e as BackupError).code;
      }
    };
    const withScripts = (scripts: unknown[]) => JSON.stringify({ ...valid, scripts });
    const goodScript = { id: 's', title: 't', body: 'b', favorite: false, createdAt: 1, updatedAt: 1, lastOpenedAt: null, folderId: null };

    expect(code('not json {')).toBe('invalid_json');
    expect(code('[]')).toBe('not_a_backup');
    expect(code(JSON.stringify({ ...valid, format: 'other-app' }))).toBe('not_a_backup');
    expect(code(JSON.stringify({ ...valid, version: BACKUP_VERSION + 1 }))).toBe('unsupported_version');
    expect(code(JSON.stringify({ ...valid, version: '1' }))).toBe('unsupported_version');
    expect(code(JSON.stringify({ ...valid, version: 0 }))).toBe('unsupported_version');
    expect(code(JSON.stringify({ ...valid, scripts: undefined }))).toBe('malformed');
    expect(code(withScripts([{ ...goodScript, body: 42 }]))).toBe('malformed');
    expect(code(withScripts([{ ...goodScript, id: '' }]))).toBe('malformed');
    expect(code(withScripts([{ ...goodScript, favorite: 1 }]))).toBe('malformed');
    expect(code(withScripts([goodScript, goodScript]))).toBe('malformed');
    expect(code(JSON.stringify({ ...valid, folders: [{ id: 'f', name: '   ', createdAt: 1, sortOrder: 0 }] }))).toBe('malformed');
    expect(code(withScripts([goodScript]))).toBe('ok');
  });

  it('keeps scripts whose folder is missing from the file and drops orphan versions', () => {
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: 1,
      folders: [],
      scripts: [{ id: 's', title: 't', body: 'b', favorite: false, createdAt: 1, updatedAt: 1, lastOpenedAt: null, folderId: 'gone' }],
      versions: [{ id: 'v', scriptId: 'missing', body: 'x', source: 'manual', createdAt: 1 }],
    });
    const data = parseBackup(text);
    expect(data.scripts[0]!.folderId).toBeNull();
    expect(data.versions).toEqual([]);
  });

  it('names export files by local date', () => {
    expect(backupFileName(new Date(2026, 0, 5))).toBe('promptly-scripts-2026-01-05.json');
  });
});

describe('import merge', () => {
  it('restores a backup into an empty device exactly', async () => {
    const { repos: source } = await seeded();
    const text = serializeBackup(await collectBackup(source), 1);
    const target = await setup('t');
    const result = await importBackup(target, text, fresh());
    expect(result).toEqual({ scriptsAdded: 2, foldersAdded: 2, versionsAdded: 1, skippedScripts: 0 });
    expect(await collectBackup(target)).toEqual(await collectBackup(source));
  });

  it('re-importing the same backup adds nothing and changes nothing', async () => {
    const { repos } = await seeded();
    const before = await collectBackup(repos);
    const result = await importBackup(repos, serializeBackup(before, 1), fresh());
    expect(result).toEqual({ scriptsAdded: 0, foldersAdded: 0, versionsAdded: 0, skippedScripts: 2 });
    expect(await collectBackup(repos)).toEqual(before);
  });

  it('never overwrites: a changed script with a known id is added as a copy with a new id', async () => {
    const { repos, a } = await seeded();
    const backup = await collectBackup(repos);
    await repos.scripts.update(a.id, { body: 'edited on this device after the backup' });

    const result = await importBackup(repos, serializeBackup(backup, 1), fresh());
    expect(result.scriptsAdded).toBe(1);
    expect((await repos.scripts.get(a.id))?.body).toBe('edited on this device after the backup');
    const all = await repos.scripts.list({ sort: 'title' });
    const restored = all.find((s) => s.body === 'Stop scrolling — שלום')!;
    expect(restored.id).toMatch(/^new/);
    // It lands in the existing "Hooks" folder (merged by name), and brings its versions under the new id.
    expect(restored.folderId).toBe(a.folderId);
    expect((await repos.scripts.listVersions(restored.id)).map((v) => v.body)).toEqual(['older draft']);
    expect((await repos.scripts.listVersions(a.id)).map((v) => v.body)).toEqual(['older draft']);
  });

  it('merges folders by name and remaps conflicting folder ids', async () => {
    const existing = {
      folders: [{ id: 'f1', name: 'Hooks', createdAt: 1, sortOrder: 0 }],
      scripts: new Map(),
      versionIds: new Set<string>(),
    };
    const plan = planMerge(
      existing,
      {
        folders: [
          { id: 'x', name: 'hooks ', createdAt: 1, sortOrder: 0 },
          { id: 'f1', name: 'Tutorials', createdAt: 1, sortOrder: 1 },
        ],
        scripts: [
          { id: 's1', title: 'a', body: '', favorite: false, createdAt: 1, updatedAt: 1, lastOpenedAt: null, folderId: 'x' },
          { id: 's2', title: 'b', body: '', favorite: false, createdAt: 1, updatedAt: 1, lastOpenedAt: null, folderId: 'f1' },
        ],
        versions: [],
      },
      fresh(),
    );
    expect(plan.folders).toEqual([{ id: 'new1', name: 'Tutorials', createdAt: 1, sortOrder: 1 }]);
    expect(plan.scripts.map((s) => [s.id, s.folderId])).toEqual([
      ['s1', 'f1'],
      ['s2', 'new1'],
    ]);
  });

  it('writes nothing when the file is invalid', async () => {
    const { repos } = await seeded();
    const before = await collectBackup(repos);
    await expect(importBackup(repos, '{"format":"promptly.scripts-backup","version":1,"folders":[],"scripts":[{}],"versions":[]}', fresh())).rejects.toMatchObject({
      code: 'malformed',
    });
    expect(await collectBackup(repos)).toEqual(before);
  });
});
