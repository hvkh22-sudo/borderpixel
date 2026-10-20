import { useEvent } from 'expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { ListRow } from '../../components/ListRow';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { CaptionPreview } from '../../features/captions/CaptionPreview';
import { CaptionStylePicker } from '../../features/captions/CaptionStylePicker';
import {
  activeWordIndex,
  assessTranscript,
  cueHasWordTiming,
  correctWithScript,
  cueAt,
  deleteCue,
  estimateWordsFromTranscript,
  hasWordLevelTiming,
  mergeWithNext,
  segmentWords,
  segmentsToWords,
  shiftAll,
  splitCue,
  updateCueText,
  type Cue,
} from '../../features/captions/captions';
import { CAPTION_STYLES, type CaptionPosition, type CaptionStyleId } from '../../features/captions/captionStyles';
import { checkFeature } from '../../features/monetization/entitlements';
import { useAnnounce } from '../../hooks/useAnnounce';
import { formatClock, t } from '../../localization/i18n';
import { contentDirectionStyle, flipInRtl } from '../../localization/layoutDirection';
import { track } from '../../services/analytics';
import { support } from '../../services/deviceSupport';
import { getRepositories } from '../../services/db';
import { recordingFile } from '../../services/files';
import { ensureSpeechPermission } from '../../services/speechEngine';
import { TranscriptionError, transcribeRecording } from '../../services/transcription';
import { useAccess } from '../../state/access';
import { useSettings } from '../../state/settings';
import type { Recording } from '../../storage/repositories';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../../theme/tokens';

type Phase = 'idle' | 'working' | 'ready' | 'error';

export default function CaptionsEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const access = useAccess((s) => s.access);
  const usage = useAccess((s) => s.usage);
  const speechLocale = useSettings((s) => s.speechLocale);
  const [rec, setRec] = useState<Recording | null>(null);
  const [scriptBody, setScriptBody] = useState('');
  const [cues, setCues] = useState<Cue[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [styleId, setStyleId] = useState<CaptionStyleId>('clean');
  const [position, setPosition] = useState<CaptionPosition>(() => useSettings.getState().captionPosition);
  const [useScript, setUseScript] = useState(true);
  const [frameWidth, setFrameWidth] = useState(200);
  const [part, setPart] = useState<{ n: number; total: number } | null>(null);
  const [justGenerated, setJustGenerated] = useState(false);
  const wordHighlight = useSettings((s) => s.captionWordHighlight);
  const highlightAllowed = checkFeature('captionWordHighlight', access, usage).allowed;
  const abortRef = useRef<AbortController | null>(null);

  const uri = rec ? recordingFile(rec.fileName).uri : null;
  const player = useVideoPlayer(uri, (p) => {
    p.timeUpdateEventInterval = 0.1;
  });
  const time = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });

  useEffect(() => {
    void (async () => {
      const repos = await getRepositories();
      const r = await repos.recordings.get(id);
      setRec(r);
      if (r?.scriptId) setScriptBody((await repos.scripts.get(r.scriptId))?.body ?? '');
      if (r?.cues) {
        setCues(r.cues);
        setStyleId(r.captionStyle ?? 'clean');
        setPosition(r.captionPosition);
        setPhase('ready');
      }
    })();
    return () => abortRef.current?.abort();
  }, [id]);

  const generate = async () => {
    if (!uri || !rec) return;
    setPhase('working');
    setErrorKey(null);
    setPart(null);
    const started = Date.now();
    try {
      if (!(await ensureSpeechPermission())) throw new TranscriptionError('permission_denied');
      abortRef.current = new AbortController();
      const durationMs = rec.durationMs || player.duration * 1000;
      const result = await transcribeRecording(uri, speechLocale, {
        signal: abortRef.current.signal,
        durationMs,
        onProgress: (n, total) => setPart({ n, total }),
      });
      let words = segmentsToWords(result.segments);
      if (words.length === 0 && result.transcript) {
        words = estimateWordsFromTranscript(result.transcript, 0, durationMs);
      }
      if (useScript && scriptBody) words = correctWithScript(words, scriptBody);
      const quality = assessTranscript(words);
      if (!quality.hasSpeech) throw new TranscriptionError('no_speech');
      const n: string[] = [];
      if (!hasWordLevelTiming(words)) n.push(t('captions.estimatedTiming'));
      if (quality.lowConfidenceRatio > 0.2) n.push(t('captions.lowConfidence'));
      // Missing parts are reported, never filled in.
      for (const g of result.gaps ?? []) {
        n.push(
          g.reason === 'stopped_early'
            ? t('captions.partialEnd', { at: formatClock(g.startMs) })
            : t('captions.gap', { from: formatClock(g.startMs), to: formatClock(g.endMs) }),
        );
      }
      setNotes(n);
      setCues(segmentWords(words));
      setPhase('ready');
      setJustGenerated(true);
      track({ name: 'captions_generated', words: words.length, durationSec: Math.round((Date.now() - started) / 1000) });
    } catch (e) {
      const code = e instanceof TranscriptionError ? e.code : 'failed';
      setErrorKey(`captions.errors.${code}`);
      setPhase('error');
      track({ name: 'captions_failed', code });
    }
  };

  const chooseStyle = (s: CaptionStyleId) => {
    if (CAPTION_STYLES[s].pro && !checkFeature('captionStylePremium', access, usage).allowed) {
      router.push('/paywall?trigger=captionStyle');
      return;
    }
    setStyleId(s);
  };

  const toggleHighlight = (v: boolean) => {
    if (v && !highlightAllowed) {
      router.push('/paywall?trigger=captionWordHighlight');
      return;
    }
    useSettings.getState().set({ captionWordHighlight: v });
  };

  const save = async () => {
    await (await getRepositories()).recordings.saveCaptions(id, cues, styleId, position);
    router.back();
  };

  const nowMs = time.currentTime * 1000;
  const active = cueAt(cues, nowMs);
  const highlightOn = wordHighlight && highlightAllowed;
  const anyWordTiming = cues.some(cueHasWordTiming);
  const highlightHint = !CAPTION_STYLES[styleId].highlightColor
    ? t('captions.wordHighlightHint')
    : anyWordTiming && !cues.every(cueHasWordTiming)
      ? t('captions.wordHighlightEdited')
      : undefined;

  // Android reads the live-region texts below; VoiceOver needs explicit announcements.
  useAnnounce(
    phase === 'working'
      ? part && part.total > 1
        ? `${t('captions.generating')} ${t('captions.part', { n: part.n, total: part.total })}`
        : t('captions.generating')
      : phase === 'error' && errorKey
        ? t(errorKey as Parameters<typeof t>[0])
        : null,
  );
  useAnnounce(justGenerated ? t('a11y.captionsReady', { n: cues.length }) : null, 'all');

  const capSupport = support.captions();
  if (!capSupport.ok) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text testID="captions-unsupported" center>{t('captions.errors.unsupported_device')}</Text>
        <Text center muted>
          {t(`support.${capSupport.reason}`)}
        </Text>
      </View>
    );
  }

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.video} onLayout={(e) => setFrameWidth(e.nativeEvent.layout.width)}>
        {uri ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls /> : null}
        <CaptionPreview
          text={active?.text ?? null}
          styleId={styleId}
          position={position}
          frameWidth={frameWidth}
          activeWord={highlightOn && active ? activeWordIndex(active, nowMs) : -1}
        />
      </View>
      {phase !== 'ready' ? (
        <View style={styles.generate}>
          {phase === 'working' ? (
            <>
              <ActivityIndicator color={colors.primary} />
              <Text testID="captions-working" muted accessibilityLiveRegion="polite">
                {t('captions.generating')}
              </Text>
              {part && part.total > 1 ? (
                <Text variant="caption" muted accessibilityLiveRegion="polite">
                  {t('captions.part', { n: part.n, total: part.total })}
                </Text>
              ) : null}
              <Button testID="captions-cancel" label={t('common.cancel')} variant="ghost" onPress={() => abortRef.current?.abort()} />
            </>
          ) : (
            <>
              {errorKey ? (
                <Text testID="captions-error" center accessibilityLiveRegion="assertive">
                  {t(errorKey as Parameters<typeof t>[0])}
                </Text>
              ) : null}
              {scriptBody ? <ListRow testID="captions-use-script" title={t('captions.useScript')} toggle={{ value: useScript, onChange: setUseScript }} /> : null}
              <Button testID="captions-generate" label={phase === 'error' ? t('common.retry') : t('captions.generate')} icon="text" onPress={generate} />
              <Text variant="caption" muted center>
                {t('captions.onDevice')}
              </Text>
            </>
          )}
        </View>
      ) : (
        <View style={styles.controls}>
          {notes.map((n) => (
            <Text key={n} variant="caption" color={colors.warning}>
              {n}
            </Text>
          ))}
          <Text variant="overline" muted accessibilityRole="header" accessibilityLabel={t('captions.style.label')}>
            {t('captions.style.label').toUpperCase()}
          </Text>
          <CaptionStylePicker value={styleId} onChange={chooseStyle} showProBadge={!access.isPro} />
          {anyWordTiming ? (
            <ListRow
              title={t('captions.wordHighlight')}
              subtitle={highlightHint ?? (highlightAllowed ? undefined : t('common.pro'))}
              toggle={{ value: highlightOn, onChange: toggleHighlight }}
            />
          ) : null}
          <Segmented
            accessibilityLabel={t('captions.position')}
            value={position}
            onChange={setPosition}
            options={[
              { value: 'upper', label: t('captions.upper') },
              { value: 'middle', label: t('captions.middle') },
              { value: 'lower', label: t('captions.lower') },
            ]}
          />
          <View style={styles.shiftRow}>
            <Text variant="callout">{t('captions.shiftAll')}</Text>
            <IconButton icon="play-back" iconStyle={flipInRtl()} label={t('a11y.shiftEarlier')} onPress={() => setCues((c) => shiftAll(c, -100))} />
            <IconButton icon="play-forward" iconStyle={flipInRtl()} label={t('a11y.shiftLater')} onPress={() => setCues((c) => shiftAll(c, 100))} />
          </View>
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <FlatList
        data={phase === 'ready' ? cues : []}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }) => (
          // Not one accessible element: on iOS that would hide the text field and the cue buttons
          // from VoiceOver. The timestamp is its own "play from" button instead.
          <View
            testID="caption-cue"
            style={[styles.cue, { backgroundColor: active?.id === item.id ? colors.primarySoft : colors.surface, borderColor: colors.border }]}
          >
            <Pressable
              testID="caption-cue-seek"
              accessibilityRole="button"
              accessibilityLabel={t('a11y.cueSeek', { time: formatClock(item.startMs) })}
              accessibilityState={{ selected: active?.id === item.id }}
              onPress={() => {
                player.currentTime = item.startMs / 1000;
              }}
              style={styles.time}
            >
              <Text variant="caption" muted style={styles.timeText}>
                {formatClock(item.startMs)}
              </Text>
            </Pressable>
            <TextInput
              value={item.text}
              onChangeText={(v) => setCues((c) => updateCueText(c, item.id, v))}
              style={[styles.cueInput, { color: colors.text }, contentDirectionStyle(item.text)]}
              multiline
              accessibilityLabel={t('a11y.cueText', { n: index + 1, time: formatClock(item.startMs) })}
            />
            <View style={styles.cueActions}>
              <IconButton icon="cut-outline" size={18} label={t('captions.split')} onPress={() => setCues((c) => splitCue(c, item.id, Math.ceil(item.text.split(' ').length / 2)))} />
              <IconButton icon="git-merge-outline" size={18} label={t('captions.merge')} disabled={index === cues.length - 1} onPress={() => setCues((c) => mergeWithNext(c, item.id))} />
              <IconButton icon="trash-outline" size={18} label={t('captions.deleteCue')} onPress={() => setCues((c) => deleteCue(c, item.id))} />
            </View>
          </View>
        )}
      />
      {phase === 'ready' ? (
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Button testID="captions-save" label={t('captions.save')} onPress={save} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  headerBlock: { gap: spacing.md, paddingBottom: spacing.md },
  video: { height: 320, aspectRatio: 9 / 16, alignSelf: 'center', backgroundColor: '#000', borderRadius: radius.lg, overflow: 'hidden' },
  generate: { gap: spacing.md, alignItems: 'stretch', paddingVertical: spacing.lg },
  controls: { gap: spacing.sm },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 100 },
  cue: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  time: { minWidth: 44, minHeight: touchTarget, justifyContent: 'center' },
  timeText: { fontVariant: ['tabular-nums'] },
  cueInput: { flex: 1, fontSize: 16, paddingVertical: 4 },
  cueActions: { flexDirection: 'row' },
  footer: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
