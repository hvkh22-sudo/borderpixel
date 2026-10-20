import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { ListRow } from '../../components/ListRow';
import { ProBadge } from '../../components/ProBadge';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Segmented } from '../../components/Segmented';
import { Stepper } from '../../components/Stepper';
import { Text } from '../../components/Text';
import { checkFeature } from '../../features/monetization/entitlements';
import { MicCheckSheet, VERDICT_SHORT } from '../../features/recording/MicCheckSheet';
import type { MicVerdict } from '../../features/recording/micCheck';
import { activePreset, applyPreset, getPreset, RECORDING_PRESETS, type PresetId } from '../../features/recording/presets';
import { suggestedTimedWpm } from '../../features/teleprompter/speakingRate';
import { MAX_WPM, MIN_WPM, WPM_STEP } from '../../features/teleprompter/scrollModel';
import { Teleprompter } from '../../features/teleprompter/Teleprompter';
import { estimateSpeakingSeconds } from '../../features/voice-follow/text';
import { formatDuration, t } from '../../localization/i18n';
import { getRepositories } from '../../services/db';
import { support } from '../../services/deviceSupport';
import { whenMicReleased } from '../../services/micCheck';
import { useAccess } from '../../state/access';
import { useSettings, type ScrollMode } from '../../state/settings';
import { useLearnedWpm, useSpeakingRate } from '../../state/speakingRate';
import type { Script } from '../../storage/repositories';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../../theme/tokens';

export default function Prepare() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [script, setScript] = useState<Script | null>(null);
  const prompter = useSettings((s) => s.prompter);
  const camera = useSettings((s) => s.camera);
  const captionPosition = useSettings((s) => s.captionPosition);
  const learnedWpm = useLearnedWpm();
  const paceWpm = useSpeakingRate((s) => suggestedTimedWpm(s.history));
  const { colors } = useTheme();
  const { setPrompter, setCamera } = useSettings.getState();
  const access = useAccess((s) => s.access);
  const usage = useAccess((s) => s.usage);
  const vfSupport = support.voiceFollow();
  const [micOpen, setMicOpen] = useState(false);
  const [micVerdict, setMicVerdict] = useState<MicVerdict | null>(null);

  useEffect(() => {
    void getRepositories().then((r) => r.scripts.get(id).then(setScript));
  }, [id]);

  const voiceGate = checkFeature('voiceFollow', access, usage);
  const voiceSupported = vfSupport.ok;

  const chooseMode = (mode: ScrollMode) => {
    if (mode === 'voice' && !voiceGate.allowed) {
      router.push('/paywall?trigger=voiceFollow');
      return;
    }
    setPrompter({ mode });
  };
  const preset = activePreset({ camera, prompter, captionPosition });
  const choosePreset = (presetId: PresetId) => {
    const s = useSettings.getState();
    useSettings.setState(applyPreset({ camera: s.camera, prompter: s.prompter, captionPosition: s.captionPosition }, presetId));
  };

  const mode: ScrollMode = prompter.mode === 'voice' && (!voiceSupported || !voiceGate.allowed) ? 'timed' : prompter.mode;

  // The camera must own the audio session: wait until a mic check has fully released it.
  const openCamera = async () => {
    await whenMicReleased();
    router.push(`/record/${id}?mode=${mode}`);
  };

  const modeHint =
    mode === 'manual' ? t('prepare.modeManualHint') : mode === 'timed' ? t('prepare.modeTimedHint') : t('prepare.modeVoiceHint');

  return (
    <Screen
      footer={<Button testID="prepare-start" label={t('prepare.start')} icon="videocam" variant="record" size="lg" onPress={() => void openCamera()} />}
    >
      <View style={styles.preview} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {script ? (
          <Teleprompter script={script.body} settings={{ ...prompter, mode }} mode="manual" playing={false} followCharOffset={null} />
        ) : null}
      </View>

      <Section
        title={t('presets.title')}
        right={
          <Text variant="caption" muted>
            {preset ? t(getPreset(preset).nameKey) : t('presets.custom')}
          </Text>
        }
      >
        <View accessibilityRole="radiogroup" accessibilityLabel={t('presets.title')}>
          {RECORDING_PRESETS.map((p) => {
            const selected = p.id === preset;
            return (
              <Pressable
                key={p.id}
                testID={`preset-${p.id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={t(p.nameKey)}
                accessibilityHint={t(p.detailKey)}
                onPress={() => choosePreset(p.id)}
                style={({ pressed }) => [styles.presetRow, pressed && { opacity: 0.7 }]}
              >
                <View style={styles.presetText}>
                  <Text variant="callout">{t(p.nameKey)}</Text>
                  <Text variant="caption" muted>
                    {t(p.detailKey)}
                  </Text>
                </View>
                <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? colors.primary : colors.textMuted} />
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title={t('prepare.mode')}>
        <View style={styles.pad}>
          <Segmented
            accessibilityLabel={t('prepare.mode')}
            value={mode}
            onChange={chooseMode}
            options={[
              { value: 'manual', label: t('prepare.modeManual'), testID: 'mode-manual' },
              { value: 'timed', label: t('prepare.modeTimed'), testID: 'mode-timed' },
              ...(voiceSupported ? [{ value: 'voice' as const, label: t('prepare.modeVoice'), badge: access.isPro ? undefined : t('common.pro'), testID: 'mode-voice' }] : []),
            ]}
          />
          <Text variant="caption" muted>
            {modeHint}
          </Text>
          {!voiceSupported ? (
            <Text variant="caption" muted>
              {vfSupport.ok ? '' : `${t('prepare.voiceUnavailable')} ${t(`support.${vfSupport.reason}`)}`}
            </Text>
          ) : voiceGate.allowed && voiceGate.reason === 'trial' ? (
            <Text variant="caption" muted>
              {t('prepare.voiceTrial', { n: voiceGate.remaining ?? 0 })}
            </Text>
          ) : null}
        </View>
        {mode === 'timed' ? (
          <Stepper
            label={t('prepare.speed')}
            value={prompter.wpm}
            display={t('prepare.wpm', { n: prompter.wpm })}
            min={MIN_WPM}
            max={MAX_WPM}
            step={WPM_STEP}
            onChange={(wpm) => setPrompter({ wpm })}
            hint={script ? t('prepare.estimate', { duration: formatDuration(estimateSpeakingSeconds(script.body, prompter.wpm)) }) : undefined}
          />
        ) : null}
        {mode === 'timed' && learnedWpm != null && paceWpm != null ? (
          <View style={styles.paceRow}>
            <Text variant="caption" muted style={styles.flex}>
              {paceWpm === prompter.wpm ? t('prepare.paceInUse', { n: learnedWpm }) : t('prepare.yourPace', { n: learnedWpm })}
            </Text>
            {paceWpm !== prompter.wpm ? <Button label={t('prepare.usePace')} variant="ghost" onPress={() => setPrompter({ wpm: paceWpm })} /> : null}
          </View>
        ) : null}
      </Section>

      <Section title={t('prepare.display')}>
        <Stepper label={t('prepare.fontSize')} value={prompter.fontSize} display={`${prompter.fontSize}`} min={18} max={64} step={2} onChange={(fontSize) => setPrompter({ fontSize })} />
        <Stepper label={t('prepare.lineHeight')} value={prompter.lineHeight} display={prompter.lineHeight.toFixed(2)} min={1.1} max={2} step={0.05} onChange={(lineHeight) => setPrompter({ lineHeight })} />
        <Stepper label={t('prepare.textWidth')} value={prompter.textWidth} display={`${Math.round(prompter.textWidth * 100)}%`} min={0.5} max={0.96} step={0.04} onChange={(textWidth) => setPrompter({ textWidth })} />
        <Stepper
          label={t('prepare.readingLine')}
          hint={t('prepare.readingLineHint')}
          value={prompter.readingLine}
          display={`${Math.round(prompter.readingLine * 100)}%`}
          min={0.08}
          max={0.6}
          step={0.02}
          onChange={(readingLine) => setPrompter({ readingLine })}
        />
        <Stepper label={t('prepare.backdrop')} value={prompter.backdropOpacity} display={`${Math.round(prompter.backdropOpacity * 100)}%`} min={0} max={0.9} step={0.05} onChange={(backdropOpacity) => setPrompter({ backdropOpacity })} />
        <View style={styles.pad}>
          <Text variant="callout">{t('prepare.align')}</Text>
          <Segmented
            accessibilityLabel={t('prepare.align')}
            value={prompter.align}
            onChange={(align) => setPrompter({ align })}
            options={[
              { value: 'left', label: t('prepare.alignLeft') },
              { value: 'center', label: t('prepare.alignCenter') },
            ]}
          />
        </View>
        <ListRow title={t('prepare.readingGuide')} toggle={{ value: prompter.showReadingGuide, onChange: (showReadingGuide) => setPrompter({ showReadingGuide }) }} />
        <ListRow title={t('prepare.highContrast')} toggle={{ value: prompter.highContrast, onChange: (highContrast) => setPrompter({ highContrast }) }} />
        <ListRow title={t('prepare.mirror')} toggle={{ value: prompter.mirror, onChange: (mirror) => setPrompter({ mirror }) }} />
      </Section>

      <Section title={t('prepare.camera')}>
        <View style={styles.pad}>
          <Segmented
            accessibilityLabel={t('prepare.camera')}
            value={camera.position}
            onChange={(position) => setCamera({ position })}
            options={[
              { value: 'front', label: t('prepare.front'), testID: 'camera-front' },
              { value: 'back', label: t('prepare.back'), testID: 'camera-back' },
            ]}
          />
          <Text variant="callout">{t('prepare.orientation')}</Text>
          <Segmented
            accessibilityLabel={t('prepare.orientation')}
            value={camera.orientation}
            onChange={(orientation) => setCamera({ orientation })}
            options={[
              { value: 'portrait', label: t('prepare.portrait') },
              { value: 'landscape', label: t('prepare.landscape') },
            ]}
          />
          <Text variant="callout">{t('prepare.quality')}</Text>
          <Segmented
            accessibilityLabel={t('prepare.quality')}
            value={camera.resolution}
            onChange={(resolution) => setCamera({ resolution })}
            options={[
              { value: '1080p', label: '1080p' },
              { value: '720p', label: '720p' },
            ]}
          />
          <Text variant="callout">{t('prepare.frameRate')}</Text>
          <Segmented
            accessibilityLabel={t('prepare.frameRate')}
            value={camera.fps}
            onChange={(fps) => setCamera({ fps })}
            options={[30, 60].map((n) => ({ value: n as 30 | 60, label: t('prepare.fps', { n }) }))}
          />
          <Text variant="callout">{t('prepare.countdown')}</Text>
          <Segmented
            accessibilityLabel={t('prepare.countdown')}
            value={prompter.countdownSec}
            onChange={(countdownSec) => setPrompter({ countdownSec })}
            options={[0, 3, 5, 10].map((n) => ({ value: n as 0 | 3 | 5 | 10, label: n === 0 ? t('common.off') : t('common.seconds', { n }), testID: `countdown-${n}` }))}
          />
        </View>
        <ListRow
          title={t('micCheck.row')}
          subtitle={t('micCheck.rowHint')}
          icon="mic-outline"
          value={micVerdict ? t(VERDICT_SHORT[micVerdict]) : undefined}
          onPress={() => setMicOpen(true)}
        />
      </Section>
      <MicCheckSheet visible={micOpen} onClose={() => setMicOpen(false)} onResult={setMicVerdict} />
      {!access.isPro ? (
        <View style={styles.proRow}>
          <ProBadge />
          <Text variant="caption" muted>
            {t('paywall.benefit4')}
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { height: 220, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#111' },
  pad: { gap: spacing.sm, paddingVertical: spacing.md },
  presetRow: { minHeight: touchTarget + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  presetText: { flex: 1, gap: 2 },
  paceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.sm },
  flex: { flex: 1 },
  proRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' },
});
