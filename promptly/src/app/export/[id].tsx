import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { decorative } from '../../components/a11y';
import { Button } from '../../components/Button';
import { ListRow } from '../../components/ListRow';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { burnInPayload } from '../../features/captions/burnIn';
import { toSrt } from '../../features/captions/captions';
import { checkFeature } from '../../features/monetization/entitlements';
import { useAnnounce } from '../../hooks/useAnnounce';
import { t } from '../../localization/i18n';
import { track } from '../../services/analytics';
import { support } from '../../services/deviceSupport';
import { getRepositories } from '../../services/db';
import { exportsDir, recordingFile } from '../../services/files';
import { PromptlyMedia, type Job } from '../../services/nativeMedia';
import { useAccess } from '../../state/access';
import { useSettings } from '../../state/settings';
import type { Recording } from '../../storage/repositories';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';

type Status = { kind: 'idle' } | { kind: 'rendering'; progress: number } | { kind: 'done'; message: string } | { kind: 'error'; message: string };

export default function ExportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const [rec, setRec] = useState<Recording | null>(null);
  const [burnIn, setBurnIn] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const jobRef = useRef<Job<string> | null>(null);
  const burnInAvailable = support.burnIn().ok;
  const access = useAccess((s) => s.access);
  const usage = useAccess((s) => s.usage);
  const wordHighlight = useSettings((s) => s.captionWordHighlight);
  const highlightOn = wordHighlight && checkFeature('captionWordHighlight', access, usage).allowed;

  useEffect(() => {
    void getRepositories().then((r) => r.recordings.get(id).then((x) => {
      setRec(x);
      if (x?.cues && burnInAvailable) setBurnIn(true);
    }));
    return () => jobRef.current?.cancel();
  }, [id, burnInAvailable]);

  // Progress is announced in 25 % steps (a live region on the percentage would speak every update);
  // the final status text is a live region on Android and announced on iOS.
  const milestone = status.kind === 'rendering' ? Math.floor(status.progress * 4) * 25 : null;
  useAnnounce(milestone === null ? null : t('export.rendering', { p: milestone }), 'all');
  useAnnounce(status.kind === 'done' || status.kind === 'error' ? status.message : null);

  if (!rec) return <Screen>{null}</Screen>;
  const source = recordingFile(rec.fileName);
  const hasCaptions = !!rec.cues && rec.cues.length > 0;

  /** Returns the file to export: original, or a captioned copy (original untouched). */
  const prepareVideo = async (): Promise<string> => {
    if (!burnIn || !hasCaptions || !burnInAvailable) return source.uri;
    const payload = burnInPayload(rec.cues!, rec.captionStyle ?? 'clean', rec.captionPosition, highlightOn);
    setStatus({ kind: 'rendering', progress: 0 });
    const job = PromptlyMedia.burnInCaptions(
      source.uri,
      payload.cues,
      payload.style,
      (progress) => setStatus({ kind: 'rendering', progress }),
    );
    jobRef.current = job;
    return job.promise;
  };

  const run = async (action: 'photos' | 'share') => {
    try {
      const uri = await prepareVideo();
      if (action === 'photos') {
        const perm = await MediaLibrary.requestPermissionsAsync(true);
        if (!perm.granted) {
          setStatus({ kind: 'error', message: t('export.photosPermission') });
          return;
        }
        await MediaLibrary.Asset.create(uri);
        await (await getRepositories()).recordings.markSavedToLibrary(rec.id);
        setStatus({ kind: 'done', message: t('export.saved') });
      } else {
        setStatus({ kind: 'idle' });
        await Sharing.shareAsync(uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' });
      }
      track({ name: 'export_completed', captions: burnIn && hasCaptions, kind: 'video' });
    } catch {
      setStatus({ kind: 'error', message: t('export.failed') });
    }
  };

  const shareSrt = async () => {
    if (!rec.cues) return;
    try {
      const f = new File(exportsDir(), `captions_${rec.id.slice(0, 8)}.srt`);
      await f.write(toSrt(rec.cues));
      await Sharing.shareAsync(f.uri, { mimeType: 'application/x-subrip', UTI: 'public.plain-text' });
      track({ name: 'export_completed', captions: true, kind: 'srt' });
    } catch {
      setStatus({ kind: 'error', message: t('export.failed') });
    }
  };

  const busy = status.kind === 'rendering';

  return (
    <Screen>
      {hasCaptions ? (
        burnInAvailable ? (
          <ListRow testID="export-burn-in" title={t('export.withCaptions')} toggle={{ value: burnIn, onChange: setBurnIn }} />
        ) : (
          <Text variant="caption" muted>
            {t('export.withCaptionsUnavailable')}
          </Text>
        )
      ) : null}
      <View style={styles.actions}>
        <Button testID="export-save-photos" label={t('export.saveToPhotos')} icon="download-outline" onPress={() => run('photos')} disabled={busy} />
        <Button testID="export-share-video" label={t('export.shareVideo')} icon="share-outline" variant="secondary" onPress={() => run('share')} disabled={busy} />
        <Button testID="export-share-srt" label={t('export.shareSrt')} icon="document-text-outline" variant="secondary" onPress={shareSrt} disabled={!hasCaptions || busy} />
        {!hasCaptions ? (
          <Text variant="caption" muted center>
            {t('export.noCaptions')}
          </Text>
        ) : null}
      </View>
      {status.kind === 'rendering' ? (
        <View style={styles.actions}>
          <Text center {...decorative}>
            {t('export.rendering', { p: Math.round(status.progress * 100) })}
          </Text>
          <View
            testID="export-progress"
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t('export.title')}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(status.progress * 100) }}
            style={[styles.bar, { backgroundColor: colors.border }]}
          >
            <View style={[styles.fill, { width: `${Math.round(status.progress * 100)}%`, backgroundColor: colors.primary }]} />
          </View>
          <Button label={t('common.cancel')} variant="ghost" onPress={() => (jobRef.current?.cancel(), setStatus({ kind: 'idle' }))} />
        </View>
      ) : status.kind !== 'idle' ? (
        <Text testID="export-status" center color={status.kind === 'error' ? colors.danger : colors.success} accessibilityLiveRegion="assertive">
          {status.message}
        </Text>
      ) : null}
      <Text variant="caption" muted center>
        {t('export.originalSafe')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.md },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6 },
});
