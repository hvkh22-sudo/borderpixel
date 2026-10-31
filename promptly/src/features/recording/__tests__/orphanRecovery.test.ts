import { isRecordingActive, markRecordingActive, recoverOrphanRecordings, type OrphanFile, type OrphanRecoveryDeps } from '../orphanRecovery';

function fakeDeps(files: string[], known: string[] = []) {
  const registered: string[] = [...known];
  const deps: OrphanRecoveryDeps = {
    knownFileNames: async () => new Set(registered),
    findOrphans: (k) => files.filter((f) => !k.has(f)).map((name): OrphanFile => ({ name, uri: `file:///docs/recordings/${name}` })),
    videoInfo: async (uri) =>
      uri.includes('broken') ? Promise.reject(new Error('unreadable')) : { durationMs: 1234.4, width: 1080, height: 1920, hasAudio: !uri.includes('silent') },
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

  it('flags a recovered video-only take (Voice Follow killed before the audio merge) as missing audio', async () => {
    const { deps } = fakeDeps(['silent.mp4', 'a.mp4']);
    await recoverOrphanRecordings(deps);
    expect(deps.add).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'silent.mp4', audioMissing: true }));
    expect(deps.add).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'a.mp4', audioMissing: undefined }));
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

  it('never registers the files of a take that is still being recorded or finalized', async () => {
    const release = markRecordingActive('/docs/recordings/take_live.mp4');
    expect(isRecordingActive('take_live.mp4')).toBe(true);
    expect(isRecordingActive('take_live_av.mp4')).toBe(true);
    expect(isRecordingActive('take_other.mp4')).toBe(false);
    const { deps, registered } = fakeDeps(['take_live.mp4', 'take_live_av.mp4', 'old.mp4']);
    expect(await recoverOrphanRecordings(deps)).toBe(1);
    expect(registered).toEqual(['old.mp4']);
    release();
    expect(isRecordingActive('take_live.mp4')).toBe(false);
  });

  it('skips a take that finished (and was registered) while the known names were being read', async () => {
    const release = markRecordingActive('file:///docs/recordings/take_fast.mp4');
    const { deps, registered } = fakeDeps(['take_fast.mp4']);
    const read = deps.knownFileNames;
    // The take is finalized and released after the DB snapshot was taken.
    deps.knownFileNames = async () => {
      const k = await read();
      release();
      return k;
    };
    expect(await recoverOrphanRecordings(deps)).toBe(0);
    expect(registered).toEqual([]);
  });
});
