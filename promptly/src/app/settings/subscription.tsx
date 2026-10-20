import { router } from 'expo-router';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { t } from '../../localization/i18n';
import { openManageSubscriptions } from '../../services/purchases';
import { useAccess } from '../../state/access';
import { useTheme } from '../../theme/ThemeProvider';

export default function Subscription() {
  const { colors } = useTheme();
  const access = useAccess((s) => s.access);
  const date = access.expiresAt ? new Date(access.expiresAt).toLocaleDateString() : null;
  return (
    <Screen>
      <Card>
        <Text variant="title">
          {access.source === 'lifetime' ? t('subscription.lifetime') : access.isPro ? t('subscription.pro') : t('subscription.free')}
        </Text>
        {access.source === 'subscription' && date ? (
          <Text muted>{access.willRenew ? t('subscription.renews', { date }) : t('subscription.expires', { date })}</Text>
        ) : null}
        {access.billingIssue ? <Text color={colors.warning}>{t('subscription.billingIssue')}</Text> : null}
      </Card>
      {access.source === 'subscription' ? <Button testID="subscription-manage" label={t('subscription.manage')} variant="secondary" onPress={() => void openManageSubscriptions()} /> : null}
      {access.source !== 'lifetime' ? <Button testID="subscription-upgrade" label={t('subscription.upgrade')} onPress={() => router.push('/paywall')} /> : null}
    </Screen>
  );
}
