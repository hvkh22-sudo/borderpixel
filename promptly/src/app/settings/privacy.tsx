import { router } from 'expo-router';
import { useRef } from 'react';
import { Alert, Linking } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ListRow } from '../../components/ListRow';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { t } from '../../localization/i18n';
import { setAnalyticsEnabled } from '../../services/analytics';
import { shareScriptsBackup } from '../../services/backupExport';
import { config } from '../../services/config';
import { getRepositories } from '../../services/db';
import { deleteRecordingFile } from '../../services/files';
import { useSettings } from '../../state/settings';
import { backupFileName, collectBackup, serializeBackup } from '../../storage/backup';

export default function Privacy() {
  const analyticsEnabled = useSettings((s) => s.analyticsEnabled);
  const exporting = useRef(false);

  const exportScripts = async () => {
    if (exporting.current) return;
    exporting.current = true;
    try {
      const data = await collectBackup(await getRepositories());
      if (data.scripts.length === 0) {
        Alert.alert(t('privacy.exportEmpty'));
        return;
      }
      const now = new Date();
      const result = await shareScriptsBackup(serializeBackup(data, now.getTime()), backupFileName(now), t('privacy.exportDialogTitle'));
      if (result === 'unavailable') Alert.alert(t('privacy.shareUnavailable'));
    } catch {
      Alert.alert(t('privacy.exportFailed'));
    } finally {
      exporting.current = false;
    }
  };

  const deleteAll = () =>
    Alert.alert(t('privacy.deleteAll'), t('privacy.deleteAllConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const repos = await getRepositories();
          for (const r of await repos.recordings.list()) {
            deleteRecordingFile(r.fileName);
            await repos.recordings.remove(r.id);
          }
          for (const s of await repos.scripts.list()) await repos.scripts.remove(s.id);
          await repos.scripts.purgeDeleted(Number.MAX_SAFE_INTEGER);
          await repos.folders.clearAll();
          await repos.kv.clearAll();
          useSettings.getState().reset();
          Alert.alert(t('privacy.deleted'));
          router.replace('/');
        },
      },
    ]);

  return (
    <Screen>
      <Card>
        <Text>{t('privacy.localFirst')}</Text>
        <Text muted>{t('privacy.ai')}</Text>
        <Text muted>{t('privacy.speech')}</Text>
      </Card>
      <Section>
        <ListRow
          title={t('privacy.analytics')}
          subtitle={t('privacy.analyticsHint')}
          toggle={{
            value: analyticsEnabled,
            onChange: (v) => {
              useSettings.getState().set({ analyticsEnabled: v });
              setAnalyticsEnabled(v);
            },
          }}
        />
        {config.privacyUrl ? <ListRow title={t('privacy.policy')} onPress={() => Linking.openURL(config.privacyUrl)} /> : null}
      </Section>
      <Section>
        <ListRow title={t('privacy.exportScripts')} subtitle={t('privacy.exportHint')} icon="share-outline" onPress={() => void exportScripts()} />
      </Section>
      <Button label={t('privacy.deleteAll')} variant="danger" icon="trash-outline" onPress={deleteAll} />
    </Screen>
  );
}
