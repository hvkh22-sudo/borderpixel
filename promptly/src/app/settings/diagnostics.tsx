/**
 * Hidden diagnostics screen for device testing: tap the version text in
 * Settings 5 times, or open promptly://settings/diagnostics. Shows device
 * facts and feature decisions, the recent error log and per-device test
 * overrides, and copies a plain-text report (no user content) to paste into a
 * chat with Claude.
 */
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { ListRow } from '../../components/ListRow';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { formatDiagnosticsReport, type DiagnosticsData } from '../../features/diagnostics/report';
import type { IosVoiceFollowAudio } from '../../features/platform/audioStrategy';
import type { Support } from '../../features/platform/support';
import { useAnnounce } from '../../hooks/useAnnounce';
import { t, type TKey } from '../../localization/i18n';
import { config } from '../../services/config';
import { collectDiagnostics } from '../../services/diagnostics';
import { diagnosticsLog } from '../../services/diagnosticsLog';
import { useDiagnosticsOverrides, type FlagOverride } from '../../services/diagnosticsOverrides';
import { useSettings } from '../../state/settings';
import { spacing } from '../../theme/tokens';

type StrategyChoice = 'default' | IosVoiceFollowAudio;

const yn = (b: boolean) => (b ? t('diagnostics.yes') : t('diagnostics.no'));
const supportText = (s: Support) => (s.ok ? t('diagnostics.supported') : t(`support.${s.reason}`));
const onOff = (b: boolean) => (b ? t('common.on') : t('common.off'));
const FLAG_LABELS: Record<string, TKey> = {
  voiceFollow: 'diagnostics.voiceFollow',
  captions: 'diagnostics.captions',
  burnIn: 'diagnostics.burnIn',
  aiStudio: 'diagnostics.aiStudio',
};

export default function Diagnostics() {
  const speechLocale = useSettings((s) => s.speechLocale);
  const iosVfAudio = useDiagnosticsOverrides((s) => s.iosVoiceFollowAudio);
  const burnIn = useDiagnosticsOverrides((s) => s.burnIn);
  const integrityHeaders = useDiagnosticsOverrides((s) => s.integrityHeaders);
  const setOverrides = useDiagnosticsOverrides((s) => s.set);
  const resetOverrides = useDiagnosticsOverrides((s) => s.reset);
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useAnnounce(notice);

  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);

  // Re-read after every override change so decisions on screen match what the next take uses.
  useEffect(() => {
    let alive = true;
    collectDiagnostics(speechLocale).then(
      (d) => alive && setData(d),
      // Each fact is read defensively; a total failure leaves the previous data on screen.
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [speechLocale, iosVfAudio, burnIn, integrityHeaders, revision]);

  const copy = async () => {
    try {
      const fresh = await collectDiagnostics(speechLocale);
      setData(fresh);
      await Clipboard.setStringAsync(formatDiagnosticsReport(fresh));
      setNotice(t('diagnostics.copied'));
    } catch {
      setNotice(t('diagnostics.copyFailed'));
    }
  };

  const strategy: StrategyChoice = iosVfAudio ?? 'default';

  return (
    <Screen>
      <Text variant="caption" muted>
        {t('diagnostics.intro')}
      </Text>
      <Button testID="diagnostics-copy" label={t('diagnostics.copy')} icon="copy-outline" onPress={() => void copy()} />
      {notice ? (
        <Text testID="diagnostics-notice" variant="caption" center accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}

      <Section title={t('diagnostics.testing')}>
        <Text variant="callout">{t('diagnostics.iosVfAudio')}</Text>
        <Segmented<StrategyChoice>
          accessibilityLabel={t('diagnostics.iosVfAudio')}
          value={strategy}
          onChange={(v) => void setOverrides({ iosVoiceFollowAudio: v === 'default' ? null : v })}
          options={[
            {
              value: 'default',
              label: t('diagnostics.strategyDefault', {
                v: config.iosVoiceFollowAudio === 'separate' ? t('diagnostics.strategySeparate') : t('diagnostics.strategyShared'),
              }),
              testID: 'diagnostics-vf-default',
            },
            { value: 'shared', label: t('diagnostics.strategyShared'), testID: 'diagnostics-vf-shared' },
            { value: 'separate', label: t('diagnostics.strategySeparate'), testID: 'diagnostics-vf-separate' },
          ]}
        />
        <Text variant="caption" muted style={styles.hint}>
          {t('diagnostics.iosVfAudioHint')}
        </Text>
        <Text variant="callout">{t('diagnostics.burnInOverride')}</Text>
        <Segmented<FlagOverride>
          accessibilityLabel={t('diagnostics.burnInOverride')}
          value={burnIn}
          onChange={(v) => void setOverrides({ burnIn: v })}
          options={[
            { value: 'default', label: t('diagnostics.overrideDefault'), testID: 'diagnostics-burnin-default' },
            { value: 'on', label: t('common.on'), testID: 'diagnostics-burnin-on' },
            { value: 'off', label: t('common.off'), testID: 'diagnostics-burnin-off' },
          ]}
        />
        <Text variant="caption" muted style={styles.hint}>
          {t('diagnostics.burnInHint')}
        </Text>
        <ListRow
          testID="diagnostics-integrity"
          title={t('diagnostics.integrity')}
          subtitle={t('diagnostics.integrityHint')}
          toggle={{ value: integrityHeaders, onChange: (v) => void setOverrides({ integrityHeaders: v }) }}
        />
        <ListRow testID="diagnostics-reset" icon="refresh-outline" title={t('diagnostics.resetOverrides')} onPress={() => void resetOverrides()} />
      </Section>

      {data ? (
        <View testID="diagnostics-facts">
          <Section title={t('diagnostics.app')}>
            <ListRow title={t('diagnostics.version')} value={data.app.version} />
            <ListRow title={t('diagnostics.build')} value={data.app.build} />
            <ListRow title={t('diagnostics.runtime')} subtitle={data.app.runtime} />
          </Section>

          <Section title={t('diagnostics.device')}>
            <ListRow title={t('diagnostics.os')} value={`${data.os.name} ${data.os.version}`} />
            {data.device.os === 'android' ? <ListRow title={t('diagnostics.androidApi')} value={String(data.device.androidApiLevel)} /> : null}
            <ListRow title={t('diagnostics.recognizer')} value={yn(data.device.recognitionAvailable)} />
            <ListRow title={t('diagnostics.onDevice')} value={yn(data.device.onDeviceRecognition)} />
            <ListRow title={t('diagnostics.persistAudio')} value={yn(data.device.recognizerCanPersistAudio)} />
            <ListRow title={t('diagnostics.mediaModule')} value={yn(data.device.mediaModuleAvailable)} />
            <ListRow title={t('diagnostics.remoteKeys')} value={yn(data.device.remoteKeys)} />
          </Section>

          <Section title={t('diagnostics.support')}>
            <ListRow testID="diagnostics-support-vf" title={t('diagnostics.voiceFollow')} subtitle={supportText(data.support.voiceFollow)} />
            <ListRow title={t('diagnostics.captions')} subtitle={supportText(data.support.captions)} />
            <ListRow testID="diagnostics-support-burnin" title={t('diagnostics.burnIn')} subtitle={supportText(data.support.burnIn)} />
            <ListRow
              testID="diagnostics-vf-audio"
              title={t('diagnostics.vfAudio')}
              value={data.voiceFollowAudio.plan.separateAudio ? t('diagnostics.vfAudioSeparate') : t('diagnostics.vfAudioShared')}
              subtitle={t(`diagnostics.planReasons.${data.voiceFollowAudio.plan.reason}`)}
            />
          </Section>

          <Section title={t('diagnostics.locales')}>
            <Text>{t('diagnostics.localeCurrent', { l: data.speechLocales.current })}</Text>
            {data.speechLocales.error ? (
              <Text variant="caption" muted>
                {t('diagnostics.localesError')}
              </Text>
            ) : (
              <>
                {!data.speechLocales.supported.includes(data.speechLocales.current) ? (
                  <Text variant="caption">{t('diagnostics.localeNotSupported')}</Text>
                ) : null}
                <Text variant="caption" muted testID="diagnostics-locales">
                  {t('diagnostics.localeSupported', { n: data.speechLocales.supported.length })}: {data.speechLocales.supported.join(', ')}
                </Text>
                <Text variant="caption" muted>
                  {t('diagnostics.localeInstalled', { n: data.speechLocales.installed.length })}
                  {data.speechLocales.installed.length ? `: ${data.speechLocales.installed.join(', ')}` : ''}
                </Text>
              </>
            )}
          </Section>

          <Section title={t('diagnostics.flags')}>
            {Object.keys(data.flags.build).map((k) => (
              <ListRow
                key={k}
                title={FLAG_LABELS[k] ? t(FLAG_LABELS[k]) : k}
                subtitle={t('diagnostics.flagValue', { build: onOff(!!data.flags.build[k]), now: onOff(!!data.flags.effective[k]) })}
              />
            ))}
          </Section>

          <Section title={t('diagnostics.services')}>
            <ListRow title={t('diagnostics.purchases')} value={yn(data.services.purchasesConfigured)} />
            <ListRow title={t('diagnostics.aiUrl')} value={data.services.aiBaseUrlSet ? t('diagnostics.set') : t('diagnostics.notSet')} />
          </Section>

          <Section title={t('diagnostics.errors')}>
            {data.errors.length === 0 ? (
              <Text variant="caption" muted>
                {t('diagnostics.errorsEmpty')}
              </Text>
            ) : (
              [...data.errors].reverse().map((e, i) => (
                <Text key={`${e.at}-${i}`} variant="caption" testID="diagnostics-error">
                  {new Date(e.at).toLocaleString()} · {e.source} · {e.code}
                  {e.message ? ` — ${e.message}` : ''}
                </Text>
              ))
            )}
            {data.errors.length > 0 ? (
              <ListRow
                testID="diagnostics-clear-errors"
                icon="trash-outline"
                title={t('diagnostics.clearErrors')}
                onPress={() => void diagnosticsLog.clear().then(refresh)}
              />
            ) : null}
          </Section>
        </View>
      ) : (
        <Text muted center>
          {t('common.loading')}
        </Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { paddingBottom: spacing.sm },
});
