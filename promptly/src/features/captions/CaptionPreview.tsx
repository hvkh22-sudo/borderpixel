/** In-app caption rendering that mirrors the native burn-in styles. */
import { StyleSheet, Text, View } from 'react-native';

import { majorityDirection } from '../teleprompter/textDirection';
import { CAPTION_POSITION_Y, CAPTION_STYLES, type CaptionPosition, type CaptionStyleId } from './captionStyles';

interface Props {
  text: string | null;
  styleId: CaptionStyleId;
  position: CaptionPosition;
  /** Width of the rendered video frame, used to scale font size like the export. */
  frameWidth: number;
  /**
   * Index of the spoken word to highlight (from activeWordIndex), or -1.
   * Ignored when the style has no highlight colour.
   */
  activeWord?: number;
}

export function CaptionPreview({ text, styleId, position, frameWidth, activeWord = -1 }: Props) {
  if (!text) return null;
  const s = CAPTION_STYLES[styleId];
  const shown = s.uppercase ? text.toUpperCase() : text;
  const highlight = s.highlightColor && activeWord >= 0 ? s.highlightColor : null;
  const fontSize = Math.max(10, frameWidth * s.fontSizeRatio);
  return (
    // Visual overlay only: the cue text is editable in the cue list, and reading captions aloud
    // while the video plays would talk over its audio.
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.wrap, { top: `${CAPTION_POSITION_Y[position] * 100}%` }]}>
      <View style={[styles.box, s.backgroundColor ? { backgroundColor: s.backgroundColor, borderRadius: fontSize * 0.3 } : null, { paddingHorizontal: fontSize * 0.45, paddingVertical: fontSize * 0.25 }]}>
        <Text
          maxFontSizeMultiplier={1}
          style={{
            fontSize,
            lineHeight: fontSize * 1.2,
            fontWeight: s.fontWeight,
            color: s.textColor,
            textAlign: 'center',
            writingDirection: majorityDirection(text),
            textShadowColor: s.strokeColor ?? 'transparent',
            textShadowRadius: s.strokeColor ? frameWidth * s.strokeWidthRatio * 2 : 0,
          }}
        >
          {highlight
            ? shown.split(' ').map((w, i, all) => (
                <Text key={i} testID={i === activeWord ? 'caption-active-word' : undefined} style={i === activeWord ? { color: highlight } : null}>
                  {i < all.length - 1 ? `${w} ` : w}
                </Text>
              ))
            : shown}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: '7%', right: '7%', alignItems: 'center', transform: [{ translateY: -20 }] },
  box: { maxWidth: '100%' },
});
