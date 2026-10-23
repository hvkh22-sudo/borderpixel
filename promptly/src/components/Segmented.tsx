import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { Text } from './Text';

interface Option<T extends string | number> {
  value: T;
  label: string;
  badge?: string;
  /** Stable id for end-to-end tests. */
  testID?: string;
}

interface Props<T extends string | number> {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  accessibilityLabel: string;
}

export function Segmented<T extends string | number>({ options, value, onChange, accessibilityLabel }: Props<T>) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={[styles.wrap, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            testID={o.testID}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.badge ? `${o.label}, ${o.badge}` : o.label}
            onPress={() => onChange(o.value)}
            // 44pt segment + 4pt slop (inside the track padding) = 52pt hit area for Android's 48dp.
            hitSlop={4}
            style={[styles.item, selected && { backgroundColor: colors.primary }]}
          >
            {/* A one-word label shrinks rather than breaking mid-word at large text sizes ("Syste/m"). */}
            <Text
              variant="callout"
              color={selected ? colors.onPrimary : colors.text}
              style={styles.label}
              numberOfLines={/\s/.test(o.label.trim()) ? 2 : 1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {o.label}
            </Text>
            {o.badge ? (
              <Text variant="overline" color={selected ? colors.onPrimary : colors.primaryText}>
                {o.badge}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', borderRadius: radius.pill, padding: 4, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  item: { flex: 1, minHeight: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, flexDirection: 'row', gap: 4 },
  label: { fontWeight: '600', textAlign: 'center', flexShrink: 1 },
});
