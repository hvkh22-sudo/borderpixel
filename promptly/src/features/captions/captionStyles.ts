/**
 * A small set of polished caption styles shared by the in-app preview and the
 * native burn-in renderer (serialized as plain JSON to the native exporter).
 */

export type CaptionStyleId = 'clean' | 'bold' | 'contrast';

export interface CaptionStyle {
  id: CaptionStyleId;
  /** i18n key for the display name. */
  nameKey: string;
  pro: boolean;
  fontWeight: '600' | '800' | '900';
  /** Font size as a fraction of video width, so it scales with resolution. */
  fontSizeRatio: number;
  textColor: string;
  /** Optional box behind text. */
  backgroundColor: string | null;
  strokeColor: string | null;
  strokeWidthRatio: number;
  uppercase: boolean;
  /** Highlight colour for the currently spoken word (only with word timing). */
  highlightColor: string | null;
}

export const CAPTION_STYLES: Record<CaptionStyleId, CaptionStyle> = {
  clean: {
    id: 'clean',
    nameKey: 'captions.style.clean',
    pro: false,
    fontWeight: '600',
    fontSizeRatio: 0.052,
    textColor: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.55)',
    strokeColor: null,
    strokeWidthRatio: 0,
    uppercase: false,
    highlightColor: null,
  },
  bold: {
    id: 'bold',
    nameKey: 'captions.style.bold',
    pro: true,
    fontWeight: '900',
    fontSizeRatio: 0.068,
    textColor: '#FFFFFF',
    backgroundColor: null,
    strokeColor: '#000000',
    strokeWidthRatio: 0.006,
    uppercase: true,
    highlightColor: '#FFD43B',
  },
  contrast: {
    id: 'contrast',
    nameKey: 'captions.style.contrast',
    pro: true,
    fontWeight: '800',
    fontSizeRatio: 0.058,
    textColor: '#000000',
    backgroundColor: '#FFFFFF',
    strokeColor: null,
    strokeWidthRatio: 0,
    uppercase: false,
    highlightColor: null,
  },
};

/** Vertical position as a fraction of video height (centre of caption block). */
export type CaptionPosition = 'lower' | 'middle' | 'upper';

/**
 * Safe positions for 9:16 video: avoid the bottom ~20% where TikTok/Reels/
 * Shorts overlay their UI (captions, buttons). Values are conservative.
 */
export const CAPTION_POSITION_Y: Record<CaptionPosition, number> = {
  upper: 0.22,
  middle: 0.5,
  lower: 0.7,
};
