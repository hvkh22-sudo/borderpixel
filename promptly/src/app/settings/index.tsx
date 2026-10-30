import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { ListRow } from '../../components/ListRow';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { createTapUnlock } from '../../features/diagnostics/tapUnlock';
import { canonicalSpeechLocale, speechLocaleOptions } from '../../features/settings/speechLocales';
import { currentLanguage, t, type TKey } from '../../localization/i18n';
import { PromptlyMedia } from '../../services/nativeMedia';
import { DEFAULT_PROMPTER, useSettings, type Appearance } from '../../state/settings';
import { useAccess } from '../../state/access';
import { spacing } from '../../theme/tokens';

/** A readable language name for known locales (screen readers spelled out "h e dash I L"); the code otherwise. */
function speechLocaleName(tag: string): string {
  const key = `settings.speechLocaleNames.${tag}` as TKey;
  const name = t(key);
  return name === key ? tag : name;
}

export default function Settings() {
  const appearance = useSettings((s) => s.appearance);
  const speechLocale = useSettings((s) => s.speechLocale);
  const access = useAccess((s) => s.access);
  const remoteEnabled = useSettings((s) => s.remoteEnabled);
  const remoteRecordToggle = useSettings((s) => s.remoteRecordToggle);
  const set = useSettings.getState().set;
  const [tapUnlock] = useState(() => createTapUnlock());

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
        {speechLocaleOptions(speechLocale, currentLanguage()).map((l) => (
          <ListRow key={l} testID={`settings-speech-${l}`} title={speechLocaleName(l)} selected={l === canonicalSpeechLocale(speechLocale)} onPress={() => set({ speechLocale: l })} />
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
      {/* Hidden entry to the diagnostics screen for device testing: tap 5 times. */}
      <Text testID="settings-version" variant="caption" muted center onPress={() => tapUnlock(Date.now()) && router.push('/settings/diagnostics')}>
        {t('settings.version', { v: Constants.expoConfig?.version ?? '—' })}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  remoteNote: { paddingVertical: spacing.sm },
});
