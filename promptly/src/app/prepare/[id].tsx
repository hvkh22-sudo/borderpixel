import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { ListRow } from '../../components/ListRow';
import { ProBadge } from '../../components/ProBadge';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Segmented } from '../../components/Segmented';
import { Stepper } from '../../components/Stepper';
import { Text } from '../../components/Text';
import { checkFeature } from '../../features/monetization/entitlements';
import { MAX_WPM, MIN_WPM, WPM_STEP } from '../../features/teleprompter/scrollModel';
import { Teleprompter } from '../../features/teleprompter/Teleprompter';
import { estimateSpeakingSeconds } from '../../features/voice-follow/text';
import { formatDuration, t } from '../../localization/i18n';
import { flags } from '../../services/config';
import { getRepositories } from '../../services/db';
import { getSpeechCapabilities } from '../../services/speechEngine';
import { useAccess } from '../../state/access';
import { useSettings, type ScrollMode } from '../../state/settings';
import type { Script } from '../../storage/repositories';
import { radius, spacing } from '../../theme/tokens';

export default function Prepare() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [script, setScript] = useState<Script | null>(null);
  const prompter = useSettings((s) => s.prompter);
  const camera = useSettings((s) => s.camera);
  const { setPrompter, setCamera } = useSettings.getState();
  const access = useAccess((s) => s.access);
  const usage = useAccess((s) => s.usage);
  const speech = getSpeechCapabilities();

  useEffect(() => {
    void getRepositories().then((r) => r.scripts.get(id).then(setScript));
  }, [id]);

  const voiceGate = checkFeature('voiceFollow', access, usage);
  const voiceSupported = flags.voiceFollow && speech.available;

  const chooseMode = (mode: ScrollMode) => {
    if (mode === 'voice' && !voiceGate.allowed) {
      router.push('/paywall?trigger=voiceFollow');
      return;
    }
    setPrompter({ mode });
  };
  const mode: ScrollMode = prompter.mode === 'voice' && (!voiceSupported || !voiceGate.allowed) ? 'timed' : prompter.mode;

  const modeHint =
    mode === 'manual' ? t('prepare.modeManualHint') : mode === 'timed' ? t('prepare.modeTimedHint') : t('prepare.modeVoiceHint');

  return (
    <Screen
      footer={<Button label={t('prepare.start')} icon="videocam" variant="record" size="lg" onPress={() => router.push(`/record/${id}?mode=${mode}`)} />}
    >
      <View style={styles.preview} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {script ? (
          <Teleprompter script={script.body} settings={{ ...prompter, mode }} mode="manual" playing={false} followCharOffset={null} />
        ) : null}
      </View>

      <Section title={t('prepare.mode')}>
        <View style={styles.pad}>
          <Segmented
            accessibilityLabel={t('prepare.mode')}
            value={mode}
            onChange={chooseMode}
            options={[
              { value: 'manual', label: t('prepare.modeManual') },
              { value: 'timed', label: t('prepare.modeTimed') },
              ...(voiceSupported ? [{ value: 'voice' as const, label: t('prepare.modeVoice'), badge: access.isPro ? undefined : t('common.pro') }] : []),
            ]}
          />
          <Text variant="caption" muted>
            {modeHint}
          </Text>
          {!voiceSupported ? (
            <Text variant="caption" muted>
              {t('prepare.voiceUnavailable')}
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
              { value: 'front', label: t('prepare.front') },
              { value: 'back', label: t('prepare.back') },
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
          <Text variant="callout">{t('prepare.countdown')}</Text>
          <Segmented
            accessibilityLabel={t('prepare.countdown')}
            value={prompter.countdownSec}
            onChange={(countdownSec) => setPrompter({ countdownSec })}
            options={[0, 3, 5, 10].map((n) => ({ value: n as 0 | 3 | 5 | 10, label: n === 0 ? t('common.off') : t('common.seconds', { n }) }))}
          />
        </View>
      </Section>
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
  proRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' },
});
