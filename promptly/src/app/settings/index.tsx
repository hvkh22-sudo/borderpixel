import Constants from 'expo-constants';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ListRow } from '../../components/ListRow';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { t } from '../../localization/i18n';
import { PromptlyMedia } from '../../services/nativeMedia';
import { DEFAULT_PROMPTER, useSettings, type Appearance } from '../../state/settings';
import { useAccess } from '../../state/access';
import { spacing } from '../../theme/tokens';

const SPEECH_LOCALES = ['en-US', 'en-GB', 'en-AU', 'en-CA', 'en-IN'];

export default function Settings() {
  const appearance = useSettings((s) => s.appearance);
  const speechLocale = useSettings((s) => s.speechLocale);
  const access = useAccess((s) => s.access);
  const remoteEnabled = useSettings((s) => s.remoteEnabled);
  const remoteRecordToggle = useSettings((s) => s.remoteRecordToggle);
  const set = useSettings.getState().set;

  return (
    <Screen>
      <Section title={t('settings.appearance')}>
        <Segmented<Appearance>
          accessibilityLabel={t('settings.appearance')}
          value={appearance}
          onChange={(v) => set({ appearance: v })}
          options={[
            { value: 'system', label: t('settings.system'), testID: 'appearance-system' },
            { value: 'light', label: t('settings.light'), testID: 'appearance-light' },
            { value: 'dark', label: t('settings.dark'), testID: 'appearance-dark' },
          ]}
        />
      </Section>
      <Section title={t('settings.speechLanguage')}>
        {SPEECH_LOCALES.map((l) => (
          <ListRow key={l} testID={`settings-speech-${l}`} title={l} value={l === speechLocale ? '✓' : undefined} onPress={() => set({ speechLocale: l })} />
        ))}
      </Section>
      <Section title={t('settings.remote')}>
        <ListRow
          testID="settings-remote-enabled"
          title={t('settings.remoteEnabled')}
          subtitle={t('settings.remoteEnabledHint')}
          toggle={{ value: remoteEnabled, onChange: (v) => set({ remoteEnabled: v }) }}
        />
        {remoteEnabled ? (
          <ListRow
            testID="settings-remote-record"
            title={t('settings.remoteRecord')}
            subtitle={t('settings.remoteRecordHint')}
            toggle={{ value: remoteRecordToggle, onChange: (v) => set({ remoteRecordToggle: v }) }}
          />
        ) : null}
        <Text variant="caption" muted style={styles.remoteNote}>
          {PromptlyMedia.remoteKeysAvailable() ? t('settings.remoteSupported') : t('settings.remoteUnavailable')}
        </Text>
      </Section>
      <Section>
        <ListRow testID="settings-subscription" icon="card-outline" title={t('settings.subscription')} value={access.isPro ? (access.source === 'lifetime' ? t('subscription.lifetime') : t('subscription.pro')) : t('subscription.free')} onPress={() => router.push('/settings/subscription')} />
        <ListRow testID="settings-privacy" icon="shield-checkmark-outline" title={t('settings.privacy')} onPress={() => router.push('/settings/privacy')} />
        <ListRow testID="settings-help" icon="help-circle-outline" title={t('settings.help')} onPress={() => router.push('/settings/help')} />
        <ListRow testID="settings-reset-prompter" icon="refresh-outline" title={t('settings.resetPrompter')} onPress={() => useSettings.getState().setPrompter(DEFAULT_PROMPTER)} />
      </Section>
      <Text variant="caption" muted center>
        {t('settings.version', { v: Constants.expoConfig?.version ?? '—' })}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  remoteNote: { paddingVertical: spacing.sm },
});
