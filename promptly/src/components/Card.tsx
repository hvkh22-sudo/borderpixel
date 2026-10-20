import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';

interface Props {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  /** Stable id for end-to-end tests. */
  testID?: string;
}

export function Card({ children, onPress, onLongPress, accessibilityLabel, style, testID }: Props) {
  const { colors } = useTheme();
  const base = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style];
  if (!onPress) return <View testID={testID} style={base}>{children}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, gap: spacing.sm },
});
