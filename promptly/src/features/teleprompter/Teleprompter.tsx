/**
 * Teleprompter renderer. Scrolling runs on the UI thread (Reanimated shared
 * values + frame callback); React only re-renders when the script, settings
 * or the spoken-text highlight change — never per frame.
 *
 * Geometry: content is translated by -offset. The first line starts at the
 * reading line (topPad = viewport * readingLine), so offset === line centre
 * puts that line exactly on the reading line.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type TextLayoutEvent } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { PrompterSettings, ScrollMode } from '../../state/settings';
import { countWords } from '../voice-follow/text';
import { LineIndex, buildLineIndex, followAnimationMs, lineForChar, pixelsPerSecond, scrollOffsetForChar } from './scrollModel';

export interface TeleprompterHandle {
  restart(): void;
  jumpToChar(charOffset: number): void;
  nudgeLines(lines: number): void;
}

interface Props {
  script: string;
  settings: PrompterSettings;
  mode: ScrollMode;
  /** Timed mode: whether the prompter is moving. */
  playing: boolean;
  /** Voice mode: character offset the speaker has reached. */
  followCharOffset: number | null;
  /** Text before this offset is shown dimmed (already spoken). */
  highlightCharOffset?: number;
  /** User tapped a line (Voice mode resync / section jump). */
  onTapChar?: (charOffset: number) => void;
  /** Timed/manual: user finished dragging. */
  onUserScroll?: () => void;
  /** Reached the end of the script in timed mode. */
  onEnd?: () => void;
}

export const Teleprompter = forwardRef<TeleprompterHandle, Props>(function Teleprompter(
  { script, settings, mode, playing, followCharOffset, highlightCharOffset = 0, onTapChar, onUserScroll, onEnd },
  ref,
) {
  const reducedMotion = useReducedMotion();
  const [viewport, setViewport] = useState(0);
  const [lineIndex, setLineIndex] = useState<LineIndex | null>(null);
  const lineIndexRef = useRef<LineIndex | null>(null);

  const offset = useSharedValue(0);
  const maxOffset = useSharedValue(0);
  const pps = useSharedValue(0);
  const running = useSharedValue(false);
  const dragging = useSharedValue(false);
  const endNotified = useSharedValue(false);

  const topPad = viewport * settings.readingLine;
  const wordCount = useMemo(() => countWords(script), [script]);
  const contentHeight = lineIndex?.contentHeight ?? 0;

  useEffect(() => {
    maxOffset.value = contentHeight;
    pps.value = pixelsPerSecond(contentHeight, wordCount, settings.wpm);
  }, [contentHeight, wordCount, settings.wpm, maxOffset, pps]);

  useEffect(() => {
    running.value = mode === 'timed' && playing;
    if (running.value) endNotified.value = false;
  }, [mode, playing, running, endNotified]);

  const notifyEnd = useCallback(() => onEnd?.(), [onEnd]);

  useFrameCallback((frame) => {
    'worklet';
    if (!running.value || dragging.value) return;
    const dt = Math.min(frame.timeSincePreviousFrame ?? 16, 64);
    const next = offset.value + (pps.value * dt) / 1000;
    if (next >= maxOffset.value) {
      offset.value = maxOffset.value;
      if (!endNotified.value) {
        endNotified.value = true;
        scheduleOnRN(notifyEnd);
      }
    } else {
      offset.value = next;
    }
  });

  // Voice Follow: glide to the speaker's line.
  useEffect(() => {
    if (mode !== 'voice' || followCharOffset == null || !lineIndexRef.current || viewport === 0) return;
    const target = scrollOffsetForChar(lineIndexRef.current, followCharOffset, viewport, settings.readingLine, topPad);
    const lineHeight = settings.fontSize * settings.lineHeight;
    if (Math.abs(target - offset.value) < 1) return;
    offset.value = reducedMotion ? target : withTiming(target, { duration: followAnimationMs(target - offset.value, lineHeight) });
  }, [followCharOffset, mode, viewport, topPad, settings.readingLine, settings.fontSize, settings.lineHeight, offset, reducedMotion]);

  const jumpToChar = useCallback(
    (charOffset: number) => {
      const idx = lineIndexRef.current;
      if (!idx || viewport === 0) return;
      cancelAnimation(offset);
      // Place the line's centre on the reading line (see geometry note).
      const li = lineForChar(idx, charOffset);
      const line = idx.lines[li];
      if (line) offset.value = withTiming(line.y + line.height / 2, { duration: reducedMotion ? 0 : 250 });
    },
    [offset, viewport, reducedMotion],
  );

  useImperativeHandle(
    ref,
    () => ({
      restart: () => {
        cancelAnimation(offset);
        endNotified.value = false;
        offset.value = withTiming(0, { duration: reducedMotion ? 0 : 300 });
      },
      jumpToChar,
      nudgeLines: (lines: number) => {
        const lh = settings.fontSize * settings.lineHeight;
        cancelAnimation(offset);
        offset.value = withTiming(Math.max(0, Math.min(maxOffset.value, offset.value + lines * lh)), { duration: 200 });
      },
    }),
    [jumpToChar, offset, endNotified, reducedMotion, settings.fontSize, settings.lineHeight, maxOffset],
  );

  const handleTap = useCallback(
    (y: number) => {
      const idx = lineIndexRef.current;
      if (!idx || !onTapChar) return;
      const contentY = y - topPad + offset.value;
      const li = idx.lines.findIndex((l) => contentY >= l.y && contentY < l.y + l.height);
      if (li >= 0) onTapChar(idx.starts[li]!);
    },
    [onTapChar, topPad, offset],
  );

  const userScrolled = useCallback(() => onUserScroll?.(), [onUserScroll]);

  const pan = usePanGesture({
    minDistance: 6,
    onActivate: () => {
      'worklet';
      dragging.value = true;
      cancelAnimation(offset);
    },
    onUpdate: (e) => {
      'worklet';
      offset.value = Math.max(0, Math.min(maxOffset.value, offset.value - e.changeY));
    },
    onDeactivate: (e) => {
      'worklet';
      dragging.value = false;
      if (mode === 'manual') {
        offset.value = withDecay({ velocity: -e.velocityY, clamp: [0, maxOffset.value] });
      }
      scheduleOnRN(userScrolled);
    },
  });

  const tap = useTapGesture({
    runOnJS: true,
    onActivate: (e) => handleTap(e.y),
  });

  const gesture = useCompetingGestures(pan, tap);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: topPad - offset.value }, { scaleX: settings.mirror ? -1 : 1 }],
  }));

  const onLayout = (e: LayoutChangeEvent) => setViewport(e.nativeEvent.layout.height);

  const onTextLayout = (e: TextLayoutEvent) => {
    const idx = buildLineIndex(e.nativeEvent.lines.map((l) => ({ text: l.text, y: l.y, height: l.height })));
    lineIndexRef.current = idx;
    setLineIndex(idx);
  };

  const textColor = settings.highContrast ? '#FFFF00' : '#FFFFFF';
  const spokenEnd = Math.max(0, Math.min(highlightCharOffset, script.length));
  const textStyle = {
    fontSize: settings.fontSize,
    lineHeight: settings.fontSize * settings.lineHeight,
    fontWeight: settings.fontWeight,
    textAlign: settings.align,
    color: textColor,
    opacity: settings.textOpacity,
  } as const;

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.viewport} onLayout={onLayout} accessibilityRole="text" accessibilityLabel={script}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${settings.highContrast ? 0.85 : settings.backdropOpacity})` }]} />
        {settings.showReadingGuide && viewport > 0 ? (
          <View
            pointerEvents="none"
            style={[
              styles.guide,
              {
                top: topPad - (settings.fontSize * settings.lineHeight) / 2 - 4,
                height: settings.fontSize * settings.lineHeight + 8,
              },
            ]}
          />
        ) : null}
        <Animated.View style={[styles.content, { width: `${Math.round(settings.textWidth * 100)}%` }, contentStyle]}>
          <Text onTextLayout={onTextLayout} style={textStyle} maxFontSizeMultiplier={1}>
            {spokenEnd > 0 ? <Text style={styles.spoken}>{script.slice(0, spokenEnd)}</Text> : null}
            {script.slice(spokenEnd)}
          </Text>
          <View style={{ height: viewport }} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  content: { alignSelf: 'center' },
  spoken: { opacity: 0.4 },
  guide: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
});
