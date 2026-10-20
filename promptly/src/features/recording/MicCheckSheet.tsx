import { Ionicons } from '@expo/vector-icons';
import { RecordingPresets, useAudioRecorder, type RecordingInput, type RecordingOptions } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { decorative } from '../../components/a11y';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { useAnnounce } from '../../hooks/useAnnounce';
import { t } from '../../localization/i18n';
import { beginMicSession, deleteMicCheckFile, ensureMicPermission, releaseMicSession } from '../../services/micCheck';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';
import { classifyMicInput, MIC_CHECK_DURATION_MS, MIC_CHECK_POLL_MS, meterFraction, micVerdict, type MicVerdict } from './micCheck';

/** A small mono clip is enough to read levels; metering is what matters. */
const MIC_CHECK_OPTIONS: RecordingOptions = { ...RecordingPresets.LOW_QUALITY, isMeteringEnabled: true };

type Phase = 'idle' | 'preparing' | 'listening' | 'done' | 'denied' | 'blocked' | 'error';

interface Props {
  visible: boolean;
  onClose: () => void;
  onResult?: (verdict: MicVerdict) => void;
}

export const VERDICT_TITLE: Record<MicVerdict, 'micCheck.good' | 'micCheck.quiet' | 'micCheck.clipping' | 'micCheck.silent'> = {
  good: 'micCheck.good',
  quiet: 'micCheck.quiet',
  clipping: 'micCheck.clipping',
  silent: 'micCheck.silent',
};

export const VERDICT_SHORT: Record<MicVerdict, 'micCheck.shortGood' | 'micCheck.shortQuiet' | 'micCheck.shortClipping' | 'micCheck.shortSilent'> = {
  good: 'micCheck.shortGood',
  quiet: 'micCheck.shortQuiet',
  clipping: 'micCheck.shortClipping',
  silent: 'micCheck.shortSilent',
};

const VERDICT_DETAIL: Record<MicVerdict, 'micCheck.goodDetail' | 'micCheck.quietDetail' | 'micCheck.clippingDetail' | 'micCheck.silentDetail'> = {
  good: 'micCheck.goodDetail',
  quiet: 'micCheck.quietDetail',
  clipping: 'micCheck.clippingDetail',
  silent: 'micCheck.silentDetail',
};

/**
 * Mic check sheet. The recorder only exists while the sheet is open (the panel
 * mounts with it), so closing the sheet always releases the native recorder.
 */
export function MicCheckSheet({ visible, onClose, onResult }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} title={t('micCheck.title')}>
      {visible ? <MicCheckPanel onClose={onClose} onResult={onResult} /> : null}
    </Sheet>
  );
}

function MicCheckPanel({ onClose, onResult }: { onClose: () => void; onResult?: (v: MicVerdict) => void }) {
  const { colors } = useTheme();
  const recorder = useAudioRecorder(MIC_CHECK_OPTIONS);
  const [phase, setPhase] = useState<Phase>('idle');
  const [level, setLevel] = useState(0);
  const [verdict, setVerdict] = useState<MicVerdict | null>(null);
  const [input, setInput] = useState<RecordingInput | null>(null);

  const samples = useRef<number[]>([]);
  const timers = useRef<{ poll?: ReturnType<typeof setInterval>; stop?: ReturnType<typeof setTimeout> }>({});
  const active = useRef(false);
  const fileUri = useRef<string | null>(null);
  const mounted = useRef(true);

  const clearTimers = () => {
    if (timers.current.poll) clearInterval(timers.current.poll);
    if (timers.current.stop) clearTimeout(timers.current.stop);
    timers.current = {};
  };

  /** Stop, delete the probe clip, release the session — in that order (see services/micCheck). */
  const teardown = useCallback(async () => {
    clearTimers();
    if (!active.current) return;
    active.current = false;
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch {
      // Already stopped or released with the sheet.
    }
    try {
      fileUri.current = recorder.uri ?? fileUri.current;
    } catch {
      // Released object: keep the uri captured at prepare time.
    }
    deleteMicCheckFile(fileUri.current);
    fileUri.current = null;
    await releaseMicSession();
  }, [recorder]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void teardown();
    };
  }, [teardown]);

  const finish = async () => {
    await teardown();
    const v = micVerdict(samples.current);
    if (!mounted.current) return;
    setVerdict(v);
    setLevel(0);
    setPhase('done');
    onResult?.(v);
  };

  const run = async () => {
    samples.current = [];
    setLevel(0);
    setVerdict(null);
    setPhase('preparing');
    let perm;
    try {
      perm = await ensureMicPermission();
    } catch {
      perm = 'denied' as const;
    }
    if (!mounted.current) return;
    if (perm !== 'granted') {
      setPhase(perm);
      return;
    }
    try {
      active.current = true;
      await beginMicSession();
      await recorder.prepareToRecordAsync();
      fileUri.current = recorder.uri;
      recorder.record();
      if (!mounted.current) return void teardown();
      setPhase('listening');
      // Android only reports the routed device while recording; iOS once prepared.
      recorder
        .getCurrentInput()
        .then((i) => mounted.current && setInput(i))
        .catch(() => undefined);
      timers.current.poll = setInterval(() => {
        try {
          const m = recorder.getStatus().metering;
          if (m == null) return;
          samples.current.push(m);
          setLevel(meterFraction(m));
        } catch {
          // Status unavailable for one tick; keep polling.
        }
      }, MIC_CHECK_POLL_MS);
      timers.current.stop = setTimeout(() => void finish(), MIC_CHECK_DURATION_MS);
    } catch {
      await teardown();
      if (mounted.current) setPhase('error');
    }
  };

  const busy = phase === 'preparing' || phase === 'listening';
  const kind = classifyMicInput(input?.type);
  const verdictColor = verdict === 'good' ? colors.success : verdict === 'silent' ? colors.danger : colors.warning;
  const verdictIcon = verdict === 'good' ? 'checkmark-circle' : verdict === 'silent' ? 'mic-off' : 'alert-circle';
  const meterColor = level >= 0.98 ? colors.danger : colors.success;
  const statusText =
    phase === 'preparing'
      ? t('micCheck.preparing')
      : phase === 'listening'
        ? t('micCheck.listening')
        : phase === 'denied' || phase === 'blocked'
          ? t('micCheck.permissionDenied')
          : phase === 'error'
            ? t('micCheck.failed')
            : t('micCheck.intro');
  // VoiceOver has no live regions: announce phase changes and the verdict (idle intro is read on focus).
  useAnnounce(phase === 'done' && verdict ? `${t(VERDICT_TITLE[verdict])}. ${t(VERDICT_DETAIL[verdict])}` : phase === 'idle' ? null : statusText);

  return (
    <View style={styles.body}>
      {phase === 'done' && verdict ? (
        <View style={styles.verdict} accessibilityLiveRegion="polite">
          <Ionicons {...decorative} name={verdictIcon} size={28} color={verdictColor} />
          <View style={styles.flex}>
            <Text variant="headline">{t(VERDICT_TITLE[verdict])}</Text>
            <Text variant="caption" muted>
              {t(VERDICT_DETAIL[verdict])}
            </Text>
          </View>
        </View>
      ) : (
        <Text variant="callout" muted accessibilityLiveRegion={phase === 'idle' ? 'none' : 'polite'}>
          {statusText}
        </Text>
      )}

      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('micCheck.level')}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(level * 100) }}
        style={[styles.meter, { backgroundColor: colors.border }]}
      >
        <View testID="mic-meter-fill" style={[styles.meterFill, { width: `${Math.round(level * 100)}%`, backgroundColor: meterColor }]} />
      </View>

      {input?.name ? (
        <Text variant="caption" muted>
          {t('micCheck.input', { name: input.name })}
        </Text>
      ) : null}
      <Text variant="caption" muted color={kind === 'bluetooth' ? colors.warning : undefined}>
        {kind === 'bluetooth' ? t('micCheck.bluetoothNote') : t('micCheck.tip')}
      </Text>

      {phase === 'blocked' ? (
        <Button label={t('micCheck.openSettings')} variant="secondary" onPress={() => void Linking.openSettings()} />
      ) : (
        <Button
          label={phase === 'idle' ? t('micCheck.start') : t('micCheck.again')}
          icon="mic"
          loading={busy}
          onPress={() => void run()}
        />
      )}
      <Button label={t('common.done')} variant="ghost" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingBottom: spacing.sm },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1, gap: 2 },
  meter: { height: 10, borderRadius: radius.pill, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: radius.pill },
});
