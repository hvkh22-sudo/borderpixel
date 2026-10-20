import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { touchTarget } from '../theme/tokens';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
  background?: string;
  size?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** E.g. `flipInRtl()` for direction-bearing glyphs. */
  iconStyle?: StyleProp<TextStyle>;
  /** Stable id for end-to-end tests (Maestro `id:` selector). */
  testID?: string;
}

export function IconButton({ icon, label, onPress, color, background, size = 22, disabled, style, iconStyle, testID }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={8}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: background ?? 'transparent', opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        style,
      ]}
    >
      <Ionicons name={icon} size={size} color={color ?? colors.text} style={iconStyle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, alignItems: 'center', justifyContent: 'center' },
});
