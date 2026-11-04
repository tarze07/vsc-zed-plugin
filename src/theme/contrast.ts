/**
 * WCAG 2.x contrast helpers used to validate the Zed-like color themes (#5).
 *
 * Pure module (no `vscode` import) so it can be unit-tested with plain mocha.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** Alpha in the range 0..1. */
  a: number;
}

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Parses `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` into channels (0..255) and alpha (0..1). */
export function parseHexColor(hex: string): Rgba {
  const value = hex.trim();
  const match = HEX_RE.exec(value);
  if (!match) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  let digits = match[1];
  if (digits.length <= 4) {
    digits = digits
      .split('')
      .map((d) => d + d)
      .join('');
  }
  const channel = (i: number): number => parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  return {
    r: channel(0),
    g: channel(1),
    b: channel(2),
    a: digits.length === 8 ? channel(3) / 255 : 1,
  };
}

/** Composites `fg` (possibly translucent) over an opaque `bg`. */
export function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an opaque color. */
export function relativeLuminance(color: Rgba): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/**
 * WCAG contrast ratio (1..21) between a foreground and a background color.
 *
 * A translucent background is first composited over `base` (required in that case); a
 * translucent foreground is then composited over the resulting opaque background.
 */
export function contrastRatio(foreground: string, background: string, base?: string): number {
  let bg = parseHexColor(background);
  if (bg.a < 1) {
    if (!base) {
      throw new Error(`Background ${background} is translucent; a base color is required`);
    }
    bg = compositeOver(bg, parseHexColor(base));
  }
  const fg = compositeOver(parseHexColor(foreground), bg);
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA threshold for normal text. */
export const WCAG_AA_NORMAL = 4.5;
/** WCAG AA threshold for large text and non-text UI components. */
export const WCAG_AA_LARGE = 3;
