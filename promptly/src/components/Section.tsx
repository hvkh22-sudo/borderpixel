import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { Text } from './Text';

export function Section({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      {title ? (
        <View style={styles.header}>
          <Text variant="overline" muted accessibilityRole="header">
            {title.toUpperCase()}
          </Text>
          {right}
        </View>
      ) : null}
      <View style={[styles.body, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xs },
  body: { borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderWidth: StyleSheet.hairlineWidth },
});
