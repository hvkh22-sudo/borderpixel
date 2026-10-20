import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { t } from '../localization/i18n';
import type { Folder, FolderWithCount } from '../storage/repositories';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import type { SheetAction } from './Sheet';
import { Text } from './Text';

/** Library filter: everything, favorites, or one folder. */
export type LibraryFilter = { kind: 'all' } | { kind: 'favorites' } | { kind: 'folder'; id: string };

interface ChipProps {
  label: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  selected?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  count?: number;
  onPress: () => void;
  onLongPress?: () => void;
}

export function Chip({ label, accessibilityLabel, accessibilityHint, selected, icon, count, onPress, onLongPress }: ChipProps) {
  const { colors } = useTheme();
  const fg = selected ? colors.onPrimary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: !!selected }}
      accessibilityActions={onLongPress ? [{ name: 'longpress', label: accessibilityHint }] : undefined}
      onAccessibilityAction={onLongPress}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? colors.primary : colors.surface, borderColor: selected ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={16} color={selected ? colors.onPrimary : colors.textMuted} /> : null}
      <Text variant="callout" color={fg} numberOfLines={1} style={styles.label}>
        {label}
      </Text>
      {count !== undefined ? (
        <Text variant="caption" color={selected ? colors.onPrimary : colors.textMuted}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

interface Props {
  folders: FolderWithCount[];
  value: LibraryFilter;
  onChange: (f: LibraryFilter) => void;
  onNewFolder: () => void;
  onManageFolder: (f: FolderWithCount) => void;
}

/** Horizontal row: All · Favorites · each folder · + New folder. */
export function FolderChips({ folders, value, onChange, onNewFolder, onManageFolder }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel={t('folders.row')}
      keyboardShouldPersistTaps="handled"
    >
      <Chip label={t('library.all')} selected={value.kind === 'all'} onPress={() => onChange({ kind: 'all' })} />
      <Chip label={t('library.favorites')} icon="star-outline" selected={value.kind === 'favorites'} onPress={() => onChange({ kind: 'favorites' })} />
      {folders.map((f) => (
        <Chip
          key={f.id}
          label={f.name}
          icon="folder-outline"
          count={f.scriptCount}
          accessibilityLabel={t('folders.chipLabel', { name: f.name, n: f.scriptCount })}
          accessibilityHint={t('folders.manageHint')}
          selected={value.kind === 'folder' && value.id === f.id}
          onPress={() => onChange({ kind: 'folder', id: f.id })}
          onLongPress={() => onManageFolder(f)}
        />
      ))}
      <Chip label={t('folders.newFolder')} icon="add" onPress={onNewFolder} />
    </ScrollView>
  );
}

/** Sheet rows for choosing a script's folder: No folder, each folder, then New folder. */
export function folderChoiceActions(folders: Folder[], currentId: string | null, onSelect: (id: string | null) => void, onNew: () => void): SheetAction[] {
  return [
    { label: t('folders.noFolder'), icon: 'file-tray-outline', selected: currentId === null, onPress: () => onSelect(null) },
    ...folders.map((f): SheetAction => ({ label: f.name, icon: 'folder-outline', selected: currentId === f.id, onPress: () => onSelect(f.id) })),
    { label: t('folders.newFolder'), icon: 'add', onPress: onNew },
  ];
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, maxWidth: 220 },
  label: { fontWeight: '600', flexShrink: 1 },
});
