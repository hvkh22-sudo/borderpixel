/* finalizeTake file-safety paths over an in-memory file system. */
import { Platform } from 'react-native';

import { finalizeTake, type FinalizeInput } from '../finalizeTake';


const mockFs = new Map<string, number>(); // uri -> size in bytes
const mockFail = { copy: false, move: false };
const mockRecordings: { id: string; fileName: string; status: string; audioMissing?: boolean }[] = [];
const mockRepoFail = { add: false };
const mockMux = jest.fn<Promise<string>, [string, { uri: string; offsetMs: number }[], string]>();
const mockMuxAvailable = { value: true };
const mockLog = jest.fn();

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid1' }));
jest.mock('expo-file-system', () => {
  const join = (base: string, name: string) => `${base.replace(/\/$/, '')}/${name}`;
  class Directory {
    uri: string;
    constructor(parent: { uri: string } | string, name?: string) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = `${name ? join(base, name) : base.replace(/\/$/, '')}/`;
    }
    exists = true;
    create() {}
    list() {
      return [];
    }
  }
  class File {
    uri: string;
    constructor(parent: { uri: string } | string, name?: string) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = name ? join(base, name) : base;
    }
    get exists() {
      return mockFs.has(this.uri);
    }
    get name() {
      return this.uri.split('/').pop();
    }
    info() {
      return { size: mockFs.get(this.uri) };
    }
    async copy(dest: File) {
      if (mockFail.copy) throw new Error('copy failed');
      mockFs.set(dest.uri, mockFs.get(this.uri) ?? 0);
    }
    async move(dest: File) {
      if (mockFail.move) throw new Error('move failed');
      mockFs.set(dest.uri, mockFs.get(this.uri) ?? 0);
      mockFs.delete(this.uri);
      this.uri = dest.uri;
    }
    delete() {
      mockFs.delete(this.uri);
    }
  }
  return {
    File,
    Directory,
    Paths: { document: new Directory('file:///docs'), cache: new Directory('file:///cache'), availableDiskSpace: 1e10 },
  };
});
jest.mock('../../../services/db', () => ({
  getRepositories: async () => ({
    recordings: {
      list: async () => mockRecordings,
      add: async (r: { id: string; fileName: string; status: string; audioMissing?: boolean }) => {
        if (mockRepoFail.add) throw new Error('db');
        mockRecordings.push(r);
        return r;
      },
    },
  }),
}));
jest.mock('../../../services/diagnosticsLog', () => ({ logDiagnostic: (...a: unknown[]) => mockLog(...a) }));
jest.mock('../../../services/nativeMedia', () => ({
  PromptlyMedia: {
    isAvailable: () => mockMuxAvailable.value,
    muxAudio: (v: string, s: { uri: string; offsetMs: number }[], o: string) => ({ promise: mockMux(v, s, o) }),
  },
}));


const REC = 'file:///docs/recordings';
const base: FinalizeInput = {
  filePath: '/docs/recordings/take_1.mp4',
  scriptId: 's1',
  durationMs: 5000,
  recordingStartedAt: 1_000,
  separateAudio: [],
};
const wav = { uri: '/cache/speech/a0.wav', startedAt: 1_200 };

beforeEach(() => {
  mockFs.clear();
  mockRecordings.length = 0;
  mockFail.copy = false;
  mockFail.move = false;
  mockRepoFail.add = false;
  mockMuxAvailable.value = true;
  mockMux.mockReset();
  mockLog.mockReset();
});

afterEach(() => jest.restoreAllMocks());

describe('finalizeTake', () => {
  it('registers a take recorded straight into the recordings directory in place', async () => {
    mockFs.set(`${REC}/take_1.mp4`, 100);
    const r = await finalizeTake(base);
    expect(r).toEqual({ recordingId: 'uuid1', audioMergeFailed: false });
    expect(mockRecordings).toEqual([expect.objectContaining({ fileName: 'take_1.mp4', status: 'ready' })]);
    expect(mockFs.has(`${REC}/take_1.mp4`)).toBe(true);
  });

  it('copies a file from elsewhere in, then removes the temp copy', async () => {
    mockFs.set('file:///tmp/vc.mov', 100);
    await finalizeTake({ ...base, filePath: '/tmp/vc.mov' });
    expect(mockFs.has(`${REC}/uuid1.mov`)).toBe(true);
    expect(mockFs.has('file:///tmp/vc.mov')).toBe(false);
  });

  it('never deletes the source when copying fails', async () => {
    mockFs.set('file:///tmp/vc.mov', 100);
    mockFail.copy = true;
    await expect(finalizeTake({ ...base, filePath: '/tmp/vc.mov' })).rejects.toThrow();
    expect(mockFs.has('file:///tmp/vc.mov')).toBe(true);
    expect(mockRecordings).toHaveLength(0);
  });

  it('throws (and registers nothing) when the recorder file is missing', async () => {
    await expect(finalizeTake(base)).rejects.toThrow();
    expect(mockRecordings).toHaveLength(0);
  });

  it('keeps the file on disk when the database write fails', async () => {
    mockFs.set(`${REC}/take_1.mp4`, 100);
    mockRepoFail.add = true;
    await expect(finalizeTake(base)).rejects.toThrow();
    expect(mockFs.has(`${REC}/take_1.mp4`)).toBe(true);
  });

  it('registers a salvaged file as recovered, and never twice', async () => {
    mockFs.set(`${REC}/take_1.mp4`, 100);
    mockRecordings.push({ id: 'old', fileName: 'take_1.mp4', status: 'recovered' });
    const r = await finalizeTake({ ...base, status: 'recovered' });
    expect(r.recordingId).toBe('old');
    expect(mockRecordings).toHaveLength(1);
  });

  describe('Android separate audio', () => {
    beforeEach(() => {
      jest.replaceProperty(Platform, 'OS', 'android');
      mockFs.set(`${REC}/take_1.mp4`, 100);
      mockFs.set('file:///cache/speech/a0.wav', 50);
    });

    it('muxes via scratch, moves into place, then cleans the raw video and WAVs', async () => {
      mockMux.mockImplementation(async (_v, segs, out) => {
        // Nothing half-written may appear in the recordings directory during the mux.
        expect(out.startsWith('file:///cache/')).toBe(true);
        expect(segs).toEqual([{ uri: 'file:///cache/speech/a0.wav', offsetMs: 200 }]);
        mockFs.set(out, 150);
        return out;
      });
      const r = await finalizeTake({ ...base, separateAudio: [wav], expectSeparateAudio: true });
      expect(r.audioMergeFailed).toBe(false);
      expect(mockRecordings[0]?.fileName).toBe('take_1_av.mp4');
      expect(mockFs.has(`${REC}/take_1_av.mp4`)).toBe(true);
      expect(mockFs.has(`${REC}/take_1.mp4`)).toBe(false);
      expect(mockFs.has('file:///cache/speech/a0.wav')).toBe(false);
    });

    it('on mux failure keeps the video and preserves the audio next to it', async () => {
      mockMux.mockRejectedValue(new Error('mux'));
      const r = await finalizeTake({ ...base, separateAudio: [wav], expectSeparateAudio: true });
      expect(r.audioMergeFailed).toBe(true);
      expect(mockRecordings[0]?.fileName).toBe('take_1.mp4');
      expect(mockFs.has(`${REC}/take_1.mp4`)).toBe(true);
      expect(mockFs.get(`${REC}/take_1_audio_0.wav`)).toBe(50);
      // Stored on the row, so the take still says "no sound" when reopened from the library.
      expect(mockRecordings[0]?.audioMissing).toBe(true);
    });

    it('treats an empty mux output or a failed move as a merge failure without losing anything', async () => {
      mockMux.mockImplementation(async (_v, _s, out) => {
        mockFs.set(out, 150);
        return out;
      });
      mockFail.move = true;
      const r = await finalizeTake({ ...base, separateAudio: [wav], expectSeparateAudio: true });
      expect(r.audioMergeFailed).toBe(true);
      expect(mockFs.has(`${REC}/take_1.mp4`)).toBe(true);
      expect(mockFs.has(`${REC}/take_1_audio_0.wav`)).toBe(true);
    });

    it('flags a video-only take when no audio was captured at all', async () => {
      const r = await finalizeTake({ ...base, separateAudio: [], expectSeparateAudio: true });
      expect(r.audioMergeFailed).toBe(true);
      expect(mockRecordings[0]?.fileName).toBe('take_1.mp4');
    });

    it('flags the merge as failed when the native module is missing', async () => {
      mockMuxAvailable.value = false;
      const r = await finalizeTake({ ...base, separateAudio: [wav], expectSeparateAudio: true });
      expect(r.audioMergeFailed).toBe(true);
      expect(mockFs.has(`${REC}/take_1_audio_0.wav`)).toBe(true);
    });
  });

  describe('iOS separate audio (iosVoiceFollowAudio = separate)', () => {
    const iosWav = { uri: 'file:///cache/speech/recording_A.wav', startedAt: 800 };
    beforeEach(() => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      mockFs.set(`${REC}/take_1.mp4`, 100);
      mockFs.set(iosWav.uri, 50);
    });

    it('muxes the recognizer WAV (negative offset when audio started first) and cleans up', async () => {
      mockMux.mockImplementation(async (v, segs, out) => {
        expect(v).toBe(`${REC}/take_1.mp4`);
        expect(out).toBe('file:///cache/scratch/take_1_av.mp4');
        // Audio began 200 ms before the recorder reported start: native trims the WAV head.
        expect(segs).toEqual([{ uri: iosWav.uri, offsetMs: -200 }]);
        mockFs.set(out, 150);
        return out;
      });
      const r = await finalizeTake({ ...base, separateAudio: [iosWav], expectSeparateAudio: true });
      expect(r.audioMergeFailed).toBe(false);
      expect(mockRecordings[0]?.fileName).toBe('take_1_av.mp4');
      expect(mockFs.has(`${REC}/take_1.mp4`)).toBe(false);
      expect(mockFs.has(iosWav.uri)).toBe(false);
      expect(mockLog).not.toHaveBeenCalled();
    });

    it('on mux failure keeps the video-only take and the WAV, and logs a code', async () => {
      mockMux.mockRejectedValue(new Error('ExportFailed: /var/mobile/x.wav unreadable'));
      const r = await finalizeTake({ ...base, separateAudio: [iosWav], expectSeparateAudio: true });
      expect(r.audioMergeFailed).toBe(true);
      expect(mockRecordings[0]?.fileName).toBe('take_1.mp4');
      expect(mockFs.get(`${REC}/take_1_audio_0.wav`)).toBe(50);
      expect(mockLog).toHaveBeenCalledWith('mux', 'mux_failed_ios', expect.any(Error));
    });

    it('logs when a separate-audio take produced no audio segments', async () => {
      const r = await finalizeTake({ ...base, separateAudio: [], expectSeparateAudio: true });
      expect(r.audioMergeFailed).toBe(true);
      expect(mockMux).not.toHaveBeenCalled();
      expect(mockLog).toHaveBeenCalledWith('mux', 'no_audio_segments');
    });

    it('shared strategy (camera audio): nothing to mux', async () => {
      const r = await finalizeTake(base);
      expect(r.audioMergeFailed).toBe(false);
      expect(mockMux).not.toHaveBeenCalled();
      expect(mockRecordings[0]?.fileName).toBe('take_1.mp4');
    });
  });
});
