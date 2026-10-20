/**
 * Turns a finished recorder file into a saved take. Order matters for
 * safety: the raw file is first moved into permanent storage, then (Android
 * Voice Follow) muxed with the separately captured audio into a new file;
 * the video-only original is kept until the mux succeeded.
 */
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { getRepositories } from '../../services/db';
import { adoptRecording, recordingFile, toFileUri } from '../../services/files';
import { PromptlyMedia } from '../../services/nativeMedia';
import type { PersistedAudio } from '../voice-follow/voiceFollowController';

export interface FinalizeInput {
  filePath: string;
  scriptId: string | null;
  durationMs: number;
  /** Epoch ms when the recorder reported start (for audio alignment). */
  recordingStartedAt: number;
  /** Android Voice Follow: audio captured by the recognizer. */
  separateAudio: PersistedAudio[];
}

export interface FinalizeResult {
  recordingId: string;
  /** True when separately captured audio could not be merged (video kept, no audio). */
  audioMergeFailed: boolean;
}

export async function finalizeTake(input: FinalizeInput): Promise<FinalizeResult> {
  const id = randomUUID();
  const ext = input.filePath.toLowerCase().endsWith('.mp4') ? 'mp4' : 'mov';
  const rawName = `${id}.${ext}`;
  const raw = await adoptRecording(input.filePath, rawName);
  let fileName = rawName;
  let audioMergeFailed = false;

  if (Platform.OS === 'android' && input.separateAudio.length > 0) {
    if (PromptlyMedia.isAvailable()) {
      const muxedName = `${id}_av.mp4`;
      try {
        const out = recordingFile(muxedName);
        await PromptlyMedia.muxAudio(
          raw.uri,
          input.separateAudio.map((a) => ({ uri: toFileUri(a.uri), offsetMs: a.startedAt - input.recordingStartedAt })),
          out.uri,
        ).promise;
        if (out.exists && (out.info().size ?? 0) > 0) {
          fileName = muxedName;
          raw.delete();
          for (const a of input.separateAudio) {
            const f = new File(toFileUri(a.uri));
            if (f.exists) f.delete();
          }
        } else {
          audioMergeFailed = true;
        }
      } catch {
        audioMergeFailed = true;
      }
    } else {
      audioMergeFailed = true;
    }
  }

  if (audioMergeFailed) {
    // Never lose the speaker's audio: keep it next to the video for a later retry.
    await Promise.all(
      input.separateAudio.map(async (a, i) => {
        const src = new File(toFileUri(a.uri));
        if (src.exists) await src.copy(recordingFile(`${id}_audio_${i}.wav`));
      }),
    );
  }

  const repos = await getRepositories();
  await repos.recordings.add({
    id,
    scriptId: input.scriptId,
    fileName,
    durationMs: input.durationMs,
    width: null,
    height: null,
    status: 'ready',
  });
  return { recordingId: id, audioMergeFailed };
}
