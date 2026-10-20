import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Text } from '../components/Text';
import { t } from '../localization/i18n';
import { track } from '../services/analytics';
import { useSettings } from '../state/settings';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';

const POINTS = [
  { icon: 'eye-off-outline', key: 'onboarding.point1' },
  { icon: 'mic-outline', key: 'onboarding.point2' },
  { icon: 'text-outline', key: 'onboarding.point3' },
] as const;

/** One screen, no account, no paywall: get the user to their first take. */
export default function Onboarding() {
  const { colors } = useTheme();
  const finish = () => {
    useSettings.getState().set({ onboardingDone: true });
    track({ name: 'onboarding_completed' });
    router.replace('/');
  };
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.body}>
        <View style={[styles.logo, { backgroundColor: colors.primary }]}>
          <Ionicons name="reader-outline" size={34} color="#fff" />
        </View>
        <Text variant="display" accessibilityRole="header">
          {t('onboarding.title')}
        </Text>
        <Text muted>{t('onboarding.subtitle')}</Text>
        <View style={styles.points}>
          {POINTS.map((p) => (
            <View key={p.key} style={styles.point}>
              <View style={[styles.pointIcon, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name={p.icon} size={20} color={colors.primary} />
              </View>
              <Text variant="callout" style={styles.flex}>
                {t(p.key)}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.footer}>
        <Button testID="onboarding-start" label={t('onboarding.start')} onPress={finish} size="lg" />
        <Text variant="caption" muted center>
          {t('onboarding.privacy')}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flex: 1, padding: spacing.xl, gap: spacing.lg, justifyContent: 'center' },
  logo: { width: 64, height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  points: { gap: spacing.md, marginTop: spacing.md },
  point: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pointIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  footer: { padding: spacing.xl, gap: spacing.md },
});
