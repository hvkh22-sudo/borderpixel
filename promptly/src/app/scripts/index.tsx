import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { folderChoiceActions, FolderChips, type LibraryFilter } from '../../components/FolderChips';
import { IconButton } from '../../components/IconButton';
import { NameForm } from '../../components/NameForm';
import { Segmented } from '../../components/Segmented';
import { Sheet, SheetActions } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { estimateSpeakingSeconds } from '../../features/voice-follow/text';
import { useFocusData } from '../../hooks/useAsyncData';
import { formatDuration, t } from '../../localization/i18n';
import { getRepositories } from '../../services/db';
import { useDurationWpm } from '../../state/speakingRate';
import type { FolderWithCount, Script, ScriptSort } from '../../storage/repositories';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';

type SheetState =
  | { kind: 'script'; script: Script }
  | { kind: 'move'; script: Script }
  | { kind: 'newFolder'; moveScript?: Script }
  | { kind: 'folder'; folder: FolderWithCount }
  | { kind: 'rename'; folder: FolderWithCount };

function sheetTitle(sheet: SheetState | null): string | undefined {
  if (!sheet) return undefined;
  if (sheet.kind === 'script') return sheet.script.title;
  if (sheet.kind === 'move') return t('folders.moveTitle', { title: sheet.script.title });
  if (sheet.kind === 'newFolder') return t('folders.newFolder');
  if (sheet.kind === 'folder') return sheet.folder.name;
  return t('folders.renameTitle');
}

export default function Library() {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>({ kind: 'all' });
  const [sort, setSort] = useState<ScriptSort>('updated');
  const [undoId, setUndoId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const paceWpm = useDurationWpm();

  const { data, reload } = useFocusData(async () => {
    const repos = await getRepositories();
    const folders = await repos.folders.listWithCounts();
    // A folder removed meanwhile falls back to All instead of an empty list.
    const folderId = filter.kind === 'folder' && folders.some((f) => f.id === filter.id) ? filter.id : undefined;
    const scripts = await repos.scripts.list({ query, favoritesOnly: filter.kind === 'favorites', sort, folderId });
    return { folders, scripts, folderId };
  }, [query, filter, sort]);
  const scripts = data?.scripts;
  const folders = data?.folders ?? [];
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  const activeFilter: LibraryFilter = filter.kind === 'folder' && data && !data.folderId ? { kind: 'all' } : filter;

  const act = async (fn: (r: Awaited<ReturnType<typeof getRepositories>>) => Promise<unknown>) => {
    setSheet(null);
    await fn(await getRepositories());
    reload();
  };

  const createFolder = (name: string, moveScript?: Script) =>
    act(async (r) => {
      const f = await r.folders.create(name);
      if (moveScript) await r.scripts.moveToFolder(moveScript.id, f.id);
      else setFilter({ kind: 'folder', id: f.id });
    });

  const confirmDeleteFolder = (f: FolderWithCount) => {
    setSheet(null);
    Alert.alert(t('folders.delete'), t('folders.deleteConfirm', { name: f.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          act(async (r) => {
            await r.folders.remove(f.id);
            if (filter.kind === 'folder' && filter.id === f.id) setFilter({ kind: 'all' });
          }),
      },
    ]);
  };

  const showActions = (s: Script) => setSheet({ kind: 'script', script: s });
  const closeSheet = () => setSheet(null);

  const renderSheet = () => {
    if (!sheet) return null;
    if (sheet.kind === 'script') {
      const s = sheet.script;
      return (
        <SheetActions
          onCancel={closeSheet}
          actions={[
            {
              label: s.favorite ? t('library.unfavorite') : t('library.favorite'),
              icon: s.favorite ? 'star' : 'star-outline',
              onPress: () => act((r) => r.scripts.update(s.id, { favorite: !s.favorite })),
            },
            { label: t('library.moveToFolder'), icon: 'folder-open-outline', onPress: () => setSheet({ kind: 'move', script: s }) },
            { label: t('common.duplicate'), icon: 'copy-outline', onPress: () => act((r) => r.scripts.duplicate(s.id, t('common.copySuffix'))) },
            {
              label: t('common.delete'),
              icon: 'trash-outline',
              destructive: true,
              onPress: () =>
                act(async (r) => {
                  await r.scripts.remove(s.id);
                  setUndoId(s.id);
                }),
            },
          ]}
        />
      );
    }
    if (sheet.kind === 'move') {
      const s = sheet.script;
      return (
        <SheetActions
          onCancel={closeSheet}
          actions={folderChoiceActions(
            folders,
            s.folderId,
            (id) => act((r) => r.scripts.moveToFolder(s.id, id)),
            () => setSheet({ kind: 'newFolder', moveScript: s }),
          )}
        />
      );
    }
    if (sheet.kind === 'newFolder') {
      const moveScript = sheet.moveScript;
      return (
        <NameForm
          placeholder={t('folders.namePlaceholder')}
          submitLabel={t('folders.create')}
          cancelLabel={t('common.cancel')}
          onCancel={closeSheet}
          onSubmit={(name) => void createFolder(name, moveScript)}
        />
      );
    }
    const f = sheet.folder;
    if (sheet.kind === 'folder') {
      return (
        <SheetActions
          onCancel={closeSheet}
          actions={[
            { label: t('common.rename'), icon: 'pencil-outline', onPress: () => setSheet({ kind: 'rename', folder: f }) },
            { label: t('folders.delete'), icon: 'trash-outline', destructive: true, onPress: () => confirmDeleteFolder(f) },
          ]}
        />
      );
    }
    return (
      <NameForm
        initial={f.name}
        placeholder={t('folders.namePlaceholder')}
        submitLabel={t('common.save')}
        cancelLabel={t('common.cancel')}
        onCancel={closeSheet}
        onSubmit={(name) => void act((r) => r.folders.rename(f.id, name))}
      />
    );
  };

  const empty = query ? (
    <EmptyState icon="search-outline" title={t('library.emptySearch', { q: query })} />
  ) : activeFilter.kind === 'favorites' ? (
    <EmptyState icon="star-outline" title={t('library.emptyFavorites')} body={t('library.emptyFavoritesHint')} />
  ) : activeFilter.kind === 'folder' ? (
    <EmptyState icon="folder-open-outline" title={t('folders.emptyTitle')} body={t('folders.emptyBody')} />
  ) : (
    <EmptyState icon="document-text-outline" title={t('library.empty')} />
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <IconButton
              icon="add"
              label={t('library.newScript')}
              onPress={async () => {
                // A new script starts in the folder being viewed.
                const folderId = activeFilter.kind === 'folder' ? activeFilter.id : null;
                const s = await (await getRepositories()).scripts.create({ title: t('common.untitled'), body: '', folderId });
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
      </View>
      <FolderChips
        folders={folders}
        value={activeFilter}
        onChange={setFilter}
        onNewFolder={() => setSheet({ kind: 'newFolder' })}
        onManageFolder={(f) => setSheet({ kind: 'folder', folder: f })}
      />
      <View style={styles.controls}>
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
        ListEmptyComponent={scripts ? empty : undefined}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            accessibilityHint={t('common.edit')}
            accessibilityActions={[{ name: 'longpress', label: t('library.moreActions') }]}
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
              <Text variant="caption" muted numberOfLines={1}>
                ~{formatDuration(estimateSpeakingSeconds(item.body, paceWpm))} · {new Date(item.updatedAt).toLocaleDateString()}
                {activeFilter.kind !== 'folder' && item.folderId && folderName.has(item.folderId) ? ` · ${folderName.get(item.folderId)}` : ''}
              </Text>
            </View>
            <IconButton icon="ellipsis-horizontal" label={t('library.moreActions')} onPress={() => showActions(item)} />
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
      <Sheet visible={!!sheet} onClose={closeSheet} title={sheetTitle(sheet)}>
        {renderSheet()}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  controls: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.pill, paddingHorizontal: spacing.lg, borderWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: spacing.sm },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 120, gap: spacing.md },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  snackbar: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xxl, flexDirection: 'row', alignItems: 'center', paddingStart: spacing.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
