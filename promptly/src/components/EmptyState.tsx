import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { Text } from './Text';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, body, action }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={30} color={colors.primary} />
      </View>
      <Text variant="headline" center>
        {title}
      </Text>
      {body ? (
        <Text muted center>
          {body}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
