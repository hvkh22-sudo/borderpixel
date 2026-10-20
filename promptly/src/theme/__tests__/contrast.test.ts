/* WCAG 2.2 AA contrast of the theme token pairs the UI actually renders. */
import { AA, contrastRatio } from '../contrast';
import { darkColors, lightColors, type ColorTokens } from '../tokens';

type Key = keyof ColorTokens;
const SURFACES: Key[] = ['background', 'surface', 'surfaceRaised'];

/** [foreground, background, minimum ratio] — every pair is checked in both themes. */
const PAIRS: [Key | string, Key, number][] = [
  // Body and secondary text.
  ...SURFACES.flatMap((bg): [Key, Key, number][] => [
    ['text', bg, AA.text],
    ['textMuted', bg, AA.text],
    ['primaryText', bg, AA.text], // ghost buttons, Cancel rows, links
    ['danger', bg, AA.text], // destructive rows and buttons, error text
    ['success', bg, AA.text], // export "Saved" status
    ['warning', bg, AA.text], // caption notes, billing issue, Bluetooth note
    // Icons and selected outlines (non-text, 1.4.11).
    ['primary', bg, AA.nonText],
    ['textMuted', bg, AA.nonText],
  ]),
  ['onPrimary', 'primary', AA.text], // primary buttons, selected chips/segments, hero text
  ['#FFFFFF', 'record', AA.text], // Record button label
  ['primaryText', 'primarySoft', AA.text], // PRO badge
  ['primary', 'primarySoft', AA.nonText], // icons on soft circles (Create, EmptyState, onboarding)
];

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
])('%s theme contrast', (_name, colors) => {
  const resolve = (c: Key | string) => (c in colors ? colors[c as Key] : c);
  it.each(PAIRS.map(([fg, bg, min]) => [String(fg), bg, min] as const))('%s on %s ≥ %d:1', (fg, bg, min) => {
    // Translucent tokens (dark primarySoft) are composited over the surface they sit on.
    const ratio = contrastRatio(resolve(fg), colors[bg], colors.surface);
    expect(Math.round(ratio * 100) / 100).toBeGreaterThanOrEqual(min);
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });

  it('composites translucent colours over the backdrop', () => {
    expect(contrastRatio('rgba(0,0,0,0)', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000000', 'rgba(255,255,255,0.5)', '#000000')).toBeLessThan(6);
  });
});
