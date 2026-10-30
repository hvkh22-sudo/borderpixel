/**
 * Camera + live teleprompter. The prompter is a normal React Native view
 * layered above the camera preview; the recorder encodes frames from the
 * capture pipeline, so the overlay is not part of the file. This must be
 * verified on each platform (test REC-02 in docs/testing/test-plan.md).
 */
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Linking, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Camera,
  useCameraPermission,
  useMicrophonePermission,
  useVideoOutput,
} from 'react-native-vision-camera';

import { decorative } from '../../components/a11y';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Text } from '../../components/Text';
import { checkFeature } from '../../features/monetization/entitlements';
import { FirstTakeTip } from '../../features/onboarding/FirstTakeTip';
import { usesSeparateAudio } from '../../features/platform/audioStrategy';
import { targetResolution } from '../../features/recording/presets';
import { isBusy, remainingRecordSeconds } from '../../features/recording/recordingMachine';
import type { SavedTake, TakeOptions } from '../../features/recording/recordingSession';
import { useRecordingSession } from '../../features/recording/useRecordingSession';
import { acceptRecordToggle, mapRemoteKey } from '../../features/teleprompter/remoteKeys';
import { clampWpm } from '../../features/teleprompter/scrollModel';
import { breakPaceSegment, createPaceTracker, timedSample, trackCursor, voiceSample } from '../../features/teleprompter/speakingRate';
import { Teleprompter, type TeleprompterHandle } from '../../features/teleprompter/Teleprompter';
import { countWords } from '../../features/voice-follow/text';
import { useVoiceFollow } from '../../features/voice-follow/useVoiceFollow';
import { useAnnounce } from '../../hooks/useAnnounce';
import { USAGE_VF_KEY } from '../../hooks/useBootstrap';
import { formatClock, t } from '../../localization/i18n';
import { track } from '../../services/analytics';
import { config } from '../../services/config';
import { getRepositories } from '../../services/db';
import { deviceFacts } from '../../services/deviceSupport';
import { useDiagnosticsOverrides } from '../../services/diagnosticsOverrides';
import { availableBytes } from '../../services/files';
import { PromptlyMedia } from '../../services/nativeMedia';
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
  const remoteEnabled = useSettings((s) => s.remoteEnabled);
  const remoteRecordToggle = useSettings((s) => s.remoteRecordToggle);
  const usage = useAccess((s) => s.usage);

  const [script, setScript] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
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
  // Android (and iOS with the 'separate' strategy): the recognizer owns the microphone; the camera
  // records video only and audio is muxed afterwards (DECISIONS D4, docs/architecture/technical-feasibility.md).
  const iosVfAudio = useDiagnosticsOverrides((s) => s.iosVoiceFollowAudio) ?? config.iosVoiceFollowAudio;
  const separateAudio = usesSeparateAudio({
    voiceFollow: voice,
    os: deviceFacts().os,
    iosStrategy: iosVfAudio,
    mediaModuleAvailable: PromptlyMedia.isAvailable(),
  });

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
  /** The prompter left the top before the take started (played, dragged, tapped or nudged). */
  const movedBeforeTakeRef = useRef(false);

  // Recording lifecycle (races, interruptions, salvage) lives in RecordingSession; the screen
  // only maps UI and camera events onto it. UI callbacks never fire after unmount.
  const { session, state } = useRecordingSession(videoOutput, {
    onRecordingStarted: (at) => {
      startedAtRef.current = at;
      paceRef.current = createPaceTracker();
      playedMsRef.current = 0;
      timedEndMsRef.current = null;
      // A take that starts mid-script would teach a too-fast pace (whole script, part of the time).
      manualScrollRef.current = movedBeforeTakeRef.current;
      setElapsed(0);
      track({ name: 'recording_started', mode });
      if (mode === 'timed') setPlaying(true);
    },
    onVoiceFollowStarted: async () => {
      // Read at the moment of use: purchases may have loaded since this screen rendered.
      if (useAccess.getState().access.isPro) return;
      const repos = await getRepositories();
      useAccess.getState().setUsage({ voiceFollowSessionsUsed: await repos.kv.increment(USAGE_VF_KEY) });
    },
    onTakeCompleted: (durationMs) => track({ name: 'recording_completed', mode, durationSec: Math.round(durationMs / 1000) }),
    onFailure: (code) => {
      // A failed take must not leave the timed prompter scrolling over an idle camera.
      setPlaying(false);
      track({ name: 'recording_failed', code });
    },
    onTakeSaved: (take) => onTakeSaved(take),
  });
  const dispatch = session.dispatch;
  const isRecording = state.status === 'recording';
  const playedNow = () => playedMsRef.current + (playSinceRef.current ? Date.now() - playSinceRef.current : 0);
  const markManualJump = () => {
    if (!isRecording) {
      movedBeforeTakeRef.current = true;
      return;
    }
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
    if (playing && !isBusy(state.status)) movedBeforeTakeRef.current = true;
    if (!(playing && isRecording)) return;
    playSinceRef.current = Date.now();
    return () => {
      playedMsRef.current += Date.now() - playSinceRef.current;
      playSinceRef.current = 0;
    };
  }, [playing, isRecording, state.status]);

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

  // Screen-reader status. Start is announced on both platforms (the timer is not a live region:
  // it ticks twice a second); the rest uses live regions on Android and announcements on iOS.
  const stoppingTake = state.status === 'stopping' || state.status === 'finalizing';
  const vfMessage =
    !voice || vf.snapshot.status === 'idle'
      ? null
      : vf.snapshot.status === 'speaking' || vf.snapshot.status === 'finished'
        ? t('record.voiceSpeaking')
        : vf.snapshot.status === 'lost'
          ? t('record.voiceLost')
          : vf.snapshot.status === 'error'
            ? t('record.voiceError')
            : t('record.voiceListening');
  const noticeMessage =
    notice || state.status === 'recoverableFailure' || state.status === 'unrecoverableFailure'
      ? state.error === 'low_storage'
        ? t('record.lowStorage')
        : state.error === 'camera_unavailable'
          ? t('record.noCamera')
          : notice ?? (state.partialFilePath ? t('record.failedRecovered') : t('record.failed'))
      : null;
  useAnnounce(state.status === 'recording' ? t('record.recording') : null, 'all');
  useAnnounce(stoppingTake ? `${t('a11y.recordingStopped')}. ${t('record.finalizing')}` : null);
  useAnnounce(state.status === 'countdown' && countdown > 0 ? String(countdown) : null);
  useAnnounce(vfMessage);
  useAnnounce(noticeMessage);

  const onRecordPress = () => {
    if (state.status === 'recording' || state.status === 'starting') return void stopRecording();
    if (state.status === 'countdown') return dispatch({ type: 'CANCEL_COUNTDOWN' });
    if (state.status !== 'ready') return;
    // Voice Follow is built from the script; starting before it loads would restart it mid-take.
    if (script === null) return;
    // Purchases not loaded yet: the answer is unknown, so a paying user is never sent to the paywall.
    if (voice && useAccess.getState().loaded && !checkFeature('voiceFollow', useAccess.getState().access, usage).allowed) {
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

  // Bluetooth page-turner / keyboard (docs/architecture/remote-control.md). The handler ref
  // is refreshed after every render, so the native subscription only changes with the setting.
  const remoteHandlerRef = useRef<(key: string, repeat: boolean) => void>(() => {});
  const lastRemoteToggleRef = useRef<number | null>(null);
  useEffect(() => {
    remoteHandlerRef.current = (key, repeat) => {
      const action = mapRemoteKey({ key, repeat }, { mode, recordToggle: remoteRecordToggle });
      if (action.type === 'nudge') {
        markManualJump();
        prompterRef.current?.nudgeLines(action.lines);
      } else if (action.type === 'togglePlay') {
        setPlaying((p) => !p);
      } else if (action.type === 'toggleRecord') {
        const now = Date.now();
        if (!acceptRecordToggle(lastRemoteToggleRef.current, now)) return;
        lastRemoteToggleRef.current = now;
        onRecordPress();
      }
    };
  });
  // Not while another screen (the paywall) is on top: keys would act on the hidden prompter.
  const focused = useIsFocused();
  useEffect(() => {
    if (!remoteEnabled || !appActive || !focused) return;
    return PromptlyMedia.listenRemoteKeys((e) => remoteHandlerRef.current(e.key, e.repeat));
  }, [remoteEnabled, appActive, focused]);

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
  // Android's back button must not leave mid-take: it goes through close() (stop and save), so the
  // camera, recognizer and its audio files are finished before the screen unmounts.
  const backRef = useRef(close);
  useEffect(() => {
    backRef.current = close;
  });
  const busyNow = isBusy(state.status);
  useEffect(() => {
    if (!busyNow) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      backRef.current();
      return true;
    });
    return () => sub.remove();
  }, [busyNow]);

  // ---------- Permission gate ----------
  if (!camPerm.hasPermission || !micPerm.hasPermission) {
    const blocked = !camPerm.canRequestPermission || !micPerm.canRequestPermission;
    return (
      <SafeAreaView style={styles.permission}>
        <Ionicons {...decorative} name="videocam-outline" size={44} color={palette.violet300} />
        <Text variant="title" color="#fff" center accessibilityRole="header">
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
        key={cameraKey}
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
                <View testID="record-timer" style={styles.recPill} accessible accessibilityLabel={`${t('record.recording')} ${formatClock(elapsed)}`}>
                  <View style={styles.recDot} {...decorative} />
                  <Text variant="callout" color="#fff" style={styles.tabular}>
                    {formatClock(elapsed)}
                  </Text>
                </View>
              ) : null}
              {vfMessage ? (
                <Text variant="caption" color={vfStatus === 'error' || vfStatus === 'lost' ? palette.amber500 : palette.ink100} accessibilityLiveRegion="polite">
                  {vfMessage}
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
                  // A dragged take does not teach a speaking rate (timedSample drops it).
                  markManualJump();
                }}
                onEnd={() => {
                  if (isRecording && timedEndMsRef.current == null) timedEndMsRef.current = playedNow();
                  setPlaying(false);
                }}
              />
            ) : null}
            {script != null ? <FirstTakeTip /> : null}
          </View>

          {noticeMessage ? (
            <View testID="record-notice" style={styles.notice}>
              <Text variant="callout" color="#fff" center accessibilityLiveRegion="assertive">
                {noticeMessage}
              </Text>
              {state.status === 'recoverableFailure' ? <Button label={t('common.retry')} variant="secondary" onPress={() => session.retry()} /> : null}
              {state.status === 'unrecoverableFailure' && state.error === 'camera_unavailable' ? (
                <Button
                  testID="record-camera-retry"
                  label={t('common.retry')}
                  variant="secondary"
                  onPress={() => {
                    session.retryCamera();
                    // A camera that errored may not restart by itself: mount a fresh one.
                    setCameraKey((k) => k + 1);
                  }}
                />
              ) : null}
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
                <Text variant="caption" color="#fff" style={styles.tabular} accessibilityLabel={t('prepare.wpm', { n: wpm })}>
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
            accessibilityState={{
              disabled: !(state.status === 'ready' || recording || state.status === 'countdown'),
              busy: state.status === 'starting' || stoppingTake,
            }}
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
              if (!isRecording) movedBeforeTakeRef.current = false;
              if (voice) vf.resync(0);
            }} />
          </View>
        </View>
        {!landscape ? footnote : null}
      </SafeAreaView>

      {state.status === 'countdown' ? (
        <Pressable
          testID="record-countdown"
          style={styles.countdown}
          onPress={() => dispatch({ type: 'CANCEL_COUNTDOWN' })}
          accessibilityRole="button"
          accessibilityLabel={`${countdown}, ${t('record.countdownCancel')}`}
          // Android announces the changing label; iOS gets useAnnounce above.
          accessibilityLiveRegion="assertive"
          accessibilityViewIsModal
        >
          {/* Already 120 pt: Dynamic Type scaling would only push it off small screens. */}
          <Text variant="display" color="#fff" style={styles.countdownText} maxFontSizeMultiplier={1}>
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
