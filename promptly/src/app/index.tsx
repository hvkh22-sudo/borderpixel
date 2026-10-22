import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { decorative } from '../components/a11y';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { IconButton } from '../components/IconButton';
import { Text } from '../components/Text';
import { checklistView, type ChecklistStep } from '../features/onboarding/firstRun';
import { FirstRunChecklist } from '../features/onboarding/FirstRunChecklist';
import { sampleScriptFor } from '../features/scripts/sample';
import { estimateSpeakingSeconds } from '../features/voice-follow/text';
import { useFocusData } from '../hooks/useAsyncData';
import { currentLanguage, formatClock, formatDuration, t } from '../localization/i18n';
import { flipInRtl } from '../localization/layoutDirection';
import { track } from '../services/analytics';
import { getRepositories } from '../services/db';
import { useFirstRun } from '../state/firstRun';
import { useSession } from '../state/session';
import { useSettings } from '../state/settings';
import { useDurationWpm } from '../state/speakingRate';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';

export default function Home() {
  const { colors } = useTheme();
  const onboardingDone = useSettings((s) => s.onboardingDone);
  const recoveredTakes = useSession((s) => s.recoveredTakes);
  const paceWpm = useDurationWpm();
  const { data } = useFocusData(async () => {
    const repos = await getRepositories();
    const [scripts, takes] = await Promise.all([repos.scripts.list({ sort: 'recent' }), repos.recordings.list()]);
    return { scripts: scripts.slice(0, 3), takes: takes.slice(0, 3) };
  });
  const firstRunHydrated = useFirstRun((s) => s.hydrated);
  const firstRunFlags = useFirstRun((s) => s.flags);
  const checklist = firstRunHydrated ? checklistView(firstRunFlags) : null;
  const scriptCount = data?.scripts.length ?? 0;
  const takeCount = data?.takes.length ?? 0;
  useEffect(() => {
    if (data && firstRunHydrated) useFirstRun.getState().reconcile({ scripts: scriptCount, takes: takeCount });
  }, [data, firstRunHydrated, scriptCount, takeCount]);

  if (!onboardingDone) return <Redirect href="/onboarding" />;

  const trySample = async () => {
    const repos = await getRepositories();
    const s = await repos.scripts.create(sampleScriptFor(currentLanguage()));
    track({ name: 'script_created', source: 'sample' });
    useFirstRun.getState().complete('firstScriptCreated');
    router.push(`/prepare/${s.id}`);
  };

  const checklistAction = (step: ChecklistStep) => {
    const script = data?.scripts[0];
    const take = data?.takes[0];
    if (step === 'record' && script) return router.push(`/prepare/${script.id}`);
    if (step === 'export' && take) return router.push(`/take/${take.id}`);
    if (step === 'export') return router.push('/takes');
    router.push('/create');
  };

  const empty = data && data.scripts.length === 0 && data.takes.length === 0;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Text variant="title" accessibilityRole="header">
          Promptly
        </Text>
        <View style={styles.row}>
          <IconButton testID="home-takes" icon="film-outline" label={t('home.takes')} onPress={() => router.push('/takes')} />
          <IconButton testID="home-settings" icon="settings-outline" label={t('home.settings')} onPress={() => router.push('/settings')} />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          testID="home-create"
          accessibilityRole="button"
          accessibilityLabel={t('home.create')}
          accessibilityHint={t('home.createHint')}
          onPress={() => router.push('/create')}
          style={({ pressed }) => [styles.hero, { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 }]}
        >
          <View style={styles.heroIcon} {...decorative}>
            <Ionicons name="videocam" size={28} color={colors.primary} />
          </View>
          <View style={styles.flex}>
            <Text variant="title" color="#fff">
              {t('home.create')}
            </Text>
            {/* Full onPrimary: 85 % white on the violet was 3.6:1, below AA for body text. */}
            <Text variant="callout" color={colors.onPrimary}>
              {t('home.createHint')}
            </Text>
          </View>
          <Ionicons {...decorative} name="arrow-forward" size={24} color="#fff" style={flipInRtl()} />
        </Pressable>

        {checklist ? (
          <FirstRunChecklist
            view={checklist}
            onAction={checklistAction}
            onHide={() => useFirstRun.getState().dismiss('checklistHidden', 'checklist_hidden')}
          />
        ) : null}

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
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={flipInRtl()} />
            </View>
          </Card>
        ) : null}

        {empty ? (
          <EmptyState
            icon="sparkles-outline"
            title={t('home.emptyTitle')}
            body={t('home.emptyBody')}
            action={<Button testID="home-try-sample" label={t('home.trySample')} variant="secondary" icon="play" onPress={trySample} />}
          />
        ) : null}

        {data && data.scripts.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text variant="headline" accessibilityRole="header">
                {t('home.recentScripts')}
              </Text>
              <Button testID="home-see-all-scripts" label={t('home.seeAll')} variant="ghost" onPress={() => router.push('/scripts')} />
            </View>
            {data.scripts.map((s) => (
              <Card key={s.id} testID="home-script-item" onPress={() => router.push(`/scripts/${s.id}`)} accessibilityLabel={`${s.title}, ~${formatDuration(estimateSpeakingSeconds(s.body, paceWpm))}`} accessibilityHint={t('a11y.openScriptHint')}>
                <Text variant="headline" numberOfLines={1}>
                  {s.title}
                </Text>
                <Text muted numberOfLines={2}>
                  {s.body}
                </Text>
                <Text variant="caption" muted>
                  ~{formatDuration(estimateSpeakingSeconds(s.body, paceWpm))}
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
              <Button testID="home-see-all-takes" label={t('home.seeAll')} variant="ghost" onPress={() => router.push('/takes')} />
            </View>
            {data.takes.map((r) => (
              <Card key={r.id} testID="home-take-item" onPress={() => router.push(`/take/${r.id}`)} accessibilityLabel={[new Date(r.createdAt).toLocaleString(), formatClock(r.durationMs), r.cues ? t('takes.captioned') : null].filter(Boolean).join(', ')}>
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
