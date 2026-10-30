/**
 * Teleprompter renderer. Scrolling runs on the UI thread (Reanimated shared
 * values + frame callback); React only re-renders when the script, settings
 * or the spoken-text highlight change — never per frame.
 *
 * Geometry: content is translated by -offset. The first line starts at the
 * reading line (topPad = viewport * readingLine), so offset === line centre
 * puts that line exactly on the reading line.
 *
 * The script is rendered as one memoized <Text> per hard line (ScriptChunk),
 * not one giant <Text>: a Voice Follow highlight update then re-renders and
 * re-measures only the chunk whose spoken boundary moved. Per-chunk layouts
 * are merged into one script-wide LineIndex (buildChunkedLineIndex), so the
 * charOffset → scroll offset contract is unchanged.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { I18nManager, StyleSheet, View, type LayoutChangeEvent, type TextLayoutEvent } from 'react-native';
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
import { detectDirection, scriptTextAlign } from './textDirection';
import { BLOCK_SIZE, ChunkBlock, blockSpokenEnd } from './ScriptChunk';
import {
  type ChunkLayout,
  type LineIndex,
  buildChunkedLineIndex,
  followAnimationMs,
  lineAtY,
  lineForChar,
  pixelsPerSecond,
  remapOffset,
  scrollOffsetForChar,
  splitScript,
  timedStep,
} from './scrollModel';

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
  const [contentHeight, setContentHeight] = useState(0);
  const lineIndexRef = useRef<LineIndex | null>(null);
  const chunks = useMemo(() => splitScript(script), [script]);
  const blockStarts = useMemo(() => Array.from({ length: Math.ceil(chunks.length / BLOCK_SIZE) }, (_, b) => b * BLOCK_SIZE), [chunks]);
  const chunksRef = useRef(chunks);
  // Kept by chunk index: a chunk whose text and position did not change does
  // not report its layout again, so its last report stays valid.
  const chunkLayouts = useRef<ChunkLayout[]>([]);
  const rebuildTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const offset = useSharedValue(0);
  const maxOffset = useSharedValue(0);
  const pps = useSharedValue(0);
  const running = useSharedValue(false);
  const dragging = useSharedValue(false);
  const endNotified = useSharedValue(false);
  /** A restart/jump animation owns `offset`; the timed frame callback must not write it. */
  const animating = useSharedValue(false);
  const animGen = useSharedValue(0);

  const topPad = viewport * settings.readingLine;
  const wordCount = useMemo(() => countWords(script), [script]);
  // Direction follows the script's content, not the UI language.
  const direction = useMemo(() => detectDirection(script), [script]);

  const rebuildIndex = useCallback(() => {
    rebuildTimer.current = null;
    const idx = buildChunkedLineIndex(chunksRef.current, chunkLayouts.current);
    if (!idx) return;
    const prev = lineIndexRef.current;
    // Reflow (rotation, font size, width): stay on the same text instead of the same pixel,
    // which would land elsewhere or past the new end. A running animation retargets itself.
    if (prev && !animating.value && !dragging.value && (prev.contentHeight !== idx.contentHeight || prev.lines.length !== idx.lines.length)) {
      offset.value = remapOffset(prev, idx, offset.value);
      if (offset.value < idx.contentHeight) endNotified.value = false;
    }
    lineIndexRef.current = idx;
    setContentHeight(idx.contentHeight);
  }, [animating, dragging, offset, endNotified]);

  useEffect(() => {
    chunksRef.current = chunks;
    chunkLayouts.current.length = chunks.length;
    lineIndexRef.current = null;
    rebuildIndex();
  }, [chunks, rebuildIndex]);

  useEffect(
    () => () => {
      if (rebuildTimer.current) clearTimeout(rebuildTimer.current);
    },
    [],
  );

  // Many chunks report layout in one native batch: rebuild the index once.
  const scheduleRebuild = useCallback(() => {
    if (!rebuildTimer.current) rebuildTimer.current = setTimeout(rebuildIndex, 0);
  }, [rebuildIndex]);

  const onChunkLayout = useCallback(
    (index: number, y: number) => {
      chunkLayouts.current[index] = { ...chunkLayouts.current[index], y };
      scheduleRebuild();
    },
    [scheduleRebuild],
  );

  const onChunkTextLayout = useCallback(
    (index: number, e: TextLayoutEvent) => {
      const lines = e.nativeEvent.lines.map((l) => ({ text: l.text, y: l.y, height: l.height }));
      chunkLayouts.current[index] = { ...chunkLayouts.current[index], lines };
      scheduleRebuild();
    },
    [scheduleRebuild],
  );

  /** withTiming on `offset` that the timed frame callback will not cancel. */
  const animateTo = useCallback(
    (target: number, duration: number) => {
      const gen = animGen.value + 1;
      animGen.value = gen;
      animating.value = true;
      offset.value = withTiming(target, { duration }, () => {
        'worklet';
        // A newer animation may have replaced this one; it clears the flag itself.
        if (animGen.value === gen) animating.value = false;
      });
    },
    [offset, animating, animGen],
  );

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
    if (!running.value) return;
    const next = timedStep(offset.value, pps.value, frame.timeSincePreviousFrame ?? 16, maxOffset.value, dragging.value || animating.value);
    if (next === null) return;
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
    if (reducedMotion) offset.value = target;
    else animateTo(target, followAnimationMs(target - offset.value, lineHeight));
    // contentHeight: re-run once the line index is first built.
  }, [followCharOffset, mode, viewport, topPad, settings.readingLine, settings.fontSize, settings.lineHeight, offset, reducedMotion, animateTo, contentHeight]);

  const jumpToChar = useCallback(
    (charOffset: number) => {
      const idx = lineIndexRef.current;
      if (!idx || viewport === 0) return;
      cancelAnimation(offset);
      // Place the line's centre on the reading line (see geometry note).
      const li = lineForChar(idx, charOffset);
      const line = idx.lines[li];
      if (line) animateTo(line.y + line.height / 2, reducedMotion ? 0 : 250);
    },
    [offset, viewport, reducedMotion, animateTo],
  );

  useImperativeHandle(
    ref,
    () => ({
      restart: () => {
        cancelAnimation(offset);
        endNotified.value = false;
        animateTo(0, reducedMotion ? 0 : 300);
      },
      jumpToChar,
      nudgeLines: (lines: number) => {
        const lh = settings.fontSize * settings.lineHeight;
        cancelAnimation(offset);
        animateTo(Math.max(0, Math.min(maxOffset.value, offset.value + lines * lh)), 200);
      },
    }),
    [jumpToChar, offset, endNotified, reducedMotion, settings.fontSize, settings.lineHeight, maxOffset, animateTo],
  );

  const handleTap = useCallback(
    (y: number) => {
      const idx = lineIndexRef.current;
      if (!idx || !onTapChar) return;
      const contentY = y - topPad + offset.value;
      const li = lineAtY(idx, contentY);
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
      animating.value = false;
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

  const spokenEnd = Math.max(0, Math.min(highlightCharOffset, script.length));
  // Stable across highlight updates so memoized chunks can skip rendering.
  const textStyle = useMemo(
    () =>
      ({
        fontSize: settings.fontSize,
        lineHeight: settings.fontSize * settings.lineHeight,
        fontWeight: settings.fontWeight,
        textAlign: scriptTextAlign(settings.align, direction, I18nManager.isRTL),
        writingDirection: direction,
        color: settings.highContrast ? '#FFFF00' : '#FFFFFF',
        opacity: settings.textOpacity,
      }) as const,
    [settings.fontSize, settings.lineHeight, settings.fontWeight, settings.align, settings.highContrast, settings.textOpacity, direction],
  );

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
          {blockStarts.map((first) => (
            <ChunkBlock
              key={first}
              first={first}
              chunks={chunks}
              spokenEnd={blockSpokenEnd(chunks, first, spokenEnd)}
              style={textStyle}
              onChunkLayout={onChunkLayout}
              onChunkTextLayout={onChunkTextLayout}
            />
          ))}
          <View style={{ height: viewport }} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  content: { alignSelf: 'center' },
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
