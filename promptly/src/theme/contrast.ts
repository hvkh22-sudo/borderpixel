/**
 * WCAG 2.x contrast helpers for theme tokens (used by tests and audits).
 * Accepts `#RRGGBB` and `rgba(r,g,b,a)`; translucent colours are composited
 * over the given backdrop first, as they render on screen.
 */
type Rgb = [number, number, number];

function parse(color: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1] ?? '0', 16);
    return { rgb: [n >> 16, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color);
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  throw new Error(`Unsupported colour: ${color}`);
}

/** Composites `color` over an opaque `backdrop`. */
export function flatten(color: string, backdrop: string): Rgb {
  const { rgb, alpha } = parse(color);
  const base = parse(backdrop).rgb;
  return rgb.map((c, i) => c * alpha + (base[i] ?? 0) * (1 - alpha)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Contrast ratio (1–21) of `fg` on `bg`. `bg` may itself be translucent: it is
 * composited over `backdrop` (default white) before `fg` is composited over it.
 */
export function contrastRatio(fg: string, bg: string, backdrop = '#FFFFFF'): number {
  const bgRgb = flatten(bg, backdrop);
  const bgHex = `rgb(${bgRgb.map(Math.round).join(',')})`;
  const a = luminance(flatten(fg, bgHex));
  const b = luminance(bgRgb);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** WCAG 2.2 AA thresholds. */
export const AA = { text: 4.5, largeText: 3, nonText: 3 } as const;
