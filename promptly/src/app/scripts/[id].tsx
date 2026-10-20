import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { createHistory, currentText, pushVersion, redo, undo, type VersionHistory } from '../../features/ai-script-studio/studio';
import { countWords, estimateSpeakingSeconds } from '../../features/voice-follow/text';
import { formatDuration, t } from '../../localization/i18n';
import { getRepositories } from '../../services/db';
import { deriveTitle } from '../../storage/repositories';
import { useSettings } from '../../state/settings';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing, typography } from '../../theme/tokens';

const AUTOSAVE_MS = 600;
const UNDO_SNAPSHOT_MS = 1200;

export default function Editor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const wpm = useSettings((s) => s.prompter.wpm);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [history, setHistory] = useState<VersionHistory>(() => createHistory('', Date.now()));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title: '', body: '', dirty: false });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const repos = await getRepositories();
      const s = await repos.scripts.get(id);
      if (!alive) return;
      if (!s) {
        setMissing(true);
        return;
      }
      await repos.scripts.markOpened(id);
      setTitle(s.title);
      setBody(s.body);
      latest.current = { title: s.title, body: s.body, dirty: false };
      setHistory(createHistory(s.body, Date.now()));
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const flush = useCallback(async () => {
    if (!latest.current.dirty) return;
    latest.current.dirty = false;
    setSaveState('saving');
    const repos = await getRepositories();
    await repos.scripts.update(id, { title: latest.current.title, body: latest.current.body });
    setSaveState('saved');
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
    // Untitled scripts take their title from the first line.
    const nextTitle = title === t('common.untitled') || title === '' ? deriveTitle(text, t('common.untitled')) : title;
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
  // Make sure an in-progress edit is part of history before undoing.
  const pendingSnapshot = () => (currentText(history) !== body ? pushVersion(history, body, 'manual', Date.now()) : history);

  return (
    <Screen
      scroll={false}
      keyboard
      contentStyle={styles.content}
      footer={
        <View style={styles.footerRow}>
          <Button label={t('editor.aiImprove')} icon="sparkles-outline" variant="secondary" onPress={async () => (await flush(), router.push(`/studio?scriptId=${id}`))} />
          <Button label={t('editor.record')} icon="videocam" variant="record" onPress={startRecording} style={styles.flex} />
        </View>
      }
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              <IconButton icon="arrow-undo" label={t('common.undo')} disabled={history.current === 0 && currentText(history) === body} onPress={() => applyHistory(undo(pendingSnapshot()))} />
              <IconButton icon="arrow-redo" label={t('common.redo')} disabled={history.current >= history.versions.length - 1} onPress={() => applyHistory(redo(history))} />
              <IconButton icon="clipboard-outline" label={t('editor.pasteAppend')} onPress={pasteAppend} />
            </View>
          ),
        }}
      />
      <TextInput
        value={title}
        onChangeText={(v) => {
          setTitle(v);
          schedule(v, body);
        }}
        placeholder={t('editor.titlePlaceholder')}
        placeholderTextColor={colors.textMuted}
        style={[typography.title, { color: colors.text }]}
        accessibilityLabel={t('editor.titlePlaceholder')}
        editable={loaded}
        returnKeyType="next"
      />
      <Text variant="caption" muted accessibilityLiveRegion="polite">
        {t('editor.stats', { words, duration: formatDuration(estimateSpeakingSeconds(body, wpm)) })} · {saveState === 'saved' ? t('editor.saved') : t('editor.saving')}
      </Text>
      <TextInput
        value={body}
        onChangeText={onBody}
        multiline
        autoFocus={loaded && body.length === 0}
        placeholder={t('editor.bodyPlaceholder')}
        placeholderTextColor={colors.textMuted}
        style={[typography.body, styles.body, { color: colors.text }]}
        textAlignVertical="top"
        accessibilityLabel={t('editor.bodyPlaceholder')}
        editable={loaded}
        scrollEnabled
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: spacing.sm },
  body: { flex: 1, fontSize: 18, lineHeight: 27 },
  footerRow: { flexDirection: 'row', gap: spacing.md },
  headerActions: { flexDirection: 'row' },
});
