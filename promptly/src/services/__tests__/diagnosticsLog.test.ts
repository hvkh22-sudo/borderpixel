import { createDiagnosticsLog, sanitizeMessage, type DiagnosticsEntry } from '../diagnosticsLog';

jest.mock('../db', () => ({ getRepositories: () => Promise.reject(new Error('no db in this test')) }));

function memoryStorage(initial: unknown = []) {
  const store = { value: initial as unknown, saves: 0 };
  return {
    store,
    storage: {
      load: async () => store.value,
      save: async (e: DiagnosticsEntry[]) => {
        store.saves++;
        store.value = e;
      },
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('diagnosticsLog', () => {
  it('keeps only the newest entries (ring buffer)', async () => {
    let now = 0;
    const { storage } = memoryStorage();
    const log = createDiagnosticsLog(storage, { now: () => ++now, max: 3 });
    for (const code of ['a', 'b', 'c', 'd', 'e']) log.record('recording', code);
    expect(log.entries().map((e) => e.code)).toEqual(['c', 'd', 'e']);
  });

  it('stores codes and sanitized messages only', () => {
    const { storage } = memoryStorage();
    const log = createDiagnosticsLog(storage, { now: () => 1 });
    log.record('export', 'video_share', new Error('Export failed for file:///var/mobile/Containers/abc/take_1.mp4 (code -11800)'));
    log.record('mux', 'mux_failed_ios', new Error('open /private/var/mobile/x.wav failed'));
    log.record('speech', 'network', 'network');
    log.record('recording', 'write_failed', { not: 'an error' });
    const [a, b, c, d] = log.entries();
    expect(a).toEqual({ at: 1, source: 'export', code: 'video_share', message: 'Export failed for <path> (code -11800)' });
    expect(b?.message).toBe('open <path> failed');
    // A message equal to the code adds nothing.
    expect(c?.message).toBeUndefined();
    expect(d).toEqual({ at: 1, source: 'recording', code: 'write_failed' });
  });

  it('strips file names and paths in every form the platforms report them', () => {
    const leaks = [
      ['The file “take_9f.mp4” couldn’t be opened', 'take_9f'],
      ['Cannot open “/var/mobile/Containers/Data/take_1.mp4”', 'take_1'],
      ['bad uri file:/data/user/0/app/files/recordings/take_2.mp4', 'take_2'],
      ['[/storage/emulated/0/Movies/Holiday with Dana.mp4]', 'Dana'],
      ['write failed path=/data/My Script.json', 'Script'],
      ['NSFilePath=/private/var/Provider Storage/Dana resume.json', 'resume'],
      ["error opening 'Dana notes.wav'", 'Dana'],
    ] as const;
    for (const [raw, secret] of leaks) expect(sanitizeMessage(raw)).not.toContain(secret);
    // Ordinary error text stays readable.
    expect(sanitizeMessage('Export failed (code -11800): The operation could not be completed')).toBe('Export failed (code -11800): The operation could not be completed');
  });

  it('caps message length', () => {
    expect(sanitizeMessage('x'.repeat(500))).toHaveLength(160);
  });

  it('never throws, even when storage fails', async () => {
    const log = createDiagnosticsLog({ load: () => Promise.reject(new Error('io')), save: () => Promise.reject(new Error('io')) });
    expect(() => log.record('transcription', 'no_speech')).not.toThrow();
    await flush();
    expect(log.entries()).toHaveLength(1);
  });

  it('merges entries from earlier launches before saving, so they are not overwritten', async () => {
    const earlier: DiagnosticsEntry[] = [{ at: 5, source: 'recording', code: 'recorder_error' }];
    const { storage, store } = memoryStorage([...earlier, { junk: true }]);
    const log = createDiagnosticsLog(storage, { now: () => 10 });
    log.record('speech', 'audio-capture');
    await log.load();
    await flush();
    expect(log.entries().map((e) => e.code)).toEqual(['recorder_error', 'audio-capture']);
    expect((store.value as DiagnosticsEntry[]).map((e) => e.code)).toEqual(['recorder_error', 'audio-capture']);
  });

  it('clear() empties memory and storage', async () => {
    const { storage, store } = memoryStorage([{ at: 1, source: 'mux', code: 'x' }]);
    const log = createDiagnosticsLog(storage);
    await log.clear();
    expect(log.entries()).toEqual([]);
    expect(store.value).toEqual([]);
  });
});
