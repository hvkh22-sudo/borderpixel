import { StyleSheet, View } from 'react-native';

import { t } from '../localization/i18n';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export function ProBadge() {
  const { colors } = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
      <Text variant="overline" color={colors.primary}>
        {t('common.pro')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({ badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 } });
