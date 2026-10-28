import { useEvent } from 'expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { InlineTip } from '../../components/InlineTip';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { CaptionPreview } from '../../features/captions/CaptionPreview';
import { activeWordIndex, cueAt } from '../../features/captions/captions';
import { checkFeature } from '../../features/monetization/entitlements';
import { takeTip } from '../../features/onboarding/firstRun';
import { useFocusData } from '../../hooks/useAsyncData';
import { formatClock, t } from '../../localization/i18n';
import { getRepositories } from '../../services/db';
import { deleteRecordingFile, recordingFile } from '../../services/files';
import { useAccess } from '../../state/access';
import { useFirstRun } from '../../state/firstRun';
import { useSettings } from '../../state/settings';
import { radius, spacing } from '../../theme/tokens';

export default function Take() {
  const { id, audioIssue, notice } = useLocalSearchParams<{ id: string; audioIssue?: string; notice?: string }>();
  const { data: rec } = useFocusData(async () => (await getRepositories()).recordings.get(id), [id]);
  const file = rec ? recordingFile(rec.fileName) : null;
  const exists = file?.exists ?? false;
  const player = useVideoPlayer(exists && file ? file.uri : null, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.1;
  });
  const time = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const [frameWidth, setFrameWidth] = useState(300);
  const wordHighlight = useSettings((s) => s.captionWordHighlight);
  const access = useAccess((s) => s.access);
  const usage = useAccess((s) => s.usage);
  const highlightOn = wordHighlight && checkFeature('captionWordHighlight', access, usage).allowed;

  useEffect(() => {
    if (exists) player.play();
  }, [exists, player]);

  // A saved take on screen is the activation milestone; the hint then points at captions, then Export.
  const firstRunHydrated = useFirstRun((s) => s.hydrated);
  const firstRunFlags = useFirstRun((s) => s.flags);
  const hasRec = !!rec;
  useEffect(() => {
    if (hasRec && firstRunHydrated) useFirstRun.getState().complete('firstTakeRecorded');
  }, [hasRec, firstRunHydrated]);
  const tip = firstRunHydrated && rec && exists ? takeTip(firstRunFlags, !!rec.cues?.length) : null;

  if (!rec) return <Screen>{null}</Screen>;

  const activeCue = rec.cues ? cueAt(rec.cues, time.currentTime * 1000) : undefined;

  const remove = () =>
    Alert.alert(t('preview.delete'), t('preview.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          player.pause();
          deleteRecordingFile(rec.fileName);
          await (await getRepositories()).recordings.remove(rec.id);
          router.back();
        },
      },
    ]);

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <Button
            testID="take-captions"
            label={rec.cues ? t('preview.editCaptions') : t('preview.addCaptions')}
            icon="text"
            variant="secondary"
            onPress={() => (player.pause(), router.push(`/captions/${rec.id}`))}
            style={styles.flex}
            disabled={!exists}
          />
          <Button testID="take-export" label={t('preview.export')} icon="share-outline" onPress={() => (player.pause(), router.push(`/export/${rec.id}`))} style={styles.flex} disabled={!exists} />
        </View>
      }
    >
      <View testID="take-video" style={styles.video} onLayout={(e) => setFrameWidth(e.nativeEvent.layout.width)}>
        {exists ? (
          <>
            <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls />
            {rec.cues && rec.captionStyle ? <CaptionPreview text={activeCue?.text ?? null} styleId={rec.captionStyle} position={rec.captionPosition} frameWidth={frameWidth} activeWord={highlightOn && activeCue ? activeWordIndex(activeCue, time.currentTime * 1000) : -1} /> : null}
          </>
        ) : (
          <Text center color="#fff">
            {t('preview.missingFile')}
          </Text>
        )}
      </View>
      {audioIssue || rec.audioMissing ? (
        <Text variant="callout" muted center accessibilityLiveRegion="polite">
          {t('record.savedNoAudio')}
        </Text>
      ) : null}
      {notice === 'interrupted' || notice === 'storage_full' ? (
        <Text variant="callout" muted center accessibilityLiveRegion="polite">
          {t(notice === 'storage_full' ? 'record.savedStorageFull' : 'record.savedInterrupted')}
        </Text>
      ) : null}
      {tip ? (
        <InlineTip
          testID="take-tip"
          icon={tip === 'captions' ? 'text-outline' : 'share-outline'}
          message={t(tip === 'captions' ? 'firstRun.takeTipCaptions' : 'firstRun.takeTipExport')}
          onDismiss={() => useFirstRun.getState().dismiss('takeTipDismissed', 'take_tip_dismissed')}
        />
      ) : null}
      <Text muted center>
        {t('preview.duration', { d: formatClock(rec.durationMs) })} · {new Date(rec.createdAt).toLocaleString()}
      </Text>
      <View style={styles.row}>
        {rec.scriptId ? (
          <Button testID="take-retake" label={t('preview.retake')} icon="refresh" variant="ghost" onPress={() => router.replace(`/prepare/${rec.scriptId}`)} />
        ) : null}
        <Button testID="take-delete" label={t('preview.delete')} icon="trash-outline" variant="danger" onPress={remove} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  video: { aspectRatio: 9 / 16, maxHeight: 520, alignSelf: 'center', width: '100%', backgroundColor: '#000', borderRadius: radius.lg, overflow: 'hidden', justifyContent: 'center' },
  footer: { flexDirection: 'row', gap: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md },
});
