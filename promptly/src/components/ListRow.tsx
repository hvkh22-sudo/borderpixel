import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { spacing, touchTarget } from '../theme/tokens';
import { flipInRtl } from '../localization/layoutDirection';
import { decorative } from './a11y';
import { Text } from './Text';

interface Props {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  value?: string;
  onPress?: () => void;
  toggle?: { value: boolean; onChange: (v: boolean) => void };
  /** Single-choice rows (e.g. speech language): shows a checkmark and exposes the selected state. */
  selected?: boolean;
  right?: ReactNode;
  destructive?: boolean;
  /** Stable id for end-to-end tests: on the row when tappable, else on the switch, else on the row. */
  testID?: string;
}

export function ListRow({ title, subtitle, icon, value, onPress, toggle, selected, right, destructive, testID }: Props) {
  const { colors } = useTheme();
  // Toggle rows: the native Switch is the accessibility element (label + hint), so the
  // visible text is hidden from AT to avoid reading it twice.
  const textA11y = toggle ? decorative : null;
  const content = (
    <View style={styles.row} testID={!onPress && !toggle ? testID : undefined}>
      {icon ? <Ionicons {...decorative} name={icon} size={22} color={destructive ? colors.danger : colors.textMuted} /> : null}
      <View style={styles.text} {...textA11y}>
        <Text variant="callout" color={destructive ? colors.danger : undefined}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" muted>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="callout" muted style={styles.value}>
          {value}
        </Text>
      ) : null}
      {selected ? <Ionicons {...decorative} name="checkmark" size={20} color={colors.primary} /> : null}
      {right}
      {toggle ? (
        <Switch
          testID={testID}
          value={toggle.value}
          onValueChange={toggle.onChange}
          trackColor={{ true: colors.primary }}
          // Android otherwise paints the thumb with the platform accent (teal), off-palette.
          thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
          accessibilityLabel={title}
          accessibilityHint={subtitle}
        />
      ) : null}
      {onPress && !toggle ? <Ionicons {...decorative} name="chevron-forward" size={18} color={colors.textMuted} style={flipInRtl()} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityValue={value ? { text: value } : undefined}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      style={({ pressed }) => pressed && { opacity: 0.7 }}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: touchTarget + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  text: { flex: 1, gap: 2 },
  value: { flexShrink: 1, maxWidth: '45%' },
});
