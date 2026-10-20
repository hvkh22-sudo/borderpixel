import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { contentDirectionStyle } from '../localization/layoutDirection';
import { FOLDER_NAME_MAX, normalizeFolderName } from '../storage/repositories';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { Button } from './Button';

interface Props {
  placeholder: string;
  submitLabel: string;
  cancelLabel: string;
  initial?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/** Single-line name input for a Sheet (Alert.prompt is iOS-only). */
export function NameForm({ placeholder, submitLabel, cancelLabel, initial = '', onSubmit, onCancel }: Props) {
  const { colors } = useTheme();
  const [value, setValue] = useState(initial);
  const clean = normalizeFolderName(value);
  const submit = () => clean && onSubmit(clean);
  return (
    <View style={styles.wrap}>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={placeholder}
        autoFocus
        maxLength={FOLDER_NAME_MAX}
        returnKeyType="done"
        onSubmitEditing={submit}
        style={[styles.input, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }, contentDirectionStyle(value)]}
      />
      <View style={styles.buttons}>
        <Button label={cancelLabel} variant="ghost" onPress={onCancel} style={styles.flex} />
        <Button label={submitLabel} onPress={submit} disabled={!clean} style={styles.flex} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { gap: spacing.md, paddingBottom: spacing.sm },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, fontSize: 17 },
  buttons: { flexDirection: 'row', gap: spacing.md },
});
