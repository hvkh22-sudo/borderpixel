import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';

interface Props {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  keyboard?: boolean;
}

export function Screen({ children, scroll = true, edges = ['bottom'], footer, contentStyle, keyboard }: Props) {
  const { colors } = useTheme();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.content, contentStyle]}>{children}</View>
  );
  const inner = (
    <>
      {body}
      {footer ? <View style={[styles.footer, { borderTopColor: colors.border }]}>{footer}</View> : null}
    </>
  );
  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: colors.background }]}>
      {keyboard ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
          {inner}
        </KeyboardAvoidingView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  footer: { padding: spacing.lg, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
