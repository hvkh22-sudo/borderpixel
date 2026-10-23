import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { decorative } from '../../components/a11y';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { useAnnounce } from '../../hooks/useAnnounce';
import { t, type TKey } from '../../localization/i18n';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';
import { CHECKLIST_STEPS, type ChecklistStep, type ChecklistView } from './firstRun';

const STEP_LABEL: Record<ChecklistStep, TKey> = {
  write: 'firstRun.stepWrite',
  record: 'firstRun.stepRecord',
  export: 'firstRun.stepExport',
};
const STEP_ACTION: Record<ChecklistStep, TKey> = {
  write: 'firstRun.actionWrite',
  record: 'firstRun.actionRecord',
  export: 'firstRun.actionExport',
};

/** Above this text scale three side-by-side steps no longer fit, so they stack. */
const STACK_FONT_SCALE = 1.3;

interface Props {
  view: ChecklistView;
  onAction: (step: ChecklistStep) => void;
  onHide: () => void;
}

/** Compact, skippable 3-step card on Home until the first export. One primary action. */
export function FirstRunChecklist({ view, onAction, onHide }: Props) {
  const { colors } = useTheme();
  const stacked = useWindowDimensions().fontScale > STACK_FONT_SCALE;
  const title = view.celebrate ? t('firstRun.celebrateTitle') : t('firstRun.checklistTitle');
  // Subtle, one-time celebration: announced when the card switches to it (iOS; live region on Android).
  useAnnounce(view.celebrate ? title : null);
  return (
    <Card testID="first-run-checklist">
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text variant="headline" accessibilityRole="header" accessibilityLiveRegion={view.celebrate ? 'polite' : 'none'}>
            {title}
          </Text>
          {view.celebrate ? (
            <Text variant="caption" muted>
              {t('firstRun.celebrateBody')}
            </Text>
          ) : null}
        </View>
        <Button testID="first-run-hide" label={t('firstRun.hide')} variant="ghost" onPress={onHide} accessibilityHint={t('firstRun.hideLabel')} style={styles.hide} />
      </View>
      <View accessibilityRole="list" accessibilityLabel={t('firstRun.checklistLabel')} style={stacked ? styles.stepsStacked : styles.steps}>
        {CHECKLIST_STEPS.map((step, i) => {
          const done = view.done[step];
          const current = step === view.current;
          const label = t(STEP_LABEL[step]);
          const state = done ? t('firstRun.stepDone') : current ? t('firstRun.stepCurrent') : '';
          return (
            <View
              key={step}
              testID={`first-run-step-${step}`}
              accessible
              accessibilityLabel={[t('firstRun.stepOf', { n: i + 1, step: label }), state].filter(Boolean).join(', ')}
              accessibilityState={{ checked: done, selected: current }}
              style={[styles.step, stacked && styles.stepStacked, current && { backgroundColor: colors.primarySoft }]}
            >
              <View
                {...decorative}
                style={[
                  styles.badge,
                  { borderColor: done || current ? colors.primary : colors.border, backgroundColor: done ? colors.primary : 'transparent' },
                ]}
              >
                {done ? (
                  <Ionicons name="checkmark" size={14} color={colors.onPrimary} />
                ) : (
                  // The digit sits in a fixed circle; the step label beside it carries the large text.
                  <Text variant="caption" maxFontSizeMultiplier={1.2} color={current ? colors.primaryText : colors.textMuted}>
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text variant="caption" color={current ? colors.text : colors.textMuted} style={[styles.flex, current && styles.currentLabel]} numberOfLines={stacked ? undefined : 2}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>
      <Button testID="first-run-action" label={t(STEP_ACTION[view.current])} onPress={() => onAction(view.current)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hide: { paddingHorizontal: spacing.md },
  steps: { flexDirection: 'row', gap: spacing.xs },
  stepsStacked: { gap: spacing.xs },
  step: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: spacing.xs, borderRadius: 10 },
  // flex: 1 in a column with auto height would collapse the row.
  stepStacked: { flex: 0 },
  currentLabel: { fontWeight: '700' },
  badge: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
