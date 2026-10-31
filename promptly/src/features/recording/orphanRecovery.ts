/**
 * Registers recording files that exist in the documents directory but are
 * unknown to the database (app killed while recording or finalizing). Files
 * are never deleted here — the user decides.
 *
 * Duplicate safety:
 * - single-flight: concurrent calls (React StrictMode runs effects twice,
 *   a remounted root) share one run;
 * - names are re-checked against what this run already registered;
 * - when a raw take `X.mp4` and its muxed `X_av.mp4` are both orphaned (killed
 *   between moving the mux into place and deleting the raw file), only the
 *   muxed one — the complete take with audio — is registered. A muxed file
 *   only ever appears in the recordings directory once complete (see
 *   finalizeTake), so it is never a partial write.
 */
import type { RecordingStatusRow } from '../../storage/repositories';

export interface OrphanFile {
  name: string;
  uri: string;
}

export interface OrphanVideoInfo {
  durationMs: number;
  width: number;
  height: number;
  /** False for a video-only file (a Voice Follow take killed before its audio was merged). */
  hasAudio?: boolean;
}

export interface OrphanRecoveryDeps {
  knownFileNames(): Promise<ReadonlySet<string>>;
  findOrphans(known: ReadonlySet<string>): OrphanFile[];
  /** Best effort; null when the file cannot be read (e.g. cut off mid-write). */
  videoInfo(uri: string): Promise<OrphanVideoInfo | null>;
  add(rec: {
    scriptId: null;
    fileName: string;
    durationMs: number;
    width: number | null;
    height: number | null;
    status: RecordingStatusRow;
    audioMissing?: boolean;
  }): Promise<unknown>;
}

/**
 * Takes currently being recorded or finalized in this process, by file stem
 * (`take_X` covers `take_X.mp4`, `take_X_av.mp4`, `take_X_audio_0.wav`). Recovery
 * runs after first paint and may overlap a live take; those files are not orphans.
 */
const activeStems = new Map<string, number>();

const stemOf = (pathOrName: string) => (pathOrName.split('/').pop() ?? pathOrName).replace(/\.[^.]+$/, '');

/** Marks a take's file as in progress; call the returned function once it is registered or abandoned. */
export function markRecordingActive(pathOrName: string): () => void {
  const stem = stemOf(pathOrName);
  activeStems.set(stem, (activeStems.get(stem) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (activeStems.get(stem) ?? 1) - 1;
    if (n > 0) activeStems.set(stem, n);
    else activeStems.delete(stem);
  };
}

const belongsTo = (name: string, stems: Iterable<string>) => {
  for (const stem of stems) if (name === stem || name.startsWith(`${stem}.`) || name.startsWith(`${stem}_`)) return true;
  return false;
};

export function isRecordingActive(name: string): boolean {
  return belongsTo(name, activeStems.keys());
}

let inFlight: Promise<number> | null = null;

export function recoverOrphanRecordings(deps: OrphanRecoveryDeps): Promise<number> {
  if (!inFlight) {
    inFlight = run(deps).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function run(deps: OrphanRecoveryDeps): Promise<number> {
  // Taken before the DB read: a take that is registered and released while the names
  // are being read is still skipped.
  const activeBefore = [...activeStems.keys()];
  const known = new Set(await deps.knownFileNames());
  const orphans = deps.findOrphans(known);
  const names = new Set(orphans.map((o) => o.name));
  let recovered = 0;
  for (const f of orphans) {
    if (known.has(f.name) || belongsTo(f.name, activeBefore) || isRecordingActive(f.name)) continue;
    const muxed = f.name.replace(/\.(mov|mp4)$/i, '_av.mp4');
    if (muxed !== f.name && (names.has(muxed) || known.has(muxed))) continue;
    // Register even unreadable files so the user decides what to do with them.
    const info = await deps.videoInfo(f.uri).catch(() => null);
    if (isRecordingActive(f.name)) continue;
    await deps.add({
      scriptId: null,
      fileName: f.name,
      durationMs: Math.round(info?.durationMs ?? 0),
      width: info?.width ?? null,
      height: info?.height ?? null,
      status: 'recovered',
      // A Voice Follow take killed before its audio was merged is video-only: say so on the take
      // instead of presenting a silent video as a normal recording.
      audioMissing: info?.hasAudio === false ? true : undefined,
    });
    known.add(f.name);
    recovered++;
  }
  return recovered;
}
