import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { Segmented } from '../components/Segmented';
import { Text } from '../components/Text';
import {
  PLATFORMS,
  TONES,
  applyHook,
  diffWords,
  type Platform,
  type StudioRequest,
  type StudioResponse,
  type StudioTool,
  type Tone,
} from '../features/ai-script-studio/studio';
import { t, type TKey } from '../localization/i18n';
import { AiError, aiAvailable, runStudio } from '../services/ai';
import { track } from '../services/analytics';
import { config } from '../services/config';
import { getRepositories } from '../services/db';
import { useSettings } from '../state/settings';
import { deriveTitle, type Script, type ScriptVersionRow } from '../storage/repositories';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing, typography } from '../theme/tokens';

const EDIT_TOOLS: StudioTool[] = ['improve', 'shorten', 'conversational', 'hook', 'tone', 'platform'];
const DURATIONS = [30, 60, 90, 180] as const;

export default function Studio() {
  const params = useLocalSearchParams<{ scriptId?: string; tool?: StudioTool }>();
  const { colors } = useTheme();
  const [script, setScript] = useState<Script | null>(null);
  const [versions, setVersions] = useState<ScriptVersionRow[]>([]);
  const [tool, setTool] = useState<StudioTool | null>(params.tool ?? (params.scriptId ? null : 'generate'));
  const [topic, setTopic] = useState('');
  const [keyPoints, setKeyPoints] = useState('');
  const [audience, setAudience] = useState('');
  const [platform, setPlatform] = useState<Platform>('tiktok');
  const [tone, setTone] = useState<Tone>('friendly');
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(60);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StudioResponse | null>(null);
  const [compare, setCompare] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const aiConsent = useSettings((st) => st.aiConsent);
  const [reported, setReported] = useState(false);

  useEffect(() => {
    if (!params.scriptId) return;
    void getRepositories().then(async (r) => {
      setScript(await r.scripts.get(params.scriptId!));
      setVersions(await r.scripts.listVersions(params.scriptId!));
    });
    return () => abortRef.current?.abort();
  }, [params.scriptId]);

  const run = async () => {
    if (!tool) return;
    const req: StudioRequest =
      tool === 'generate'
        ? { tool, topic, keyPoints: keyPoints || undefined, audience: audience || undefined, platform, tone, durationSec: duration }
        : { tool, script: script?.body ?? '', platform, tone, durationSec: tool === 'shorten' ? duration : undefined };
    setBusy(true);
    setError(null);
    setResult(null);
    setReported(false);
    abortRef.current = new AbortController();
    try {
      const res = await runStudio(req, abortRef.current.signal);
      setResult(res);
      track({ name: 'ai_request', tool, ok: true });
    } catch (e) {
      const code = e instanceof AiError ? e.code : 'server_error';
      setError(t(`studio.errors.${code}` as TKey));
      track({ name: 'ai_request', tool, ok: false });
      if (code === 'quota_exceeded') router.push('/paywall?trigger=general');
    } finally {
      setBusy(false);
    }
  };

  const apply = async (text: string) => {
    const repos = await getRepositories();
    if (!script) {
      const s = await repos.scripts.create({ title: deriveTitle(text, topic || t('common.untitled')), body: text });
      track({ name: 'script_created', source: 'ai' });
      router.replace(`/scripts/${s.id}`);
      return;
    }
    // Keep the pre-AI text recoverable, then apply.
    await repos.scripts.addVersion(script.id, script.body, 'before_ai');
    await repos.scripts.update(script.id, { body: text });
    await repos.scripts.addVersion(script.id, text, tool ?? 'improve');
    Alert.alert(t('studio.applied'));
    router.back();
  };

  const restoreVersion = async (v: ScriptVersionRow) => {
    if (!script) return;
    const repos = await getRepositories();
    await repos.scripts.addVersion(script.id, script.body, 'before_restore');
    await repos.scripts.update(script.id, { body: v.body });
    router.back();
  };

  if (!aiAvailable()) {
    return (
      <Screen>
        <Card>
          <Ionicons name="sparkles-outline" size={28} color={colors.primary} />
          <Text variant="headline">{t('studio.title')}</Text>
          <Text muted>{t('studio.errors.not_configured')}</Text>
        </Card>
        {versions.length > 0 ? <VersionList versions={versions} onRestore={restoreVersion} /> : null}
      </Screen>
    );
  }

  if (!aiConsent) {
    return (
      <Screen>
        <Card>
          <Ionicons name="shield-checkmark-outline" size={28} color={colors.primary} />
          <Text variant="headline">{t('studio.consentTitle')}</Text>
          <Text>{t('studio.disclosure')}</Text>
          <Button label={t('studio.consentAllow')} onPress={() => useSettings.getState().set({ aiConsent: true })} />
          <Button label={t('studio.consentNotNow')} variant="ghost" onPress={() => router.back()} />
        </Card>
        {versions.length > 0 ? <VersionList versions={versions} onRestore={restoreVersion} /> : null}
      </Screen>
    );
  }

  const report = () => {
    if (!tool) return;
    track({ name: 'ai_output_reported', tool });
    setReported(true);
    // Content is never sent automatically; the user chooses what to include in the email.
    if (config.supportEmail) void Linking.openURL(`mailto:${config.supportEmail}?subject=${encodeURIComponent(`AI draft report (${tool})`)}`);
  };

  const inputStyle = [styles.input, typography.body, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }];

  return (
    <Screen keyboard>
      <Text variant="caption" muted>
        {t('studio.disclosure')}
      </Text>

      {!tool ? (
        <View style={styles.tools}>
          {EDIT_TOOLS.map((k) => (
            <Card key={k} onPress={() => setTool(k)} accessibilityLabel={t(`studio.tools.${k}` as TKey)}>
              <Text variant="headline">{t(`studio.tools.${k}` as TKey)}</Text>
              <Text variant="caption" muted>
                {t(`studio.toolHints.${k}` as TKey)}
              </Text>
            </Card>
          ))}
          {versions.length > 0 ? <VersionList versions={versions} onRestore={restoreVersion} /> : null}
        </View>
      ) : (
        <View style={styles.form}>
          <Text variant="title">{t(`studio.tools.${tool}` as TKey)}</Text>
          {tool === 'generate' ? (
            <>
              <TextInput value={topic} onChangeText={setTopic} placeholder={t('studio.topic')} placeholderTextColor={colors.textMuted} style={inputStyle} accessibilityLabel={t('studio.topic')} maxLength={300} />
              <TextInput value={keyPoints} onChangeText={setKeyPoints} placeholder={t('studio.keyPoints')} placeholderTextColor={colors.textMuted} style={[inputStyle, styles.multi]} multiline accessibilityLabel={t('studio.keyPoints')} maxLength={1500} />
              <TextInput value={audience} onChangeText={setAudience} placeholder={t('studio.audience')} placeholderTextColor={colors.textMuted} style={inputStyle} accessibilityLabel={t('studio.audience')} maxLength={200} />
            </>
          ) : null}
          {tool === 'generate' || tool === 'platform' || tool === 'hook' ? (
            <>
              <Text variant="overline" muted>
                {t('studio.platformLabel').toUpperCase()}
              </Text>
              <Segmented accessibilityLabel={t('studio.platformLabel')} value={platform} onChange={setPlatform} options={PLATFORMS.map((p) => ({ value: p, label: t(`platform.${p}` as TKey) }))} />
            </>
          ) : null}
          {tool === 'generate' || tool === 'tone' ? (
            <>
              <Text variant="overline" muted>
                {t('studio.toneLabel').toUpperCase()}
              </Text>
              <View style={styles.chips}>
                {TONES.map((x) => (
                  <Pressable
                    key={x}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: tone === x }}
                    onPress={() => setTone(x)}
                    style={[styles.chip, { borderColor: tone === x ? colors.primary : colors.border, backgroundColor: tone === x ? colors.primarySoft : colors.surface }]}
                  >
                    <Text variant="callout">{t(`tone.${x}` as TKey)}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
          {tool === 'generate' || tool === 'shorten' ? (
            <>
              <Text variant="overline" muted>
                {t('studio.duration').toUpperCase()}
              </Text>
              <Segmented accessibilityLabel={t('studio.duration')} value={duration} onChange={setDuration} options={DURATIONS.map((d) => ({ value: d, label: t('common.seconds', { n: d }) }))} />
            </>
          ) : null}
          <Button label={busy ? t('studio.running') : t('studio.run')} icon="sparkles" onPress={run} loading={busy} disabled={tool === 'generate' && !topic.trim()} />
          {busy ? <ActivityIndicator color={colors.primary} /> : null}
          {error ? (
            <Text center color={colors.danger} accessibilityLiveRegion="assertive">
              {error}
            </Text>
          ) : null}
        </View>
      )}

      {result ? (
        <View style={styles.form}>
          <View style={styles.resultHeader}>
            <Text variant="headline">{t('studio.result')}</Text>
            {script && tool !== 'hook' ? <Button label={t('studio.compare')} variant="ghost" onPress={() => setCompare((c) => !c)} /> : null}
          </View>
          {tool === 'hook' && result.alternatives?.length ? (
            result.alternatives.map((h) => (
              <Card key={h}>
                <Text>{h}</Text>
                <Button label={t('studio.insertHook')} variant="secondary" onPress={() => apply(applyHook(script?.body ?? '', h))} />
              </Card>
            ))
          ) : (
            <Card>
              {compare && script ? (
                <Text>
                  {diffWords(script.body, result.text).map((p, i) => (
                    <Text key={i} style={p.kind === 'added' ? { color: colors.success } : p.kind === 'removed' ? { color: colors.danger, textDecorationLine: 'line-through' } : undefined}>
                      {p.text}
                    </Text>
                  ))}
                </Text>
              ) : (
                <Text selectable>{result.text}</Text>
              )}
            </Card>
          )}
          <Text variant="caption" muted>
            {t('studio.draftNote')} · {t('studio.remaining', { n: result.remaining })}
          </Text>
          {tool !== 'hook' ? <Button label={t('studio.useDraft')} onPress={() => apply(result.text)} /> : null}
          <Button label={t('studio.regenerate')} variant="ghost" icon="refresh" onPress={run} disabled={busy} />
          {reported ? (
            <Text variant="caption" muted center accessibilityLiveRegion="polite">
              {t('studio.reported')}
            </Text>
          ) : (
            <Button label={t('studio.report')} variant="ghost" icon="flag-outline" onPress={report} />
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function VersionList({ versions, onRestore }: { versions: ScriptVersionRow[]; onRestore: (v: ScriptVersionRow) => void }) {
  return (
    <View style={styles.form}>
      <Text variant="headline">{t('studio.history')}</Text>
      {versions.slice(0, 10).map((v) => (
        <Card key={v.id}>
          <Text variant="caption" muted>
            {new Date(v.createdAt).toLocaleString()} · {v.source}
          </Text>
          <Text numberOfLines={3}>{v.body}</Text>
          <Button label={t('studio.restore')} variant="ghost" onPress={() => onRestore(v)} />
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tools: { gap: spacing.md },
  form: { gap: spacing.md },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.md, minHeight: 48 },
  multi: { minHeight: 96, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, minHeight: 40, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1 },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
