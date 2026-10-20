/**
 * Camera + live teleprompter. The prompter is a normal React Native view
 * layered above the camera preview; the recorder encodes frames from the
 * capture pipeline, so the overlay is not part of the file. This must be
 * verified on each platform (test REC-02 in docs/testing/test-plan.md).
 */
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Camera,
  CommonResolutions,
  useCameraPermission,
  useMicrophonePermission,
  useVideoOutput,
  type Recorder,
} from 'react-native-vision-camera';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Text } from '../../components/Text';
import { checkFeature } from '../../features/monetization/entitlements';
import { finalizeTake } from '../../features/recording/finalizeTake';
import { INITIAL_RECORDING_STATE, isBusy, recordingReducer, remainingRecordSeconds } from '../../features/recording/recordingMachine';
import { clampWpm } from '../../features/teleprompter/scrollModel';
import { Teleprompter, type TeleprompterHandle } from '../../features/teleprompter/Teleprompter';
import { useVoiceFollow } from '../../features/voice-follow/useVoiceFollow';
import { USAGE_VF_KEY } from '../../hooks/useBootstrap';
import { formatClock, t } from '../../localization/i18n';
import { track } from '../../services/analytics';
import { getRepositories } from '../../services/db';
import { availableBytes, hasRoomToRecord } from '../../services/files';
import { useAccess } from '../../state/access';
import { useSettings, type ScrollMode } from '../../state/settings';
import { palette, radius, spacing } from '../../theme/tokens';

export default function RecordScreen() {
  useKeepAwake();
  const { id, mode: modeParam } = useLocalSearchParams<{ id: string; mode?: ScrollMode }>();
  const prompter = useSettings((s) => s.prompter);
  const cameraSettings = useSettings((s) => s.camera);
  const speechLocale = useSettings((s) => s.speechLocale);
  const access = useAccess((s) => s.access);
  const usage = useAccess((s) => s.usage);

  const [script, setScript] = useState<string | null>(null);
  const [state, dispatch] = useReducer(recordingReducer, INITIAL_RECORDING_STATE);
  const [position, setPosition] = useState(cameraSettings.position);
  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [wpm, setWpm] = useState(prompter.wpm);
  const [notice, setNotice] = useState<string | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');

  const mode: ScrollMode = modeParam ?? prompter.mode;
  const voice = mode === 'voice';
  // Android: the recognizer owns the microphone; camera records video only and
  // audio is muxed afterwards (docs/architecture/technical-feasibility.md).
  const separateAudio = voice && Platform.OS === 'android';

  const camPerm = useCameraPermission();
  const micPerm = useMicrophonePermission();
  const videoOutput = useVideoOutput({
    targetResolution: cameraSettings.resolution === '720p' ? CommonResolutions.HD_16_9 : CommonResolutions.FHD_16_9,
    enableAudio: !separateAudio,
    fileType: 'mp4',
  });

  const recorderRef = useRef<Recorder | null>(null);
  const startedAtRef = useRef(0);
  const prompterRef = useRef<TeleprompterHandle>(null);
  const vf = useVoiceFollow(script ?? '');

  useEffect(() => {
    void getRepositories().then(async (r) => setScript((await r.scripts.get(id))?.body ?? ''));
  }, [id]);

  useEffect(() => {
    if (camPerm.hasPermission && micPerm.hasPermission) dispatch({ type: 'PREPARE' });
  }, [camPerm.hasPermission, micPerm.hasPermission]);

  // Recording timer (1 Hz is enough for the label; no per-frame renders).
  useEffect(() => {
    if (state.status !== 'recording') return;
    const iv = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 500);
    return () => clearInterval(iv);
  }, [state.status]);

  const finishRecording = useCallback(
    async (filePath: string) => {
      dispatch({ type: 'RECORDING_FINISHED', filePath, at: Date.now() });
      setPlaying(false);
      const audio = voice ? await vf.stop() : [];
      try {
        const result = await finalizeTake({
          filePath,
          scriptId: id,
          durationMs: Date.now() - startedAtRef.current,
          recordingStartedAt: startedAtRef.current,
          separateAudio: separateAudio ? audio : [],
        });
        dispatch({ type: 'FINALIZED' });
        track({ name: 'recording_completed', mode, durationSec: Math.round((Date.now() - startedAtRef.current) / 1000) });
        router.replace(`/take/${result.recordingId}${result.audioMergeFailed ? '?audioIssue=1' : ''}`);
      } catch {
        // The raw file is still on disk; bootstrap recovery will register it.
        dispatch({ type: 'FAILED', error: 'write_failed', partialFilePath: filePath });
        track({ name: 'recording_failed', code: 'write_failed' });
      }
    },
    [id, mode, separateAudio, vf, voice],
  );

  const beginRecording = useCallback(async () => {
    if (!hasRoomToRecord()) {
      dispatch({ type: 'FAILED', error: 'low_storage' });
      return;
    }
    try {
      const recorder = await videoOutput.createRecorder({
        maxFileSize: Math.max(50 * 1024 * 1024, availableBytes() - 150 * 1024 * 1024),
      });
      recorderRef.current = recorder;
      await recorder.startRecording(
        (path) => void finishRecording(path),
        (error) => {
          if (__DEV__) console.warn('recording error', error);
          dispatch({ type: 'FAILED', error: 'unknown', partialFilePath: recorder.filePath || null });
          track({ name: 'recording_failed', code: 'recorder_error' });
          if (voice) void vf.stop();
        },
      );
      startedAtRef.current = Date.now();
      setElapsed(0);
      dispatch({ type: 'RECORDING_STARTED', at: startedAtRef.current });
      track({ name: 'recording_started', mode });
      if (mode === 'timed') setPlaying(true);
      if (voice) {
        const ok = await vf.start({ locale: speechLocale, persistAudio: separateAudio });
        if (ok && !access.isPro) {
          const repos = await getRepositories();
          useAccess.getState().setUsage({ voiceFollowSessionsUsed: await repos.kv.increment(USAGE_VF_KEY) });
        }
      }
    } catch (e) {
      if (__DEV__) console.warn('start failed', e);
      dispatch({ type: 'FAILED', error: 'unknown' });
    }
  }, [access.isPro, finishRecording, mode, separateAudio, speechLocale, vf, videoOutput, voice]);

  const stopRecording = useCallback(async () => {
    if (state.status !== 'recording') return;
    dispatch({ type: 'STOP' });
    try {
      await recorderRef.current?.stopRecording();
    } catch {
      dispatch({ type: 'FAILED', error: 'write_failed', partialFilePath: recorderRef.current?.filePath ?? null });
    }
  }, [state.status]);

  // Countdown → start. Tap during countdown cancels.
  useEffect(() => {
    if (state.status !== 'countdown') return;
    const tmo = setTimeout(() => {
      if (countdown <= 1) {
        setCountdown(0);
        void beginRecording();
      } else {
        setCountdown(countdown - 1);
      }
    }, 1000);
    return () => clearTimeout(tmo);
  }, [state.status, countdown, beginRecording]);

  // Leaving the app stops the take cleanly so the file is finalized.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      // 'inactive' (Control Center, incoming-call banner) keeps recording; background stops cleanly.
      setAppActive(s !== 'background');
      if (s === 'background') void stopRecording();
    });
    return () => sub.remove();
  }, [stopRecording]);

  const onRecordPress = () => {
    if (state.status === 'recording') return void stopRecording();
    if (state.status === 'countdown') return dispatch({ type: 'CANCEL_COUNTDOWN' });
    if (state.status !== 'ready') return;
    if (voice && !checkFeature('voiceFollow', access, usage).allowed) {
      router.push('/paywall?trigger=voiceFollow');
      return;
    }
    if (prompter.countdownSec > 0) {
      setCountdown(prompter.countdownSec);
      dispatch({ type: 'START_COUNTDOWN' });
    } else {
      void beginRecording();
    }
  };

  const close = () => {
    if (isBusy(state.status)) {
      Alert.alert(t('record.discardTitle'), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('record.stop'), onPress: () => void stopRecording() },
      ]);
      return;
    }
    router.back();
  };

  // ---------- Permission gate ----------
  if (!camPerm.hasPermission || !micPerm.hasPermission) {
    const blocked = !camPerm.canRequestPermission || !micPerm.canRequestPermission;
    return (
      <SafeAreaView style={styles.permission}>
        <Ionicons name="videocam-outline" size={44} color={palette.violet300} />
        <Text variant="title" color="#fff" center>
          {t('record.permissionTitle')}
        </Text>
        <Text color={palette.ink200} center>
          {t('record.permissionBody')}
        </Text>
        <Button
          label={blocked ? t('record.permissionSettings') : t('record.permissionAllow')}
          onPress={async () => {
            if (blocked) return void Linking.openSettings();
            const cam = camPerm.hasPermission || (await camPerm.requestPermission());
            if (cam && !micPerm.hasPermission) await micPerm.requestPermission();
          }}
        />
        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const recording = state.status === 'recording';
  const vfStatus = vf.snapshot.status;
  const lowStorageSec = remainingRecordSeconds(availableBytes());

  return (
    <View style={styles.root}>
      <Camera
        style={StyleSheet.absoluteFill}
        isActive={appActive}
        device={position}
        outputs={[videoOutput]}
        constraints={[{ fps: cameraSettings.fps }]}
        onStarted={() => dispatch({ type: 'CAMERA_READY' })}
        onError={(e) => {
          if (__DEV__) console.warn('camera error', e);
          dispatch({ type: 'FAILED', error: 'camera_unavailable' });
        }}
        onInterruptionStarted={() => {
          setNotice(t('record.interrupted'));
          void stopRecording();
        }}
        onInterruptionEnded={() => setNotice(null)}
      />

      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <IconButton icon="close" label={t('record.close')} color="#fff" background="rgba(0,0,0,0.35)" onPress={close} />
          <View style={styles.center}>
            {recording ? (
              <View style={styles.recPill} accessibilityLiveRegion="polite" accessibilityLabel={`${t('record.recording')} ${formatClock(elapsed)}`}>
                <View style={styles.recDot} />
                <Text variant="callout" color="#fff" style={styles.tabular}>
                  {formatClock(elapsed)}
                </Text>
              </View>
            ) : null}
            {voice && vfStatus !== 'idle' ? (
              <Text variant="caption" color={vfStatus === 'error' || vfStatus === 'lost' ? palette.amber500 : palette.ink100} accessibilityLiveRegion="polite">
                {vfStatus === 'speaking' || vfStatus === 'finished'
                  ? t('record.voiceSpeaking')
                  : vfStatus === 'lost'
                    ? t('record.voiceLost')
                    : vfStatus === 'error'
                      ? t('record.voiceError')
                      : t('record.voiceListening')}
              </Text>
            ) : null}
          </View>
          <IconButton
            icon="camera-reverse-outline"
            label={t('record.flip')}
            color="#fff"
            background="rgba(0,0,0,0.35)"
            disabled={isBusy(state.status)}
            onPress={() => setPosition((p) => (p === 'front' ? 'back' : 'front'))}
          />
        </View>

        {/* Prompter: top part of the screen, nearest the front camera. */}
        <View style={styles.prompter}>
          {script != null ? (
            <Teleprompter
              ref={prompterRef}
              script={script}
              settings={{ ...prompter, wpm }}
              mode={mode}
              playing={playing}
              followCharOffset={voice ? vf.snapshot.charOffset : null}
              highlightCharOffset={voice ? vf.snapshot.charOffset : 0}
              onTapChar={(c) => {
                if (voice) vf.resync(c);
                prompterRef.current?.jumpToChar(c);
              }}
              onEnd={() => setPlaying(false)}
            />
          ) : null}
        </View>

        {notice || state.status === 'recoverableFailure' || state.status === 'unrecoverableFailure' ? (
          <View style={styles.notice} accessibilityLiveRegion="assertive">
            <Text variant="callout" color="#fff" center>
              {state.error === 'low_storage'
                ? t('record.lowStorage')
                : state.error === 'camera_unavailable'
                  ? t('record.noCamera')
                  : notice ?? (state.partialFilePath ? t('record.failedRecovered') : t('record.failed'))}
            </Text>
            {state.status === 'recoverableFailure' ? <Button label={t('common.retry')} variant="secondary" onPress={() => dispatch({ type: 'RETRY' })} /> : null}
          </View>
        ) : !recording && lowStorageSec < 300 ? (
          <Text variant="caption" color={palette.amber500} center>
            {t('record.lowStorageSoon', { n: Math.max(0, Math.floor(lowStorageSec / 60)) })}
          </Text>
        ) : null}

        {/* Controls */}
        <View style={styles.controls}>
          <View style={styles.sideControls}>
            {mode === 'timed' ? (
              <>
                <IconButton icon="remove" label={t('record.slower')} color="#fff" background="rgba(0,0,0,0.35)" onPress={() => setWpm((w) => clampWpm(w - 10))} />
                <Text variant="caption" color="#fff" style={styles.tabular}>
                  {wpm}
                </Text>
                <IconButton icon="add" label={t('record.faster')} color="#fff" background="rgba(0,0,0,0.35)" onPress={() => setWpm((w) => clampWpm(w + 10))} />
              </>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? t('record.stop') : t('record.start')}
            accessibilityState={{ disabled: !(state.status === 'ready' || recording || state.status === 'countdown') }}
            onPress={onRecordPress}
            style={styles.recordOuter}
          >
            <View style={[styles.recordInner, recording && styles.recordInnerActive]} />
          </Pressable>

          <View style={styles.sideControls}>
            {mode === 'timed' ? (
              <IconButton
                icon={playing ? 'pause' : 'play'}
                label={playing ? t('record.pause') : t('record.play')}
                color="#fff"
                background="rgba(0,0,0,0.35)"
                onPress={() => setPlaying((p) => !p)}
              />
            ) : null}
            <IconButton icon="play-skip-back" label={t('record.restart')} color="#fff" background="rgba(0,0,0,0.35)" onPress={() => {
              prompterRef.current?.restart();
              if (voice) vf.resync(0);
            }} />
          </View>
        </View>
        {state.status === 'finalizing' || state.status === 'stopping' ? (
          <Text variant="caption" color="#fff" center accessibilityLiveRegion="polite">
            {t('record.finalizing')}
          </Text>
        ) : (
          <Text variant="caption" color={palette.ink200} center>
            {t('record.overlayNote')}
          </Text>
        )}
      </SafeAreaView>

      {state.status === 'countdown' ? (
        <Pressable style={styles.countdown} onPress={() => dispatch({ type: 'CANCEL_COUNTDOWN' })} accessibilityRole="button" accessibilityLabel={t('record.countdownCancel')}>
          <Text variant="display" color="#fff" style={styles.countdownText} accessibilityLiveRegion="assertive">
            {countdown}
          </Text>
          <Text color="#fff">{t('record.countdownCancel')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, gap: spacing.sm },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md },
  center: { flex: 1, alignItems: 'center', gap: 2 },
  recPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.rec500 },
  tabular: { fontVariant: ['tabular-nums'] },
  prompter: { flex: 1, marginHorizontal: spacing.sm, borderRadius: radius.lg, overflow: 'hidden' },
  notice: { marginHorizontal: spacing.lg, padding: spacing.md, gap: spacing.sm, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.7)' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  sideControls: { width: 120, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  recordOuter: { width: 82, height: 82, borderRadius: 41, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  recordInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: palette.rec500 },
  recordInnerActive: { width: 30, height: 30, borderRadius: 6 },
  countdown: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)', gap: spacing.md },
  countdownText: { fontSize: 120, lineHeight: 130 },
  permission: { flex: 1, backgroundColor: palette.ink950, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
});
