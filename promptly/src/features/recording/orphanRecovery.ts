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
  }): Promise<unknown>;
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
  const known = new Set(await deps.knownFileNames());
  const orphans = deps.findOrphans(known);
  const names = new Set(orphans.map((o) => o.name));
  let recovered = 0;
  for (const f of orphans) {
    if (known.has(f.name)) continue;
    const muxed = f.name.replace(/\.(mov|mp4)$/i, '_av.mp4');
    if (muxed !== f.name && (names.has(muxed) || known.has(muxed))) continue;
    // Register even unreadable files so the user decides what to do with them.
    const info = await deps.videoInfo(f.uri).catch(() => null);
    await deps.add({
      scriptId: null,
      fileName: f.name,
      durationMs: Math.round(info?.durationMs ?? 0),
      width: info?.width ?? null,
      height: info?.height ?? null,
      status: 'recovered',
    });
    known.add(f.name);
    recovered++;
  }
  return recovered;
}
