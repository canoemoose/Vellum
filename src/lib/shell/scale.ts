// Drawing scale: which detected candidate to trust, the status bar text, parsing what the
// user types in the Drawing scale dialog.

export type ScaleSource = "detected" | "manual";

export interface DocScale {
  /** N in 1:N. */
  ratio: number;
  source: ScaleSource;
}

/** The shape of a findScale result (render/types.ts ScaleCandidate) that this module needs. */
export interface CandidateLike {
  ratio: number;
  text: string;
  bbox: [number, number, number, number];
}

export const SCALE_PRESETS = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000, 1250, 2500];

export const MIN_RATIO = 1;
export const MAX_RATIO = 100000;

/** "1:200", "1:2.5". */
export function formatRatio(ratio: number): string {
  const r = Math.round(ratio * 100) / 100;
  return `1:${r}`;
}

export function scaleStatusText(s: DocScale | null): string {
  if (!s) return "Scale not set";
  return s.source === "detected" ? `Scale ${formatRatio(s.ratio)} (from title block)` : `Scale ${formatRatio(s.ratio)}`;
}

/**
 * Whether a candidate sits where title blocks live: the bottom-right quarter of the page, a
 * strip down the right-hand edge, or a strip along the bottom. Pages are in unrotated points,
 * y down.
 */
export function inTitleBlockZone(bbox: [number, number, number, number], pageW: number, pageH: number): boolean {
  const cx = (bbox[0] + bbox[2]) / 2 / pageW;
  const cy = (bbox[1] + bbox[3]) / 2 / pageH;
  return (cx > 0.5 && cy > 0.5) || cx > 0.8 || cy > 0.85;
}

/**
 * Smallest text a title-block scale is written in, points (character height, the shorter
 * side of the match's box). 4 pt is about 1.4 mm; title blocks use 2.5 mm text or larger.
 * Tiny matches are labels inside the drawing (the aerial test file has dozens).
 */
export const MIN_TEXT_PT = 4;

/**
 * The scale to adopt automatically on open: the best candidate, but only when it is in a
 * title-block position and written at a legible size, so a stray "1:10" in a note on an
 * aerial photo isn't taken as the drawing scale. 1:1 is never adopted (it's nearly always a
 * detail or a "not to scale" mark).
 */
export function pickDetectedScale(cands: CandidateLike[], pageW: number, pageH: number): number | null {
  for (const c of cands) {
    if (c.ratio <= 1 || c.ratio > MAX_RATIO) continue;
    const [x0, y0, x1, y1] = c.bbox;
    if (Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0)) < MIN_TEXT_PT) continue;
    if (inTitleBlockZone(c.bbox, pageW, pageH)) return c.ratio;
  }
  return null;
}

/** Parse "1:200", "1 : 200", "1/200" or "200". Returns null when it isn't a usable ratio. */
export function parseScaleInput(s: string): number | null {
  const t = s.trim().replace(/\s+/g, "");
  const m = /^(?:1[:/∶])?(\d+(?:[.,]\d+)?)$/.exec(t);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n < MIN_RATIO || n > MAX_RATIO) return null;
  return n;
}

/** Remembered hand-set scales, keyed by file path. Most recent last, capped. */
export function rememberScale(
  map: Record<string, number>,
  key: string,
  ratio: number | null,
  cap = 200,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) if (k !== key) out[k] = v;
  if (ratio !== null) out[key] = ratio;
  const keys = Object.keys(out);
  for (let i = 0; i < keys.length - cap; i++) delete out[keys[i]];
  return out;
}
