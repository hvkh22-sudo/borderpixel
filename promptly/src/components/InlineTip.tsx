import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAnnounce } from '../hooks/useAnnounce';
import { t } from '../localization/i18n';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { decorative } from './a11y';
import { IconButton } from './IconButton';
import { Text } from './Text';

interface Props {
  /** Main tip text; announced politely (live region on Android, announcement on iOS). */
  message: string;
  /** Optional secondary line(s). */
  children?: ReactNode;
  icon?: keyof typeof Ionicons.glyphMap;
  onDismiss: () => void;
  testID?: string;
}

/** Inline, dismissible hint (not a modal): never blocks the flow it sits in. */
export function InlineTip({ message, children, icon = 'bulb-outline', onDismiss, testID }: Props) {
  const { colors } = useTheme();
  useAnnounce(message);
  return (
    <View testID={testID} style={[styles.tip, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
      <Ionicons {...decorative} name={icon} size={20} color={colors.primaryText} style={styles.icon} />
      <View style={styles.body}>
        <Text variant="callout" color={colors.text} accessibilityLiveRegion="polite">
          {message}
        </Text>
        {children}
      </View>
      <IconButton testID={testID ? `${testID}-dismiss` : undefined} icon="close" label={t('firstRun.dismissTip')} color={colors.text} size={18} onPress={onDismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  tip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingStart: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: { marginTop: spacing.md },
  body: { flex: 1, gap: 2, paddingVertical: spacing.sm },
});
