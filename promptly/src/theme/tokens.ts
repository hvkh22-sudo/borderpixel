/**
 * Promptly design tokens. Original palette: calm ink surfaces, one violet
 * brand accent, and a warm red reserved exclusively for recording state.
 */
export const palette = {
  ink950: '#090A0F',
  ink900: '#0F1118',
  ink850: '#151823',
  ink800: '#1C2030',
  ink700: '#2A2F42',
  ink500: '#5B6178',
  ink400: '#8A90A6',
  ink200: '#C9CCD8',
  ink100: '#E6E8EF',
  ink50: '#F5F6FA',
  white: '#FFFFFF',
  violet600: '#5B4BE8',
  violet500: '#6D5EF5',
  violet300: '#A99FFF',
  violet100: '#ECE9FF',
  rec500: '#FF4D5A',
  /** Record button fill: white label passes 4.5:1 (rec500 is 3.25:1). */
  rec600: '#D92C3A',
  rec700: '#C62F3B',
  green500: '#2FBF71',
  green700: '#1C8049',
  amber500: '#F5A524',
  amber700: '#9A5B00',
} as const;

export interface ColorTokens {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textMuted: string;
  textInverse: string;
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  /** Primary-hue text and small glyphs (ghost buttons, badges, links): ≥ 4.5:1 on every surface. */
  primaryText: string;
  onPrimary: string;
  record: string;
  success: string;
  warning: string;
  danger: string;
  overlay: string;
}

export const lightColors: ColorTokens = {
  background: palette.ink50,
  surface: palette.white,
  surfaceRaised: palette.white,
  border: palette.ink100,
  text: palette.ink900,
  textMuted: palette.ink500,
  textInverse: palette.white,
  primary: palette.violet500,
  primaryPressed: palette.violet600,
  primarySoft: palette.violet100,
  primaryText: palette.violet600,
  onPrimary: palette.white,
  record: palette.rec600,
  // Darker variants on light surfaces: the 500s are 2.0–2.4:1 on white (WCAG text needs 4.5:1).
  success: palette.green700,
  warning: palette.amber700,
  danger: palette.rec700,
  overlay: 'rgba(9,10,15,0.55)',
};

export const darkColors: ColorTokens = {
  background: palette.ink950,
  surface: palette.ink900,
  surfaceRaised: palette.ink850,
  border: palette.ink800,
  text: palette.ink50,
  textMuted: palette.ink400,
  textInverse: palette.ink900,
  primary: palette.violet500,
  primaryPressed: palette.violet600,
  primarySoft: 'rgba(109,94,245,0.18)',
  primaryText: palette.violet300,
  onPrimary: palette.white,
  record: palette.rec600,
  success: palette.green500,
  warning: palette.amber500,
  danger: palette.rec500,
  overlay: 'rgba(0,0,0,0.6)',
};

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

/** Minimum touch target per Apple HIG (44pt) / Material (48dp). */
export const touchTarget = 48;

export const typography = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.2 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' as const },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: '500' as const },
  caption: { fontSize: 13, lineHeight: 17, fontWeight: '500' as const },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700' as const, letterSpacing: 0.8 },
};

export type TypographyVariant = keyof typeof typography;

export const motion = {
  fast: 150,
  base: 220,
  slow: 320,
};

/** Largest Dynamic Type / font-scale multiplier any app text grows to (Text and TextInput). */
export const MAX_FONT_SCALE = 1.8;
