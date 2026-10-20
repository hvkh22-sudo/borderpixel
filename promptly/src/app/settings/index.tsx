import Constants from 'expo-constants';
import { router } from 'expo-router';

import { ListRow } from '../../components/ListRow';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { t } from '../../localization/i18n';
import { DEFAULT_PROMPTER, useSettings, type Appearance } from '../../state/settings';
import { useAccess } from '../../state/access';

const SPEECH_LOCALES = ['en-US', 'en-GB', 'en-AU', 'en-CA', 'en-IN'];

export default function Settings() {
  const appearance = useSettings((s) => s.appearance);
  const speechLocale = useSettings((s) => s.speechLocale);
  const access = useAccess((s) => s.access);
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
