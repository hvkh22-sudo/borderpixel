import { Ionicons } from '@expo/vector-icons';
import { useRef, type ComponentRef, type ReactNode } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '../localization/i18n';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../theme/tokens';
import { decorative } from './a11y';
import { Text } from './Text';

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/**
 * Bottom sheet. Screens render one Sheet and swap its content (actions → name
 * form → folder list) instead of stacking modals, which iOS cannot present
 * while another modal is still animating out.
 */
export function Sheet({ visible, onClose, title, children }: Props) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const titleRef = useRef<ComponentRef<typeof View>>(null);
  // Screen readers start on the sheet title rather than wherever the OS puts focus.
  const focusTitle = () => {
    setTimeout(() => {
      if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, 'focus');
    }, 350);
  };
  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? 'fade' : 'slide'} onRequestClose={onClose} onShow={focusTitle} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Tap-outside-to-close for touch users only: every sheet has its own Cancel/Done control,
            and the escape gesture / Android back close it for screen-reader users. */}
        <Pressable testID="sheet-backdrop" style={[styles.flex, styles.backdrop]} onPress={onClose} accessible={false} {...decorative} />
        <SafeAreaView
          edges={['bottom']}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          {title ? (
            <View ref={titleRef} accessible accessibilityRole="header" accessibilityLabel={title} style={styles.title}>
              <Text variant="headline" numberOfLines={3}>
                {title}
              </Text>
            </View>
          ) : null}
          {/* Scrolls when large Dynamic Type or many folders make the content taller than the screen. */}
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
            {children}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface SheetAction {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
  selected?: boolean;
  /** Stable id for end-to-end tests. */
  testID?: string;
}

/** A list of tappable rows for a Sheet. A Cancel row is always added last. */
export function SheetActions({ actions, onCancel }: { actions: SheetAction[]; onCancel: () => void }) {
  const { colors } = useTheme();
  return (
    <View>
      {actions.map((a, i) => (
        <Pressable
          key={`${i}:${a.label}`}
          testID={a.testID}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          accessibilityState={{ selected: !!a.selected }}
          onPress={a.onPress}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
        >
          {a.icon ? <Ionicons {...decorative} name={a.icon} size={22} color={a.destructive ? colors.danger : colors.textMuted} /> : null}
          <Text variant="callout" numberOfLines={2} color={a.destructive ? colors.danger : undefined} style={styles.flex}>
            {a.label}
          </Text>
          {a.selected ? <Ionicons {...decorative} name="checkmark" size={20} color={colors.primary} /> : null}
        </Pressable>
      ))}
      <Pressable
        testID="sheet-cancel"
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
        onPress={onCancel}
        style={({ pressed }) => [styles.row, styles.cancel, { borderTopColor: colors.border }, pressed && { backgroundColor: colors.surfaceRaised }]}
      >
        <Text variant="callout" color={colors.primaryText} center style={[styles.flex, styles.cancelText]}>
          {t('common.cancel')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.35)' },
  panel: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    maxHeight: '92%',
  },
  scroll: { flexGrow: 0 },
  title: { paddingHorizontal: spacing.xs },
  row: { minHeight: touchTarget + 4, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xs, borderRadius: radius.md },
  cancel: { borderTopWidth: StyleSheet.hairlineWidth, borderRadius: 0, marginTop: spacing.xs },
  cancelText: { fontWeight: '600' },
});
