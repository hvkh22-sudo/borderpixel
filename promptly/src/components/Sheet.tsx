import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '../localization/i18n';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../theme/tokens';
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
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={[styles.flex, styles.backdrop]} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} />
        <SafeAreaView edges={['bottom']} style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {title ? (
            <Text variant="headline" numberOfLines={2} accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
          ) : null}
          {children}
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
          {a.icon ? <Ionicons name={a.icon} size={22} color={a.destructive ? colors.danger : colors.textMuted} /> : null}
          <Text variant="callout" numberOfLines={1} color={a.destructive ? colors.danger : undefined} style={styles.flex}>
            {a.label}
          </Text>
          {a.selected ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
        </Pressable>
      ))}
      <Pressable
        testID="sheet-cancel"
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
        onPress={onCancel}
        style={({ pressed }) => [styles.row, styles.cancel, { borderTopColor: colors.border }, pressed && { backgroundColor: colors.surfaceRaised }]}
      >
        <Text variant="callout" color={colors.primary} center style={[styles.flex, styles.cancelText]}>
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
  },
  title: { paddingHorizontal: spacing.xs },
  row: { minHeight: touchTarget + 4, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xs, borderRadius: radius.md },
  cancel: { borderTopWidth: StyleSheet.hairlineWidth, borderRadius: 0, marginTop: spacing.xs },
  cancelText: { fontWeight: '600' },
});
