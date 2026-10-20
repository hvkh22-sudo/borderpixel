/**
 * React binding for RecordingSession with the production dependencies
 * (VisionCamera recorder, finalizeTake, documents-dir file paths). The
 * session outlives re-renders; on unmount it is disposed, which stops a
 * running take so the file is finalized, and silences UI callbacks.
 */
import { randomUUID } from 'expo-crypto';
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { CameraVideoOutput } from 'react-native-vision-camera';

import { availableBytes, fileSizeAt, recordingPathFor } from '../../services/files';
import { finalizeTake } from './finalizeTake';
import type { RecordingState } from './recordingMachine';
import { RecordingSession, type RecordingSessionDeps } from './recordingSession';

export type RecordingSessionCallbacks = Pick<
  RecordingSessionDeps,
  'onRecordingStarted' | 'onVoiceFollowStarted' | 'onTakeSaved' | 'onTakeCompleted' | 'onFailure'
>;

function productionDeps(videoOutput: CameraVideoOutput, callbacks: RecordingSessionCallbacks): RecordingSessionDeps {
  return {
    createRecorder: (settings) => videoOutput.createRecorder(settings),
    finalize: finalizeTake,
    // mp4 on both platforms (Android always writes mp4; iOS output is configured with fileType 'mp4').
    newRecordingPath: () => recordingPathFor(`take_${randomUUID()}.mp4`),
    availableBytes,
    fileSize: fileSizeAt,
    now: Date.now,
    log: __DEV__ ? (m, e) => console.warn(`[recording] ${m}`, e ?? '') : undefined,
    ...callbacks,
  };
}

export function useRecordingSession(
  videoOutput: CameraVideoOutput,
  callbacks: RecordingSessionCallbacks,
): { session: RecordingSession; state: RecordingState } {
  const [session] = useState(() => new RecordingSession(productionDeps(videoOutput, callbacks)));
  // Latest callbacks and output for the next take; an in-flight take keeps its own options.
  useLayoutEffect(() => {
    session.configure(productionDeps(videoOutput, callbacks));
  });

  useEffect(() => {
    session.attach();
    return () => session.dispose();
  }, [session]);

  const state = useSyncExternalStore(session.subscribe, session.getState);
  return { session, state };
}
