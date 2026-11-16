// Ink colours for signatures. A signature is one colour with varying alpha (drawn ones by
// construction; imported ones because the importer paints every pixel the ink's colour), so
// recolouring is setting the RGB of every pixel and keeping the alpha. Pure, so it's tested.

import { INK } from "./strokes";

export type Rgb = [number, number, number];

/** The pad's ready-made inks. "original" (an import's own colour) is offered for imports only. */
export const INKS = [
  { id: "black", label: "Black", hex: INK },
  { id: "blue", label: "Blue", hex: "#1c3a94" },
] as const;

export const DEFAULT_INK = INKS[0].hex;

/** "#rrggbb" (or "#rgb") to [r, g, b]; null if it isn't one. */
export function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

export function toHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

/** Set every pixel's colour, keeping its alpha. `data` is RGBA, as in ImageData. */
export function recolour(data: Uint8ClampedArray | Uint8Array, [r, g, b]: Rgb): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

/**
 * APCA lightness contrast (Lc) of ink on white paper, 0 to about 106. APCA rather than the WCAG
 * 2 ratio, which misjudges mid-tones (it rates some mid greys and blues worse than they read).
 * APCA-W3 0.0.98G, dark-on-light polarity only.
 */
export function contrastOnWhite([r, g, b]: Rgb): number {
  const lin = (v: number) => (v / 255) ** 2.4;
  let y = 0.2126729 * lin(r) + 0.7151522 * lin(g) + 0.072175 * lin(b);
  if (y < 0.022) y += (0.022 - y) ** 1.414;
  const s = (1 - y ** 0.57) * 1.14;
  return s < 0.1 ? 0 : (s - 0.027) * 100;
}

/** Too pale to read well on white paper: under Lc 45, APCA's floor for large text. */
export function tooLight(rgb: Rgb): boolean {
  return contrastOnWhite(rgb) < 45;
}
