import { recoverOrphanRecordings, type OrphanFile, type OrphanRecoveryDeps } from '../orphanRecovery';

function fakeDeps(files: string[], known: string[] = []) {
  const registered: string[] = [...known];
  const deps: OrphanRecoveryDeps = {
    knownFileNames: async () => new Set(registered),
    findOrphans: (k) => files.filter((f) => !k.has(f)).map((name): OrphanFile => ({ name, uri: `file:///docs/recordings/${name}` })),
    videoInfo: async (uri) => (uri.includes('broken') ? Promise.reject(new Error('unreadable')) : { durationMs: 1234.4, width: 1080, height: 1920 }),
    add: jest.fn(async (r) => {
      registered.push(r.fileName);
    }),
  };
  return { deps, registered };
}

describe('recoverOrphanRecordings', () => {
  it('registers unknown files as recovered, including unreadable ones', async () => {
    const { deps, registered } = fakeDeps(['a.mp4', 'broken.mov'], ['known.mp4']);
    expect(await recoverOrphanRecordings(deps)).toBe(2);
    expect(registered).toEqual(['known.mp4', 'a.mp4', 'broken.mov']);
    expect(deps.add).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'a.mp4', durationMs: 1234, status: 'recovered' }));
    expect(deps.add).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'broken.mov', durationMs: 0, width: null }));
  });

  it('shares one run between concurrent calls (StrictMode double effect)', async () => {
    const { deps, registered } = fakeDeps(['a.mp4']);
    const [x, y] = await Promise.all([recoverOrphanRecordings(deps), recoverOrphanRecordings(deps)]);
    expect([x, y]).toEqual([1, 1]);
    expect(registered).toEqual(['a.mp4']);
    // A later run finds nothing new.
    expect(await recoverOrphanRecordings(deps)).toBe(0);
  });

  it('prefers the complete muxed take over its raw video-only twin', async () => {
    const { deps, registered } = fakeDeps(['take_1.mp4', 'take_1_av.mp4']);
    expect(await recoverOrphanRecordings(deps)).toBe(1);
    expect(registered).toEqual(['take_1_av.mp4']);
  });
});
