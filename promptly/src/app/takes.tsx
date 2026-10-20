import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { memo, useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { EmptyState } from '../components/EmptyState';
import { Text } from '../components/Text';
import { useFocusData } from '../hooks/useAsyncData';
import { formatClock, t } from '../localization/i18n';
import { flipInRtl } from '../localization/layoutDirection';
import { getRepositories } from '../services/db';
import type { Recording } from '../storage/repositories';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';

type Colors = ReturnType<typeof useTheme>['colors'];

const openTake = (id: string) => router.push(`/take/${id}`);

/** Memoized row: list re-renders (focus reloads) only touch rows whose recording changed. */
const TakeRow = memo(function TakeRow({ item, colors }: { item: Recording; colors: Colors }) {
  const when = new Date(item.createdAt).toLocaleString();
  return (
    <Pressable
      testID="takes-item"
      accessibilityRole="button"
      accessibilityLabel={`${when}, ${formatClock(item.durationMs)}`}
      onPress={() => openTake(item.id)}
      style={({ pressed }) => [styles.row, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.thumb, { backgroundColor: colors.surfaceRaised }]}>
        <Ionicons name="play" size={18} color={colors.text} />
      </View>
      <View style={styles.flex}>
        <Text variant="callout">{when}</Text>
        <Text variant="caption" muted>
          {formatClock(item.durationMs)}
          {item.cues ? ` · ${t('takes.captioned')}` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={flipInRtl()} />
    </Pressable>
  );
});

const keyOf = (r: Recording) => r.id;

export default function Takes() {
  const { colors } = useTheme();
  const { data } = useFocusData(async () => (await getRepositories()).recordings.list());
  const renderItem = useCallback(({ item }: { item: Recording }) => <TakeRow item={item} colors={colors} />, [colors]);
  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      data={data ?? []}
      keyExtractor={keyOf}
      ListEmptyComponent={data ? <EmptyState icon="film-outline" title={t('takes.empty')} body={t('takes.emptyBody')} /> : undefined}
      renderItem={renderItem}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  thumb: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
