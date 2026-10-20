import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { estimateSpeakingSeconds } from '../../features/voice-follow/text';
import { useFocusData } from '../../hooks/useAsyncData';
import { formatDuration, t } from '../../localization/i18n';
import { getRepositories } from '../../services/db';
import { useDurationWpm } from '../../state/speakingRate';
import type { Script, ScriptSort } from '../../storage/repositories';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';

export default function Library() {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'favorites'>('all');
  const [sort, setSort] = useState<ScriptSort>('updated');
  const [undoId, setUndoId] = useState<string | null>(null);
  const paceWpm = useDurationWpm();

  const { data: scripts, reload } = useFocusData(
    async () => (await getRepositories()).scripts.list({ query, favoritesOnly: filter === 'favorites', sort }),
    [query, filter, sort],
  );

  const act = async (fn: (r: Awaited<ReturnType<typeof getRepositories>>) => Promise<unknown>) => {
    await fn(await getRepositories());
    reload();
  };

  const showActions = (s: Script) => {
    Alert.alert(s.title, undefined, [
      { text: s.favorite ? t('library.unfavorite') : t('library.favorite'), onPress: () => act((r) => r.scripts.update(s.id, { favorite: !s.favorite })) },
      { text: t('common.duplicate'), onPress: () => act((r) => r.scripts.duplicate(s.id, t('common.copySuffix'))) },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          act(async (r) => {
            await r.scripts.remove(s.id);
            setUndoId(s.id);
          }),
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <IconButton
              icon="add"
              label={t('library.newScript')}
              onPress={async () => {
                const s = await (await getRepositories()).scripts.create({ title: t('common.untitled'), body: '' });
                router.push(`/scripts/${s.id}`);
              }}
            />
          ),
        }}
      />
      <View style={styles.controls}>
        <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('library.search')}
            placeholderTextColor={colors.textMuted}
            style={[styles.searchInput, { color: colors.text }]}
            accessibilityLabel={t('library.search')}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        <Segmented
          accessibilityLabel={t('library.title')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('library.all') },
            { value: 'favorites', label: t('library.favorites') },
          ]}
        />
        <Segmented
          accessibilityLabel={t('library.sortUpdated')}
          value={sort}
          onChange={setSort}
          options={[
            { value: 'updated', label: t('library.sortUpdated') },
            { value: 'recent', label: t('library.sortRecent') },
            { value: 'title', label: t('library.sortTitle') },
          ]}
        />
      </View>
      <FlatList
        data={scripts ?? []}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          scripts ? (
            <EmptyState icon="document-text-outline" title={query ? t('library.emptySearch', { q: query }) : t('library.empty')} />
          ) : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            accessibilityHint={t('common.edit')}
            accessibilityActions={[{ name: 'longpress', label: t('common.edit') }]}
            onAccessibilityAction={() => showActions(item)}
            onPress={() => router.push(`/scripts/${item.id}`)}
            onLongPress={() => showActions(item)}
            style={({ pressed }) => [styles.item, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={styles.flex}>
              <View style={styles.titleRow}>
                {item.favorite ? <Ionicons name="star" size={14} color={colors.warning} /> : null}
                <Text variant="headline" numberOfLines={1} style={styles.flex}>
                  {item.title}
                </Text>
              </View>
              <Text muted numberOfLines={2}>
                {item.body || ' '}
              </Text>
              <Text variant="caption" muted>
                ~{formatDuration(estimateSpeakingSeconds(item.body, paceWpm))} · {new Date(item.updatedAt).toLocaleDateString()}
              </Text>
            </View>
            <IconButton icon="ellipsis-horizontal" label={t('common.edit')} onPress={() => showActions(item)} />
          </Pressable>
        )}
      />
      {undoId ? (
        <View style={[styles.snackbar, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]} accessibilityLiveRegion="polite">
          <Text variant="callout" style={styles.flex}>
            {t('library.deleted')}
          </Text>
          <Button
            label={t('common.undo')}
            variant="ghost"
            onPress={() =>
              act(async (r) => {
                await r.scripts.restore(undoId);
                setUndoId(null);
              })
            }
          />
          <IconButton icon="close" label={t('common.close')} onPress={() => setUndoId(null)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  controls: { padding: spacing.lg, gap: spacing.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.pill, paddingHorizontal: spacing.lg, borderWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: spacing.sm },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 120, gap: spacing.md },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  snackbar: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xxl, flexDirection: 'row', alignItems: 'center', paddingStart: spacing.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
