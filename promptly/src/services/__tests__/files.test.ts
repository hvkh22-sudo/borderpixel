/* Take deletion removes the take's kept audio sidecars and nothing else. */
import { deleteRecordingFile, findOrphanRecordings, isAudioSidecarOf } from '../files';

const mockFs = new Map<string, number>(); // uri -> size

jest.mock('expo-file-system', () => {
  const join = (base: string, name: string) => `${base.replace(/\/$/, '')}/${name}`;
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
      return this.uri.split('/').pop() ?? '';
    }
    info() {
      return { size: mockFs.get(this.uri) };
    }
    delete() {
      mockFs.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(parent: { uri: string } | string, name?: string) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = `${name ? join(base, name) : base.replace(/\/$/, '')}/`;
    }
    exists = true;
    create() {}
    list() {
      return [...mockFs.keys()]
        .filter((u) => u.startsWith(this.uri) && !u.slice(this.uri.length).includes('/'))
        .map((u) => new File(u));
    }
  }
  return { File, Directory, Paths: { document: new Directory('file:///docs'), cache: new Directory('file:///cache') } };
});
jest.mock('../../features/recording/recordingMachine', () => ({ MIN_FREE_BYTES_TO_RECORD: 0 }));

const dir = 'file:///docs/recordings/';
const names = () => [...mockFs.keys()].map((u) => u.slice(dir.length)).sort();

beforeEach(() => {
  mockFs.clear();
});

test('isAudioSidecarOf matches only the exact take stem', () => {
  expect(isAudioSidecarOf('take_1.mp4', 'take_1_audio_0.wav')).toBe(true);
  expect(isAudioSidecarOf('take_1.mov', 'take_1_audio_12.wav')).toBe(true);
  expect(isAudioSidecarOf('take_1.mp4', 'take_10_audio_0.wav')).toBe(false);
  expect(isAudioSidecarOf('take_1.mp4', 'take_1_av.mp4')).toBe(false);
  expect(isAudioSidecarOf('take_1.mp4', 'take_1_audio_x.wav')).toBe(false);
  expect(isAudioSidecarOf('take_1.mp4', 'take_1_audio_0.wav.bak')).toBe(false);
  expect(isAudioSidecarOf('take_1', 'take_1_audio_0.wav')).toBe(false);
});

test('deleting a take removes its sidecar WAVs and leaves other takes untouched', () => {
  for (const n of [
    'take_1.mp4',
    'take_1_audio_0.wav',
    'take_1_audio_1.wav',
    'take_10.mp4',
    'take_10_audio_0.wav',
    'take_2.mp4',
    'take_2_audio_0.wav',
  ]) {
    mockFs.set(dir + n, 100);
  }
  deleteRecordingFile('take_1.mp4');
  expect(names()).toEqual(['take_10.mp4', 'take_10_audio_0.wav', 'take_2.mp4', 'take_2_audio_0.wav']);
});

test('orphan recovery never sees sidecar WAVs, before or after a delete', () => {
  mockFs.set(dir + 'take_1_audio_0.wav', 100);
  mockFs.set(dir + 'take_2.mp4', 100);
  mockFs.set(dir + 'take_2_audio_0.wav', 100);
  expect(findOrphanRecordings(new Set()).map((f) => f.name)).toEqual(['take_2.mp4']);
  deleteRecordingFile('take_2.mp4');
  expect(findOrphanRecordings(new Set())).toEqual([]);
  expect(names()).toEqual(['take_1_audio_0.wav']);
});

test('deleting a muxed take also removes its leftover original and WAVs, nothing else', () => {
  for (const n of ['take_3_av.mp4', 'take_3.mp4', 'take_3_audio_0.wav', 'take_30.mp4', 'take_3_x.mp4']) mockFs.set(dir + n, 100);
  deleteRecordingFile('take_3_av.mp4');
  expect(names()).toEqual(['take_30.mp4', 'take_3_x.mp4']);
  // The original no longer comes back as a "recovered" take.
  expect(findOrphanRecordings(new Set(['take_30.mp4', 'take_3_x.mp4']))).toEqual([]);
});
