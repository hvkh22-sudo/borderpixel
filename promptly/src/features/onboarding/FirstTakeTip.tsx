import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '../../components/Text';
import { useAnnounce } from '../../hooks/useAnnounce';
import { t } from '../../localization/i18n';
import { useFirstRun } from '../../state/firstRun';
import { palette, radius, spacing } from '../../theme/tokens';
import { shouldShowRecordTip } from './firstRun';

export const FIRST_TAKE_TIP_MS = 3000;

/**
 * Record screen, first take only: a 3 s hint over the prompter area. UI only, like the
 * teleprompter itself: it is a React Native view above the camera preview, so it is never in
 * the recorded file. It ignores touches (`pointerEvents="none"`) and sits inside the prompter
 * box, so it never covers a control.
 */
export function FirstTakeTip() {
  const eligible = useFirstRun((s) => s.hydrated && shouldShowRecordTip(s.flags));
  // Decided once per visit, so the hint does not reappear after it timed out.
  const [visible, setVisible] = useState(eligible);
  useEffect(() => {
    if (!visible) return;
    const tmo = setTimeout(() => setVisible(false), FIRST_TAKE_TIP_MS);
    return () => clearTimeout(tmo);
  }, [visible]);
  const message = visible ? t('firstRun.recordTip') : null;
  useAnnounce(message);
  if (!message) return null;
  return (
    <View testID="record-first-take-tip" style={styles.wrap}>
      <View style={styles.pill}>
        <Text variant="callout" color="#fff" center accessibilityLiveRegion="polite">
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { pointerEvents: 'none', position: 'absolute', left: 0, right: 0, bottom: spacing.md, alignItems: 'center', paddingHorizontal: spacing.md },
  pill: { backgroundColor: 'rgba(0,0,0,0.7)', borderColor: palette.violet300, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
});
