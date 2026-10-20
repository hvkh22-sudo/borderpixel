import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { deriveTitle } from '../storage/repositories';
import { t } from '../localization/i18n';
import { track } from '../services/analytics';
import { getRepositories } from '../services/db';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';

export default function Create() {
  const { colors } = useTheme();
  const [message, setMessage] = useState<string | null>(null);

  const createAndOpen = async (body: string, source: 'blank' | 'paste') => {
    const repos = await getRepositories();
    const s = await repos.scripts.create({ title: deriveTitle(body, t('common.untitled')), body });
    track({ name: 'script_created', source });
    router.replace(`/scripts/${s.id}`);
  };

  const paste = async () => {
    const text = (await Clipboard.getStringAsync()).trim();
    if (!text) {
      setMessage(t('create.clipboardEmpty'));
      return;
    }
    await createAndOpen(text, 'paste');
  };

  const options = [
    { icon: 'clipboard-outline', title: t('create.paste'), hint: t('create.pasteHint'), onPress: paste },
    { icon: 'create-outline', title: t('create.blank'), hint: '', onPress: () => createAndOpen('', 'blank') },
    { icon: 'sparkles-outline', title: t('create.ai'), hint: t('create.aiHint'), onPress: () => router.replace('/studio?tool=generate') },
  ] as const;

  return (
    <Screen>
      {options.map((o) => (
        <Pressable
          key={o.title}
          accessibilityRole="button"
          accessibilityLabel={o.title}
          accessibilityHint={o.hint || undefined}
          onPress={o.onPress}
          style={({ pressed }) => [styles.option, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
        >
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name={o.icon} size={22} color={colors.primary} />
          </View>
          <View style={styles.flex}>
            <Text variant="headline">{o.title}</Text>
            {o.hint ? (
              <Text variant="caption" muted>
                {o.hint}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ))}
      {message ? (
        <Text muted center accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
