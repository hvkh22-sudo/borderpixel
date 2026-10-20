/**
 * Script text direction. The prompter and the script editor follow the
 * SCRIPT's content, not the UI language: a Hebrew script reads right-to-left
 * in an English UI, and an English script reads left-to-right in a Hebrew UI.
 * Pure — no React Native imports — so it is unit-tested directly.
 */
export type TextDirection = 'rtl' | 'ltr';

/** Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic, Arabic Extended + presentation forms. */
const STRONG_RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/u;
/** Any letter (or combining mark of a letter) that is not in an RTL block counts as strong LTR. */
const LETTER = /\p{L}/u;

/**
 * Direction of the first strong directional character (Unicode bidi rule
 * P2/P3, simplified). Digits, punctuation, emoji and whitespace are neutral.
 * Text with no strong character (e.g. empty) gets `fallback`.
 */
export function detectDirection(text: string, fallback: TextDirection = 'ltr'): TextDirection {
  for (const ch of text) {
    if (STRONG_RTL.test(ch)) {
      // Hebrew/Arabic blocks also hold neutral points (punctuation, digits, marks);
      // only letters decide direction.
      if (LETTER.test(ch)) return 'rtl';
      continue;
    }
    if (LETTER.test(ch)) return 'ltr';
  }
  return fallback;
}

/**
 * React Native `textAlign` for script text. The prompter's 'left' setting
 * means "start of line" in the script's direction.
 *
 * RN swaps 'left'/'right' when the surrounding layout is RTL (iOS
 * RCTResolveTextAlignment, Android TextAttributeProps.getTextAlignment), so
 * to land on the physical edge we want, flip once more for an RTL layout.
 */
export function scriptTextAlign(align: 'left' | 'center', direction: TextDirection, layoutIsRtl: boolean): 'left' | 'right' | 'center' {
  if (align === 'center') return 'center';
  const physicalRight = direction === 'rtl';
  return physicalRight !== layoutIsRtl ? 'right' : 'left';
}
