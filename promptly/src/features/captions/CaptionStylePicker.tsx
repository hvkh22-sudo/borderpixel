/** Horizontally scrolling style chips; each chip previews its own look. */
import { Pressable, ScrollView, StyleSheet, Text as RNText, View } from 'react-native';

import { Text } from '../../components/Text';
import { t, type TKey } from '../../localization/i18n';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';
import { CAPTION_STYLE_ORDER, CAPTION_STYLES, type CaptionStyleId } from './captionStyles';

interface Props {
  value: CaptionStyleId;
  onChange: (id: CaptionStyleId) => void;
  /** Show the PRO badge on premium styles. */
  showProBadge: boolean;
}

export function CaptionStylePicker({ value, onChange, showProBadge }: Props) {
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('captions.style.label')}>
      {CAPTION_STYLE_ORDER.map((id) => {
        const s = CAPTION_STYLES[id];
        const label = t(s.nameKey as TKey);
        const badge = s.pro && showProBadge ? t('common.pro') : null;
        const selected = id === value;
        return (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={badge ? `${label}, ${badge}` : label}
            onPress={() => onChange(id)}
            style={[styles.chip, { borderColor: selected ? colors.primary : colors.border, backgroundColor: colors.surface }]}
          >
            <View style={[styles.sample, s.backgroundColor ? { backgroundColor: s.backgroundColor } : null]}>
              <RNText
                maxFontSizeMultiplier={1}
                style={{
                  fontSize: 15,
                  fontWeight: s.fontWeight,
                  color: s.textColor,
                  textShadowColor: s.strokeColor ?? 'transparent',
                  textShadowRadius: s.strokeColor ? 3 : 0,
                }}
              >
                {s.uppercase ? 'AA' : 'Aa'}
                {s.highlightColor ? <RNText style={{ color: s.highlightColor }}>{s.uppercase ? 'A' : 'a'}</RNText> : null}
              </RNText>
            </View>
            <Text variant="caption" numberOfLines={1}>
              {label}
            </Text>
            {badge ? (
              <Text variant="overline" color={colors.primaryText}>
                {badge}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingVertical: 2 },
  chip: { minWidth: 84, minHeight: 44, alignItems: 'center', gap: 4, padding: spacing.sm, borderRadius: radius.md, borderWidth: 2 },
  sample: { height: 30, minWidth: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#3A3A40', paddingHorizontal: 6 },
});
