import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { spacing, touchTarget } from '../theme/tokens';
import { Text } from './Text';

interface Props {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  value?: string;
  onPress?: () => void;
  toggle?: { value: boolean; onChange: (v: boolean) => void };
  right?: ReactNode;
  destructive?: boolean;
}

export function ListRow({ title, subtitle, icon, value, onPress, toggle, right, destructive }: Props) {
  const { colors } = useTheme();
  const content = (
    <View style={styles.row}>
      {icon ? <Ionicons name={icon} size={22} color={destructive ? colors.danger : colors.textMuted} /> : null}
      <View style={styles.text}>
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
        <Text variant="callout" muted>
          {value}
        </Text>
      ) : null}
      {right}
      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          trackColor={{ true: colors.primary }}
          accessibilityLabel={title}
        />
      ) : null}
      {onPress && !toggle ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={subtitle} onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: touchTarget + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  text: { flex: 1, gap: 2 },
});
