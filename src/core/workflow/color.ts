/** Color math used by the design system, styling and accessibility checks. */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Blends `top` over `bottom` with the given alpha. */
export function blend(bottom: RGB, top: RGB, alpha: number): RGB {
  return [0, 1, 2].map((i) => bottom[i]! * (1 - alpha) + top[i]! * alpha) as RGB;
}

export function mix(a: string, b: string, t: number): string {
  return rgbToHex(blend(hexToRgb(a), hexToRgb(b), t));
}

/** WCAG relative luminance. */
export function luminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Picks text color for a background: white whenever it meets WCAG AA (4.5:1), which reads
 * better on saturated brand colors; otherwise whichever of black/white contrasts more.
 */
export function readableOn(bg: string): string {
  const rgb = hexToRgb(bg);
  const white = contrastRatio(rgb, [255, 255, 255]);
  if (white >= 4.5) return '#FFFFFF';
  return white >= contrastRatio(rgb, [0, 0, 0]) ? '#FFFFFF' : '#000000';
}
