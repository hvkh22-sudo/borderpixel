/**
 * Turns a finished recorder file into a saved take. Order matters for
 * safety: the raw file is first in permanent storage (the recorder writes
 * there directly; files from elsewhere are copied in), then (Voice Follow with
 * separate audio: Android, or iOS with the 'separate' strategy) muxed with the separately captured audio into a scratch file that
 * is moved into place only when complete; the video-only original is kept
 * until the muxed file is in place. No failure path deletes the only copy of
 * the video or the speaker's audio.
 */
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { getRepositories } from '../../services/db';
import { logDiagnostic } from '../../services/diagnosticsLog';
import { adoptRecording, recordingFile, recordingNameIfInside, scratchFile, toFileUri } from '../../services/files';
import { PromptlyMedia } from '../../services/nativeMedia';
import type { RecordingStatusRow } from '../../storage/repositories';
import type { PersistedAudio } from '../voice-follow/voiceFollowController';
import { markRecordingActive } from './orphanRecovery';

export interface FinalizeInput {
  filePath: string;
  scriptId: string | null;
  durationMs: number;
  /** Epoch ms when the recorder reported start (for audio alignment). */
  recordingStartedAt: number;
  /** Voice Follow with separate audio (Android; iOS 'separate'): audio captured by the recognizer. */
  separateAudio: PersistedAudio[];
  /**
   * The camera recorded video only (Voice Follow with separate audio). With no audio
   * segments the take is still saved, but flagged so the user is told.
   */
  expectSeparateAudio?: boolean;
  /** 'recovered' for a file salvaged after a recorder error (may be truncated). */
  status?: RecordingStatusRow;
}

export interface FinalizeResult {
  recordingId: string;
  /** True when separately captured audio could not be merged (video kept, no audio). */
  audioMergeFailed: boolean;
}

const exists = (f: File) => f.exists && (f.info().size ?? 0) > 0;

export async function finalizeTake(input: FinalizeInput): Promise<FinalizeResult> {
  const id = randomUUID();
  const inPlace = recordingNameIfInside(input.filePath);
  const ext = input.filePath.toLowerCase().endsWith('.mp4') ? 'mp4' : 'mov';
  const rawName = inPlace ?? `${id}.${ext}`;
  // Orphan recovery may run meanwhile; it must not register this take's files.
  const release = markRecordingActive(rawName);
  try {
    return await finalizeNamed(input, id, inPlace, rawName);
  } finally {
    release();
  }
}

async function finalizeNamed(input: FinalizeInput, id: string, inPlace: string | null, rawName: string): Promise<FinalizeResult> {
  const raw = inPlace ? recordingFile(inPlace) : await adoptRecording(input.filePath, rawName);
  if (!exists(raw)) throw new Error('recording file missing after adopt');
  const base = rawName.replace(/\.(mov|mp4)$/i, '');
  let fileName = rawName;
  let audioMergeFailed = Boolean(input.expectSeparateAudio) && input.separateAudio.length === 0;

  if (input.expectSeparateAudio && input.separateAudio.length === 0) logDiagnostic('mux', 'no_audio_segments');
  // Android Voice Follow, and iOS with the 'separate' audio strategy (DECISIONS D4).
  if (input.separateAudio.length > 0) {
    if (PromptlyMedia.isAvailable()) {
      const muxedName = `${base}_av.mp4`;
      try {
        // Muxed into scratch first: a half-written output must never sit in the recordings
        // directory, where orphan recovery would register it next to the raw take.
        const tmp = scratchFile(muxedName);
        if (tmp.exists) tmp.delete();
        await PromptlyMedia.muxAudio(
          raw.uri,
          input.separateAudio.map((a) => ({ uri: toFileUri(a.uri), offsetMs: a.startedAt - input.recordingStartedAt })),
          tmp.uri,
        ).promise;
        if (!exists(tmp)) throw new Error('mux produced no output');
        const dest = recordingFile(muxedName);
        await tmp.move(dest);
        if (!exists(dest)) throw new Error('muxed file missing after move');
        fileName = muxedName;
        // Only now is the muxed take safe; the video-only original and the WAVs can go.
        raw.delete();
        for (const a of input.separateAudio) deleteQuietly(new File(toFileUri(a.uri)));
      } catch (e) {
        logDiagnostic('mux', `mux_failed_${Platform.OS}`, e);
        audioMergeFailed = true;
      }
    } else {
      logDiagnostic('mux', 'media_module_missing');
      audioMergeFailed = true;
    }
  }

  if (audioMergeFailed && input.separateAudio.length > 0) {
    // Never lose the speaker's audio: keep it next to the video for a later retry.
    await Promise.all(
      input.separateAudio.map(async (a, i) => {
        const src = new File(toFileUri(a.uri));
        if (!src.exists) return;
        const dest = recordingFile(`${base}_audio_${i}.wav`);
        if (dest.exists) return;
        await src.copy(dest);
        // The recognizer writes to a cache location; drop it once the documents copy is verified.
        if (exists(dest)) deleteQuietly(src);
      }),
    );
  }

  const repos = await getRepositories();
  // Idempotent: a take that was already registered (e.g. salvaged after a stop timeout and
  // then reported finished) is never added twice.
  const existing = (await repos.recordings.list()).find((r) => r.fileName === fileName);
  if (existing) return { recordingId: existing.id, audioMergeFailed };
  await repos.recordings.add({
    id,
    scriptId: input.scriptId,
    fileName,
    durationMs: input.durationMs,
    width: null,
    height: null,
    status: input.status ?? 'ready',
  });
  return { recordingId: id, audioMergeFailed };
}

function deleteQuietly(f: File): void {
  try {
    if (f.exists) f.delete();
  } catch {
    // A leftover temp file is harmless.
  }
}
