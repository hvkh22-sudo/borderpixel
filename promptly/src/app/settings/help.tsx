import { Linking } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { strings, t } from '../../localization/i18n';
import { config } from '../../services/config';

export default function Help() {
  return (
    <Screen>
      {strings().help.faq.map((item) => (
        <Card key={item.q}>
          <Text variant="headline">{item.q}</Text>
          <Text muted>{item.a}</Text>
        </Card>
      ))}
      {config.supportEmail ? (
        <Button label={t('help.contact')} icon="mail-outline" onPress={() => Linking.openURL(`mailto:${config.supportEmail}`)} />
      ) : (
        <Text variant="caption" muted center>
          {t('help.contactUnavailable')}
        </Text>
      )}
    </Screen>
  );
}
