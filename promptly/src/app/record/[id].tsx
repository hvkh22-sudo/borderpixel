/**
 * Camera + live teleprompter. The prompter is a normal React Native view
 * layered above the camera preview; the recorder encodes frames from the
 * capture pipeline, so the overlay is not part of the file. This must be
 * verified on each platform (test REC-02 in docs/testing/test-plan.md).
 */
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Camera,
  useCameraPermission,
  useMicrophonePermission,
  useVideoOutput,
} from 'react-native-vision-camera';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Text } from '../../components/Text';
import { checkFeature } from '../../features/monetization/entitlements';
import { targetResolution } from '../../features/recording/presets';
import { isBusy, remainingRecordSeconds } from '../../features/recording/recordingMachine';
import type { SavedTake, TakeOptions } from '../../features/recording/recordingSession';
import { useRecordingSession } from '../../features/recording/useRecordingSession';
import { clampWpm } from '../../features/teleprompter/scrollModel';
import { breakPaceSegment, createPaceTracker, timedSample, trackCursor, voiceSample } from '../../features/teleprompter/speakingRate';
import { Teleprompter, type TeleprompterHandle } from '../../features/teleprompter/Teleprompter';
import { countWords } from '../../features/voice-follow/text';
import { useVoiceFollow } from '../../features/voice-follow/useVoiceFollow';
import { USAGE_VF_KEY } from '../../hooks/useBootstrap';
import { formatClock, t } from '../../localization/i18n';
import { track } from '../../services/analytics';
import { getRepositories } from '../../services/db';
import { availableBytes } from '../../services/files';
import { useAccess } from '../../state/access';
import { useSettings, type ScrollMode } from '../../state/settings';
import { useSpeakingRate } from '../../state/speakingRate';
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
  const [position, setPosition] = useState(cameraSettings.position);
  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [wpm, setWpm] = useState(prompter.wpm);
  const [notice, setNotice] = useState<string | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
  const { width: winW, height: winH } = useWindowDimensions();
  const landscape = winW > winH;

  const mode: ScrollMode = modeParam ?? prompter.mode;
  const voice = mode === 'voice';
  // Android: the recognizer owns the microphone; camera records video only and
  // audio is muxed afterwards (docs/architecture/technical-feasibility.md).
  const separateAudio = voice && Platform.OS === 'android';

  const camPerm = useCameraPermission();
  const micPerm = useMicrophonePermission();
  const videoOutput = useVideoOutput({
    // Stable constants (portrait = CommonResolutions.FHD_16_9 / HD_16_9, landscape = swapped) so the
    // output is never recreated mid-take when the phone rotates.
    targetResolution: targetResolution(cameraSettings.orientation, cameraSettings.resolution),
    enableAudio: !separateAudio,
    fileType: 'mp4',
  });

  // 60 fps is a constraint: VisionCamera falls back to the closest supported rate.
  const constraints = useMemo(() => [{ fps: cameraSettings.fps }], [cameraSettings.fps]);

  const startedAtRef = useRef(0);
  const prompterRef = useRef<TeleprompterHandle>(null);
  const vf = useVoiceFollow(script ?? '');
  const scriptWords = useMemo(() => countWords(script ?? ''), [script]);

  // Speaking-rate measurement (refs only: nothing here re-renders the camera screen).
  const paceRef = useRef(createPaceTracker());
  const playedMsRef = useRef(0);
  const playSinceRef = useRef(0);
  const timedEndMsRef = useRef<number | null>(null);
  const manualScrollRef = useRef(false);

  // Recording lifecycle (races, interruptions, salvage) lives in RecordingSession; the screen
  // only maps UI and camera events onto it. UI callbacks never fire after unmount.
  const { session, state } = useRecordingSession(videoOutput, {
    onRecordingStarted: (at) => {
      startedAtRef.current = at;
      paceRef.current = createPaceTracker();
      playedMsRef.current = 0;
      timedEndMsRef.current = null;
      manualScrollRef.current = false;
      setElapsed(0);
      track({ name: 'recording_started', mode });
      if (mode === 'timed') setPlaying(true);
    },
    onVoiceFollowStarted: async () => {
      if (access.isPro) return;
      const repos = await getRepositories();
      useAccess.getState().setUsage({ voiceFollowSessionsUsed: await repos.kv.increment(USAGE_VF_KEY) });
    },
    onTakeCompleted: (durationMs) => track({ name: 'recording_completed', mode, durationSec: Math.round(durationMs / 1000) }),
    onFailure: (code) => track({ name: 'recording_failed', code }),
    onTakeSaved: (take) => onTakeSaved(take),
  });
  const dispatch = session.dispatch;
  const isRecording = state.status === 'recording';
  const playedNow = () => playedMsRef.current + (playSinceRef.current ? Date.now() - playSinceRef.current : 0);
  const markManualJump = () => {
    if (!isRecording) return;
    manualScrollRef.current = true;
    paceRef.current = breakPaceSegment(paceRef.current);
  };

  // Voice Follow: the snapshot only changes when the cursor/status changes, so this is cheap.
  const vfCursor = vf.snapshot.cursor;
  useEffect(() => {
    if (voice && isRecording) paceRef.current = trackCursor(paceRef.current, vfCursor, Date.now());
  }, [voice, isRecording, vfCursor]);

  // Timed: time actually spent scrolling (pauses excluded).
  useEffect(() => {
    if (!(playing && isRecording)) return;
    playSinceRef.current = Date.now();
    return () => {
      playedMsRef.current += Date.now() - playSinceRef.current;
      playSinceRef.current = 0;
    };
  }, [playing, isRecording]);

  useEffect(() => {
    let alive = true;
    void getRepositories()
      .then(async (r) => {
        const body = (await r.scripts.get(id))?.body ?? '';
        if (alive) setScript(body);
      })
      .catch(() => {
        if (alive) setScript('');
      });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (camPerm.hasPermission && micPerm.hasPermission) session.prepare();
  }, [camPerm.hasPermission, micPerm.hasPermission, session]);

  // Recording timer (1 Hz is enough for the label; no per-frame renders).
  useEffect(() => {
    if (state.status !== 'recording') return;
    const iv = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 500);
    return () => clearInterval(iv);
  }, [state.status]);

  const onTakeSaved = (take: SavedTake) => {
    setPlaying(false);
    // Learn the creator's pace from completed takes only (best effort, after the take is safe).
    if (!take.salvaged) {
      const now = Date.now();
      const sample = voice
        ? voiceSample(paceRef.current, now)
        : mode === 'timed'
          ? timedSample(
              { scriptWords, playedMs: timedEndMsRef.current ?? 0, reachedEnd: timedEndMsRef.current != null, manualScroll: manualScrollRef.current },
              now,
            )
          : null;
      if (sample) void useSpeakingRate.getState().record(sample);
    }
    const query = [take.audioMergeFailed ? 'audioIssue=1' : null, take.notice ? `notice=${take.notice}` : null].filter(Boolean).join('&');
    router.replace(`/take/${take.recordingId}${query ? `?${query}` : ''}`);
  };

  const takeOptions = (): TakeOptions => ({
    scriptId: id,
    separateAudio,
    voiceFollow: voice
      ? { start: () => vf.start({ locale: speechLocale, persistAudio: separateAudio }), stop: vf.stop, collectedAudio: vf.collectedAudio }
      : null,
  });
  const beginRecording = () => session.start(takeOptions());
  const stopRecording = () => session.stop();

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
    // beginRecording reads the latest options when the timer fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, countdown]);

  // Leaving the app stops the take cleanly so the file is finalized (and cancels a countdown).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      // 'inactive' (Control Center, incoming-call banner) keeps recording; background stops cleanly.
      setAppActive(s !== 'background');
      if (s === 'background') session.interrupt();
    });
    return () => sub.remove();
  }, [session]);

  const onRecordPress = () => {
    if (state.status === 'recording' || state.status === 'starting') return void stopRecording();
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
          testID="record-permission-allow"
          label={blocked ? t('record.permissionSettings') : t('record.permissionAllow')}
          onPress={async () => {
            if (blocked) return void Linking.openSettings();
            const cam = camPerm.hasPermission || (await camPerm.requestPermission());
            if (cam && !micPerm.hasPermission) await micPerm.requestPermission();
          }}
        />
        <Button testID="record-permission-back" label={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const recording = state.status === 'recording';
  const vfStatus = vf.snapshot.status;
  const lowStorageSec = remainingRecordSeconds(availableBytes());
  // The file follows the screen orientation; nudge when it differs from the chosen frame.
  const rotateHint =
    !isBusy(state.status) && cameraSettings.orientation === 'landscape' && !landscape
      ? t('record.rotateLandscape')
      : !isBusy(state.status) && cameraSettings.orientation === 'portrait' && landscape
        ? t('record.rotatePortrait')
        : null;
  const footnote =
    state.status === 'finalizing' || state.status === 'stopping' ? (
      <Text testID="record-finalizing" variant="caption" color="#fff" center accessibilityLiveRegion="polite">
        {t('record.finalizing')}
      </Text>
    ) : (
      <Text variant="caption" color={palette.ink200} center>
        {rotateHint ?? t('record.overlayNote')}
      </Text>
    );

  return (
    <View style={styles.root}>
      <Camera
        style={StyleSheet.absoluteFill}
        isActive={appActive}
        device={position}
        outputs={[videoOutput]}
        constraints={constraints}
        // Output orientation follows the UI (what the creator sees), not the raw sensor: with rotation
        // lock on, a vertical take stays vertical even if the phone tilts. Device test REC-07.
        orientationSource="interface"
        onStarted={() => session.cameraStarted()}
        onStopped={() => session.cameraStopped()}
        onError={(e) => {
          if (__DEV__) console.warn('camera error', e);
          // During a take: stop and keep the file. Otherwise: camera unavailable.
          session.cameraError();
        }}
        onInterruptionStarted={() => {
          setNotice(t('record.interrupted'));
          session.interrupt();
        }}
        onInterruptionEnded={() => setNotice(null)}
      />

      <SafeAreaView
        style={[styles.overlay, landscape && styles.overlayLandscape]}
        edges={landscape ? ['top', 'bottom', 'left', 'right'] : ['top', 'bottom']}
      >
        <View style={styles.main}>
          {/* Top bar */}
          <View style={styles.topBar}>
            <IconButton testID="record-close" icon="close" label={t('record.close')} color="#fff" background="rgba(0,0,0,0.35)" onPress={close} />
            <View style={styles.center}>
              {recording ? (
                <View testID="record-timer" style={styles.recPill} accessibilityLiveRegion="polite" accessibilityLabel={`${t('record.recording')} ${formatClock(elapsed)}`}>
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
              testID="record-flip"
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
                playing={playing && (state.status === 'recording' || !isBusy(state.status))}
                followCharOffset={voice ? vf.snapshot.charOffset : null}
                highlightCharOffset={voice ? vf.snapshot.charOffset : 0}
                onTapChar={(c) => {
                  markManualJump();
                  if (voice) vf.resync(c);
                  prompterRef.current?.jumpToChar(c);
                }}
                onUserScroll={() => {
                  if (isRecording) manualScrollRef.current = true;
                }}
                onEnd={() => {
                  if (isRecording && timedEndMsRef.current == null) timedEndMsRef.current = playedNow();
                  setPlaying(false);
                }}
              />
            ) : null}
          </View>

          {notice || state.status === 'recoverableFailure' || state.status === 'unrecoverableFailure' ? (
            <View testID="record-notice" style={styles.notice} accessibilityLiveRegion="assertive">
              <Text variant="callout" color="#fff" center>
                {state.error === 'low_storage'
                  ? t('record.lowStorage')
                  : state.error === 'camera_unavailable'
                    ? t('record.noCamera')
                    : notice ?? (state.partialFilePath ? t('record.failedRecovered') : t('record.failed'))}
              </Text>
              {state.status === 'recoverableFailure' ? <Button label={t('common.retry')} variant="secondary" onPress={() => session.retry()} /> : null}
            </View>
          ) : !recording && lowStorageSec < 300 ? (
            <Text variant="caption" color={palette.amber500} center>
              {t('record.lowStorageSoon', { n: Math.max(0, Math.floor(lowStorageSec / 60)) })}
            </Text>
          ) : null}
          {landscape ? footnote : null}
        </View>

        {/* Controls: bottom row in portrait, trailing column in landscape. */}
        <View style={landscape ? styles.controlsLandscape : styles.controls}>
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
            testID="record-button"
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
              markManualJump();
              prompterRef.current?.restart();
              if (voice) vf.resync(0);
            }} />
          </View>
        </View>
        {!landscape ? footnote : null}
      </SafeAreaView>

      {state.status === 'countdown' ? (
        <Pressable testID="record-countdown" style={styles.countdown} onPress={() => dispatch({ type: 'CANCEL_COUNTDOWN' })} accessibilityRole="button" accessibilityLabel={t('record.countdownCancel')}>
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
  overlayLandscape: { flexDirection: 'row' },
  main: { flex: 1, gap: spacing.sm },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md },
  center: { flex: 1, alignItems: 'center', gap: 2 },
  recPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.rec500 },
  tabular: { fontVariant: ['tabular-nums'] },
  prompter: { flex: 1, marginHorizontal: spacing.sm, borderRadius: radius.lg, overflow: 'hidden' },
  notice: { marginHorizontal: spacing.lg, padding: spacing.md, gap: spacing.sm, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.7)' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  controlsLandscape: { width: 150, alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  sideControls: { width: 120, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  recordOuter: { width: 82, height: 82, borderRadius: 41, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  recordInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: palette.rec500 },
  recordInnerActive: { width: 30, height: 30, borderRadius: 6 },
  countdown: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)', gap: spacing.md },
  countdownText: { fontSize: 120, lineHeight: 130 },
  permission: { flex: 1, backgroundColor: palette.ink950, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
});
