// Colour conversions for the custom colour picker: RGB 0..1 (as markups store it), HSV, hex.
// Pure.

import type { Rgb } from "./types";

export interface Hsv {
  /** 0..360 */
  h: number;
  /** 0..1 */
  s: number;
  v: number;
}

export function rgbToHsv([r, g, b]: Rgb): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return [r + m, g + m, b + m];
}

/** "#RRGGBB". */
export function toHex(c: Rgb): string {
  return "#" + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** "#RGB", "#RRGGBB" or without the "#"; null if it isn't one. */
export function fromHex(s: string): Rgb | null {
  let h = s.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
}

/** Same colour to within 8-bit rounding. */
export function sameColour(a: Rgb | null, b: Rgb | null): boolean {
  return !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) < 0.01);
}
