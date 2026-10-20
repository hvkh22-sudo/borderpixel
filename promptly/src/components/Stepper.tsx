import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { IconButton } from './IconButton';
import { Text } from './Text';

interface Props {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
}

/** Accessible +/- control (works with VoiceOver/TalkBack adjustable actions). */
export function Stepper({ label, value, display, min, max, step, onChange, hint }: Props) {
  const { colors } = useTheme();
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const dec = () => onChange(round(Math.max(min, value - step)));
  const inc = () => onChange(round(Math.min(max, value + step)));
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityValue={{ text: display }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'increment' ? inc() : dec())}
    >
      <View style={styles.text}>
        <Text variant="callout">{label}</Text>
        {hint ? (
          <Text variant="caption" muted>
            {hint}
          </Text>
        ) : null}
      </View>
      <View style={[styles.controls, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
        <IconButton icon="remove" label={`${label} −`} onPress={dec} disabled={value <= min} size={18} />
        <Text variant="callout" style={styles.value}>
          {display}
        </Text>
        <IconButton icon="add" label={`${label} +`} onPress={inc} disabled={value >= max} size={18} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 },
  text: { flex: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  value: { minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'], fontWeight: '600' },
});
