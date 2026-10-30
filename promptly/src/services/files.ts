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

/**
 * True when `name` is a kept separate-audio sidecar of the take stored as `takeFileName`
 * (`X.mp4` -> `X_audio_0.wav`, written by finalizeTake when the mux fails). Exact match on
 * the take's stem, so another take's files never match.
 */
export function isAudioSidecarOf(takeFileName: string, name: string): boolean {
  const stem = takeFileName.replace(/\.(mov|mp4)$/i, '');
  if (stem === takeFileName || !name.startsWith(`${stem}_audio_`)) return false;
  return /^\d+\.wav$/i.test(name.slice(stem.length + '_audio_'.length));
}

/**
 * User-initiated delete of a take: the video, then its kept audio sidecars. The video goes
 * first (and throws on failure) so a failed delete never strips the audio of a surviving take.
 */
export function deleteRecordingFile(fileName: string): void {
  const f = recordingFile(fileName);
  if (f.exists) f.delete();
  // A muxed take `X_av.mp4` may still have its video-only original `X.mp4` (app killed between the
  // move and the cleanup) and the kept WAVs `X_audio_N.wav`: they belong to this take too, or the
  // original would be recovered as a new take on the next launch.
  const original = /_av\.mp4$/i.test(fileName) ? fileName.replace(/_av\.mp4$/i, '') : null;
  for (const entry of recordingsDir().list()) {
    if (!(entry instanceof File)) continue;
    const isOriginal = original != null && (entry.name === `${original}.mp4` || entry.name === `${original}.mov`);
    if (!isOriginal && !isAudioSidecarOf(fileName, entry.name) && !(original && isAudioSidecarOf(`${original}.mp4`, entry.name))) continue;
    try {
      entry.delete();
    } catch {
      // A leftover sidecar is harmless: orphan recovery only registers videos.
    }
  }
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

/**
 * "Delete all my data" (user-initiated): every file the app keeps — recordings and their sidecars,
 * export copies, scratch files and imported-backup copies. Best effort per file; returns how many
 * could not be deleted.
 */
export function wipeLocalFiles(): number {
  let failed = 0;
  const dirs = [recordingsDir(), exportsDir(), new Directory(Paths.cache, 'scratch'), new Directory(Paths.cache, 'DocumentPicker')];
  for (const dir of dirs) {
    if (!dir.exists) continue;
    for (const entry of dir.list()) {
      try {
        entry.delete();
      } catch {
        failed++;
      }
    }
  }
  return failed;
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
