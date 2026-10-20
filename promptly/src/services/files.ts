/**
 * Media file management. Recordings are user content and live in the
 * documents directory (never the cache, which the OS may purge). Exports are
 * temporary and live in the cache.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { MIN_FREE_BYTES_TO_RECORD } from '../features/recording/recordingMachine';

export function recordingsDir(): Directory {
  const dir = new Directory(Paths.document, 'recordings');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function exportsDir(): Directory {
  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function recordingFile(fileName: string): File {
  return new File(recordingsDir(), fileName);
}

/**
 * Filesystem path for a new take. The recorder writes straight into the
 * documents directory (not the OS temp dir) so a take survives the app being
 * killed mid-recording and is picked up by orphan recovery on next launch.
 */
export function recordingPathFor(fileName: string): string {
  return toFsPath(recordingFile(fileName).uri);
}

/** The file name when `path` is directly inside the recordings directory, else null. */
export function recordingNameIfInside(path: string): string | null {
  const dir = toFsPath(recordingsDir().uri).replace(/\/+$/, '');
  const p = toFsPath(path);
  if (!p.startsWith(`${dir}/`)) return null;
  const name = p.slice(dir.length + 1);
  return name && !name.includes('/') ? name : null;
}

/** Size in bytes of a file, 0 when it does not exist or cannot be read. */
export function fileSizeAt(path: string): number {
  try {
    const f = new File(toFileUri(path));
    return f.exists ? (f.info().size ?? 0) : 0;
  } catch {
    return 0;
  }
}

/**
 * Scratch location for derived files (the Android audio mux). Kept out of the
 * recordings directory so a half-written output is never mistaken for a take
 * by orphan recovery; moved into place only once complete.
 */
export function scratchFile(fileName: string): File {
  const dir = new Directory(Paths.cache, 'scratch');
  if (!dir.exists) dir.create({ intermediates: true });
  return new File(dir, fileName);
}

/** VisionCamera wants a plain filesystem path, not a file:// URI. */
export function toFsPath(uri: string): string {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri;
}

export function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

export function availableBytes(): number {
  try {
    return Paths.availableDiskSpace;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function hasRoomToRecord(): boolean {
  return availableBytes() >= MIN_FREE_BYTES_TO_RECORD;
}

/**
 * Move a finished take from wherever the recorder wrote it into the
 * recordings directory. Copy-then-delete so a failure never loses the take.
 */
export async function adoptRecording(sourcePath: string, fileName: string): Promise<File> {
  const src = new File(toFileUri(sourcePath));
  const dest = recordingFile(fileName);
  if (src.uri === dest.uri) return dest;
  await src.copy(dest);
  if (dest.exists && (dest.info().size ?? 0) > 0) {
    try {
      src.delete();
    } catch {
      // Leaving a temp copy behind is harmless; losing the take is not.
    }
  }
  return dest;
}

export function deleteRecordingFile(fileName: string): void {
  const f = recordingFile(fileName);
  if (f.exists) f.delete();
}

/**
 * Finds recording files that exist on disk but are unknown to the database
 * (app was killed while finalizing). They are offered for recovery, never
 * deleted automatically.
 */
export function findOrphanRecordings(known: ReadonlySet<string>): File[] {
  return recordingsDir()
    .list()
    .filter((e): e is File => e instanceof File)
    .filter((f) => /\.(mov|mp4)$/i.test(f.name) && !known.has(f.name) && (f.info().size ?? 0) > 0);
}

/** Only disposable export copies are cleaned; recordings are never touched. */
export function cleanExports(olderThanMs: number, now = Date.now()): void {
  for (const entry of exportsDir().list()) {
    if (!(entry instanceof File)) continue;
    const mod = entry.info().modificationTime ?? now;
    if (now - mod > olderThanMs) {
      try {
        entry.delete();
      } catch {
        // ignore
      }
    }
  }
}
