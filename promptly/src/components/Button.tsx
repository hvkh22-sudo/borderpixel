import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing, touchTarget, typography } from '../theme/tokens';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'record';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  /** Stable id for end-to-end tests (Maestro `id:` selector). */
  testID?: string;
}

export function Button({ label, onPress, variant = 'primary', icon, loading, disabled, size = 'md', style, accessibilityHint, testID }: Props) {
  const { colors } = useTheme();
  const bg: Record<Variant, string> = {
    primary: colors.primary,
    secondary: colors.surfaceRaised,
    ghost: 'transparent',
    danger: 'transparent',
    record: colors.record,
  };
  const fg: Record<Variant, string> = {
    primary: colors.onPrimary,
    secondary: colors.text,
    ghost: colors.primary,
    danger: colors.danger,
    record: '#FFFFFF',
  };
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' && styles.lg,
        { backgroundColor: bg[variant], opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'secondary' && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={fg[variant]} />
        ) : icon ? (
          <Ionicons name={icon} size={size === 'lg' ? 22 : 18} color={fg[variant]} />
        ) : null}
        <Text style={[size === 'lg' ? typography.headline : typography.callout, { color: fg[variant], fontWeight: '600' }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lg: { minHeight: 58, paddingHorizontal: spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
