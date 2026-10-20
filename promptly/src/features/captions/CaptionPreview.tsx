/** In-app caption rendering that mirrors the native burn-in styles. */
import { StyleSheet, Text, View } from 'react-native';

import { detectDirection } from '../teleprompter/textDirection';
import { CAPTION_POSITION_Y, CAPTION_STYLES, type CaptionPosition, type CaptionStyleId } from './captionStyles';

interface Props {
  text: string | null;
  styleId: CaptionStyleId;
  position: CaptionPosition;
  /** Width of the rendered video frame, used to scale font size like the export. */
  frameWidth: number;
}

export function CaptionPreview({ text, styleId, position, frameWidth }: Props) {
  if (!text) return null;
  const s = CAPTION_STYLES[styleId];
  const fontSize = Math.max(10, frameWidth * s.fontSizeRatio);
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: `${CAPTION_POSITION_Y[position] * 100}%` }]}>
      <View style={[styles.box, s.backgroundColor ? { backgroundColor: s.backgroundColor, borderRadius: fontSize * 0.3 } : null, { paddingHorizontal: fontSize * 0.45, paddingVertical: fontSize * 0.25 }]}>
        <Text
          maxFontSizeMultiplier={1}
          style={{
            fontSize,
            lineHeight: fontSize * 1.2,
            fontWeight: s.fontWeight,
            color: s.textColor,
            textAlign: 'center',
            writingDirection: detectDirection(text),
            textShadowColor: s.strokeColor ?? 'transparent',
            textShadowRadius: s.strokeColor ? frameWidth * s.strokeWidthRatio * 2 : 0,
          }}
        >
          {s.uppercase ? text.toUpperCase() : text}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: '7%', right: '7%', alignItems: 'center', transform: [{ translateY: -20 }] },
  box: { maxWidth: '100%' },
});
