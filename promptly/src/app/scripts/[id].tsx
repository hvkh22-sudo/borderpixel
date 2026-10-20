import * as Clipboard from 'expo-clipboard';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { Chip, folderChoiceActions } from '../../components/FolderChips';
import { IconButton } from '../../components/IconButton';
import { NameForm } from '../../components/NameForm';
import { Screen } from '../../components/Screen';
import { Sheet, SheetActions } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { createHistory, currentText, pushVersion, redo, undo, type VersionHistory } from '../../features/ai-script-studio/studio';
import { countWords, estimateSpeakingSeconds } from '../../features/voice-follow/text';
import { formatDuration, t } from '../../localization/i18n';
import { contentDirectionStyle, flipInRtl } from '../../localization/layoutDirection';
import { getRepositories } from '../../services/db';
import { deriveTitle, type Folder } from '../../storage/repositories';
import { useDurationWpm } from '../../state/speakingRate';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing, typography } from '../../theme/tokens';

const AUTOSAVE_MS = 600;
const UNDO_SNAPSHOT_MS = 1200;

export default function Editor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  // Personal pace when learned, else the default (not the Timed scroll speed).
  const wpm = useDurationWpm();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [history, setHistory] = useState<VersionHistory>(() => createHistory('', Date.now()));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title: '', body: '', dirty: false });
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderSheet, setFolderSheet] = useState<'pick' | 'new' | null>(null);

  // Untitled (or auto-titled) scripts keep taking their title from the first line until the user edits the title.
  const autoTitle = useRef(false);
  const loadedOnce = useRef(false);

  // Load on first focus, and reload when returning from a modal (AI Studio applies drafts and restores
  // versions directly in storage). Pending local edits win; they are flushed before Studio opens.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const repos = await getRepositories();
        const s = await repos.scripts.get(id);
        if (!alive) return;
        if (loadedOnce.current) {
          if (!s || latest.current.dirty) return;
          if (s.body === latest.current.body && s.title === latest.current.title) return;
          if (snapTimer.current) clearTimeout(snapTimer.current);
          latest.current = { title: s.title, body: s.body, dirty: false };
          setTitle(s.title);
          setBody(s.body);
          // The stored text becomes the newest history version, so undo returns to the pre-AI text.
          setHistory((h) => pushVersion(h, s.body, 'manual', Date.now()));
          return;
        }
        if (!s) {
          setMissing(true);
          return;
        }
        await repos.scripts.markOpened(id);
        const allFolders = await repos.folders.list();
        if (!alive) return;
        loadedOnce.current = true;
        const untitled = t('common.untitled');
        autoTitle.current = s.title === '' || s.title === untitled || s.title === deriveTitle(s.body, untitled);
        setFolders(allFolders);
        setFolderId(s.folderId);
        setTitle(s.title);
        setBody(s.body);
        latest.current = { title: s.title, body: s.body, dirty: false };
        setHistory(createHistory(s.body, Date.now()));
        setLoaded(true);
      })();
      return () => {
        alive = false;
      };
    }, [id]),
  );

  const flush = useCallback(async () => {
    if (!latest.current.dirty) return;
    const pending = latest.current;
    pending.dirty = false;
    setSaveState('saving');
    try {
      const repos = await getRepositories();
      await repos.scripts.update(id, { title: pending.title, body: pending.body });
      if (!latest.current.dirty) setSaveState('saved');
    } catch (e) {
      // Not saved: stay dirty so the next change, background or leaving the screen retries.
      if (latest.current === pending) pending.dirty = true;
      if (__DEV__) console.warn('script save failed', e);
    }
  }, [id]);

  // Save immediately when the app backgrounds or the screen unmounts.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && void flush());
    return () => {
      sub.remove();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (snapTimer.current) clearTimeout(snapTimer.current);
      void flush();
    };
  }, [flush]);

  const schedule = (nextTitle: string, nextBody: string) => {
    latest.current = { title: nextTitle, body: nextBody, dirty: true };
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
  };

  const onBody = (text: string) => {
    setBody(text);
    const nextTitle = autoTitle.current ? deriveTitle(text, t('common.untitled')) : title;
    if (nextTitle !== title) setTitle(nextTitle);
    schedule(nextTitle, text);
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => setHistory((h) => pushVersion(h, text, 'manual', Date.now())), UNDO_SNAPSHOT_MS);
  };

  const applyHistory = (h: VersionHistory) => {
    if (snapTimer.current) clearTimeout(snapTimer.current);
    setHistory(h);
    const text = currentText(h);
    setBody(text);
    schedule(title, text);
  };

  const pasteAppend = async () => {
    const clip = await Clipboard.getStringAsync();
    if (!clip) return;
    const next = body ? `${body}\n\n${clip}` : clip;
    setHistory((h) => pushVersion(pushVersion(h, body, 'manual', Date.now()), next, 'manual', Date.now()));
    onBody(next);
  };

  const openFolderPicker = async () => {
    setFolders(await (await getRepositories()).folders.list());
    setFolderSheet('pick');
  };

  const moveTo = async (next: string | null) => {
    setFolderSheet(null);
    await (await getRepositories()).scripts.moveToFolder(id, next);
    setFolderId(next);
  };

  const createFolderAndMove = async (name: string) => {
    const repos = await getRepositories();
    const f = await repos.folders.create(name);
    setFolders(await repos.folders.list());
    await moveTo(f.id);
  };

  const startRecording = async () => {
    if (!body.trim()) {
      Alert.alert(t('editor.emptyRecord'));
      return;
    }
    await flush();
    router.push(`/prepare/${id}`);
  };

  if (missing) {
    return (
      <Screen>
        <Text center>{t('errors.notFound')}</Text>
      </Screen>
    );
  }

  const words = countWords(body);
  const folderLabel = folders.find((f) => f.id === folderId)?.name ?? t('folders.noFolder');
  // Make sure an in-progress edit is part of history before undoing.
  const pendingSnapshot = () => (currentText(history) !== body ? pushVersion(history, body, 'manual', Date.now()) : history);

  return (
    <Screen
      scroll={false}
      keyboard
      contentStyle={styles.content}
      footer={
        <View style={styles.footerRow}>
          <Button testID="editor-ai" label={t('editor.aiImprove')} icon="sparkles-outline" variant="secondary" onPress={async () => (await flush(), router.push(`/studio?scriptId=${id}`))} />
          <Button testID="editor-record" label={t('editor.record')} icon="videocam" variant="record" onPress={startRecording} style={styles.flex} />
        </View>
      }
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              <IconButton testID="editor-undo" icon="arrow-undo" iconStyle={flipInRtl()} label={t('common.undo')} disabled={history.current === 0 && currentText(history) === body} onPress={() => applyHistory(undo(pendingSnapshot()))} />
              <IconButton testID="editor-redo" icon="arrow-redo" iconStyle={flipInRtl()} label={t('common.redo')} disabled={history.current >= history.versions.length - 1} onPress={() => applyHistory(redo(history))} />
              <IconButton testID="editor-paste" icon="clipboard-outline" label={t('editor.pasteAppend')} onPress={pasteAppend} />
            </View>
          ),
        }}
      />
      <TextInput
        testID="editor-title"
        value={title}
        onChangeText={(v) => {
          autoTitle.current = false;
          setTitle(v);
          schedule(v, body);
        }}
        placeholder={t('editor.titlePlaceholder')}
        placeholderTextColor={colors.textMuted}
        style={[typography.title, { color: colors.text }, contentDirectionStyle(title)]}
        accessibilityLabel={t('editor.titlePlaceholder')}
        editable={loaded}
        returnKeyType="next"
      />
      {loaded ? (
        <View style={styles.chipRow}>
          <Chip
            testID="editor-folder-chip"
            icon="folder-outline"
            label={folderLabel}
            accessibilityLabel={t('folders.editorChip', { name: folderLabel })}
            accessibilityHint={t('folders.editorChipHint')}
            onPress={() => void openFolderPicker()}
          />
        </View>
      ) : null}
      {/* Not a live region: it changes on every keystroke and would interrupt dictation/typing feedback. */}
      <Text testID="editor-stats" variant="caption" muted>
        {t('editor.stats', { words, duration: formatDuration(estimateSpeakingSeconds(body, wpm)) })} · {saveState === 'saved' ? t('editor.saved') : t('editor.saving')}
      </Text>
      <TextInput
        testID="editor-body"
        value={body}
        onChangeText={onBody}
        multiline
        autoFocus={loaded && body.length === 0}
        placeholder={t('editor.bodyPlaceholder')}
        placeholderTextColor={colors.textMuted}
        style={[typography.body, styles.body, { color: colors.text }, contentDirectionStyle(body)]}
        textAlignVertical="top"
        accessibilityLabel={t('editor.bodyPlaceholder')}
        editable={loaded}
        scrollEnabled
      />
      <Sheet
        visible={folderSheet !== null}
        onClose={() => setFolderSheet(null)}
        title={folderSheet === 'new' ? t('folders.newFolder') : t('folders.moveTitle', { title: title || t('common.untitled') })}
      >
        {folderSheet === 'new' ? (
          <NameForm
            placeholder={t('folders.namePlaceholder')}
            submitLabel={t('folders.create')}
            cancelLabel={t('common.cancel')}
            onCancel={() => setFolderSheet(null)}
            onSubmit={(name) => void createFolderAndMove(name)}
          />
        ) : (
          <SheetActions
            onCancel={() => setFolderSheet(null)}
            actions={folderChoiceActions(folders, folderId, (next) => void moveTo(next), () => setFolderSheet('new'))}
          />
        )}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: spacing.sm },
  body: { flex: 1, fontSize: 18, lineHeight: 27 },
  footerRow: { flexDirection: 'row', gap: spacing.md },
  headerActions: { flexDirection: 'row' },
  chipRow: { flexDirection: 'row' },
});
