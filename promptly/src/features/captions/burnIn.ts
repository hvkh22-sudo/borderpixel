/** Builds the native burn-in payload (shared contract in modules/promptly-media). */
import type { NativeCaptionStyle, NativeCue } from '../../../modules/promptly-media';
import { cueHasWordTiming, type Cue } from './captions';
import { CAPTION_POSITION_Y, CAPTION_STYLES, type CaptionPosition, type CaptionStyleId } from './captionStyles';

export function burnInPayload(
  cues: Cue[],
  styleId: CaptionStyleId,
  position: CaptionPosition,
  /** Word highlight is on and allowed (Pro). */
  highlight: boolean,
): { cues: NativeCue[]; style: NativeCaptionStyle } {
  const s = CAPTION_STYLES[styleId];
  const lit = highlight && !!s.highlightColor;
  return {
    cues: cues.map((c) => ({
      startMs: c.startMs,
      endMs: c.endMs,
      text: c.text,
      // Only cues whose word timing is still valid (not edited) get a highlight.
      ...(lit && cueHasWordTiming(c) ? { words: c.words.map(({ startMs, endMs }) => ({ startMs, endMs })) } : {}),
    })),
    style: {
      fontWeight: s.fontWeight,
      fontSizeRatio: s.fontSizeRatio,
      textColor: s.textColor,
      backgroundColor: s.backgroundColor,
      strokeColor: s.strokeColor,
      strokeWidthRatio: s.strokeWidthRatio,
      uppercase: s.uppercase,
      highlightColor: lit ? s.highlightColor : null,
      positionY: CAPTION_POSITION_Y[position],
    },
  };
}
