import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { IconButton } from '../components/IconButton';
import { Text } from '../components/Text';
import { SAMPLE_SCRIPT } from '../features/scripts/sample';
import { estimateSpeakingSeconds } from '../features/voice-follow/text';
import { useFocusData } from '../hooks/useAsyncData';
import { formatClock, formatDuration, t } from '../localization/i18n';
import { track } from '../services/analytics';
import { getRepositories } from '../services/db';
import { useSession } from '../state/session';
import { useSettings } from '../state/settings';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';

export default function Home() {
  const { colors } = useTheme();
  const onboardingDone = useSettings((s) => s.onboardingDone);
  const recoveredTakes = useSession((s) => s.recoveredTakes);
  const { data } = useFocusData(async () => {
    const repos = await getRepositories();
    const [scripts, takes] = await Promise.all([repos.scripts.list({ sort: 'recent' }), repos.recordings.list()]);
    return { scripts: scripts.slice(0, 3), takes: takes.slice(0, 3) };
  });

  if (!onboardingDone) return <Redirect href="/onboarding" />;

  const trySample = async () => {
    const repos = await getRepositories();
    const s = await repos.scripts.create(SAMPLE_SCRIPT);
    track({ name: 'script_created', source: 'sample' });
    router.push(`/prepare/${s.id}`);
  };

  const empty = data && data.scripts.length === 0 && data.takes.length === 0;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Text variant="title" accessibilityRole="header">
          Promptly
        </Text>
        <View style={styles.row}>
          <IconButton icon="film-outline" label={t('home.takes')} onPress={() => router.push('/takes')} />
          <IconButton icon="settings-outline" label={t('home.settings')} onPress={() => router.push('/settings')} />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.create')}
          accessibilityHint={t('home.createHint')}
          onPress={() => router.push('/create')}
          style={({ pressed }) => [styles.hero, { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 }]}
        >
          <View style={styles.heroIcon}>
            <Ionicons name="videocam" size={28} color={colors.primary} />
          </View>
          <View style={styles.flex}>
            <Text variant="title" color="#fff">
              {t('home.create')}
            </Text>
            <Text variant="callout" color="rgba(255,255,255,0.85)">
              {t('home.createHint')}
            </Text>
          </View>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>

        {recoveredTakes > 0 ? (
          <Card
            onPress={() => {
              useSession.getState().dismissRecovered();
              router.push('/takes');
            }}
            accessibilityLabel={t('home.recovered', { n: recoveredTakes })}
          >
            <View style={styles.takeRow}>
              <Ionicons name="medkit-outline" size={22} color={colors.warning} />
              <Text variant="callout" style={styles.flex} accessibilityLiveRegion="polite">
                {t('home.recovered', { n: recoveredTakes })}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </View>
          </Card>
        ) : null}

        {empty ? (
          <EmptyState
            icon="sparkles-outline"
            title={t('home.emptyTitle')}
            body={t('home.emptyBody')}
            action={<Button label={t('home.trySample')} variant="secondary" icon="play" onPress={trySample} />}
          />
        ) : null}

        {data && data.scripts.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text variant="headline" accessibilityRole="header">
                {t('home.recentScripts')}
              </Text>
              <Button label={t('home.seeAll')} variant="ghost" onPress={() => router.push('/scripts')} />
            </View>
            {data.scripts.map((s) => (
              <Card key={s.id} onPress={() => router.push(`/scripts/${s.id}`)} accessibilityLabel={s.title}>
                <Text variant="headline" numberOfLines={1}>
                  {s.title}
                </Text>
                <Text muted numberOfLines={2}>
                  {s.body}
                </Text>
                <Text variant="caption" muted>
                  ~{formatDuration(estimateSpeakingSeconds(s.body))}
                </Text>
              </Card>
            ))}
          </View>
        ) : null}

        {data && data.takes.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text variant="headline" accessibilityRole="header">
                {t('home.recentTakes')}
              </Text>
              <Button label={t('home.seeAll')} variant="ghost" onPress={() => router.push('/takes')} />
            </View>
            {data.takes.map((r) => (
              <Card key={r.id} onPress={() => router.push(`/take/${r.id}`)} accessibilityLabel={new Date(r.createdAt).toLocaleString()}>
                <View style={styles.takeRow}>
                  <View style={[styles.thumb, { backgroundColor: colors.surfaceRaised }]}>
                    <Ionicons name="play" size={18} color={colors.text} />
                  </View>
                  <View style={styles.flex}>
                    <Text variant="callout">{new Date(r.createdAt).toLocaleString()}</Text>
                    <Text variant="caption" muted>
                      {formatClock(r.durationMs)}
                      {r.cues ? ` · ${t('takes.captioned')}` : ''}
                    </Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  content: { padding: spacing.lg, gap: spacing.xl },
  hero: { borderRadius: radius.xl, padding: spacing.xl, flexDirection: 'row', alignItems: 'center', gap: spacing.lg, minHeight: 112 },
  heroIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  section: { gap: spacing.md },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  takeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
