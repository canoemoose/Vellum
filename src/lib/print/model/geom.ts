// Geometry shared by the print layout model. Pure: no DOM, no Svelte.
//
// Units: points (1/72 in), y down from the sheet's top-left, like the rest of the app.
// Millimetres only at the edges (UI text, printer capabilities).

export const MM = 72 / 25.4; // points per millimetre

export const mmToPt = (mm: number): number => mm * MM;
export const ptToMm = (pt: number): number => pt / MM;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Margins {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const ZERO_MARGINS: Margins = { left: 0, top: 0, right: 0, bottom: 0 };

export type Rotation = 0 | 90 | 180 | 270;

export function box(x0: number, y0: number, x1: number, y1: number): Box {
  return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
}

export const boxW = (b: Box): number => b.x1 - b.x0;
export const boxH = (b: Box): number => b.y1 - b.y0;
export const centreX = (b: Box): number => (b.x0 + b.x1) / 2;
export const centreY = (b: Box): number => (b.y0 + b.y1) / 2;

export function translate(b: Box, dx: number, dy: number): Box {
  return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy };
}

export function intersect(a: Box, b: Box): Box | null {
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

export function contains(outer: Box, inner: Box, eps = 1e-6): boolean {
  return inner.x0 >= outer.x0 - eps && inner.y0 >= outer.y0 - eps && inner.x1 <= outer.x1 + eps && inner.y1 <= outer.y1 + eps;
}

/** Normalise any angle in degrees to the nearest quarter turn. */
export function quarter(deg: number): Rotation {
  const q = ((Math.round(deg / 90) % 4) + 4) % 4;
  return (q * 90) as Rotation;
}

export function rotatedSize(s: Size, rot: number): Size {
  return quarter(rot) % 180 === 90 ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
}

/** The printable box of a sheet: the sheet less its margins. */
export function areaOf(sheet: Size, m: Margins): Box {
  return { x0: m.left, y0: m.top, x1: Math.max(m.left, sheet.w - m.right), y1: Math.max(m.top, sheet.h - m.bottom) };
}

export const isLandscape = (s: Size): boolean => s.w > s.h;

export function orient(s: Size, landscape: boolean): Size {
  const long = Math.max(s.w, s.h);
  const short = Math.min(s.w, s.h);
  return landscape ? { w: long, h: short } : { w: short, h: long };
}

const ISO: [string, number, number][] = [
  ["A0", 841, 1189],
  ["A1", 594, 841],
  ["A2", 420, 594],
  ["A3", 297, 420],
  ["A4", 210, 297],
  ["A5", 148, 210],
  ["A6", 105, 148],
  ["B1", 707, 1000],
  ["B2", 500, 707],
  ["B3", 353, 500],
  ["B4", 250, 353],
  ["B5", 176, 250],
  ["Letter", 215.9, 279.4],
  ["Legal", 215.9, 355.6],
  ["Tabloid", 279.4, 431.8],
  ["ANSI C", 431.8, 558.8],
  ["ANSI D", 558.8, 863.6],
  ["ANSI E", 863.6, 1117.6],
];

/** "A1" etc. for a size in points (either way round, within 2 mm), or null. */
export function isoName(s: Size, tolMm = 2): string | null {
  const a = Math.min(ptToMm(s.w), ptToMm(s.h));
  const b = Math.max(ptToMm(s.w), ptToMm(s.h));
  for (const [n, w, h] of ISO) if (Math.abs(a - w) <= tolMm && Math.abs(b - h) <= tolMm) return n;
  return null;
}

/** A named paper size in points, portrait. */
export function isoSize(name: string): Size | null {
  const e = ISO.find((x) => x[0].toLowerCase() === name.toLowerCase());
  return e ? { w: mmToPt(e[1]), h: mmToPt(e[2]) } : null;
}

/** "A3 landscape", "420 × 297 mm" style descriptions. */
export function describeSize(s: Size): string {
  const n = isoName(s);
  if (n) return `${n} ${isLandscape(s) ? "landscape" : "portrait"}`;
  return `${fmtMm(s.w)} × ${fmtMm(s.h)} mm`;
}

export function fmtMm(pt: number): string {
  const mm = ptToMm(pt);
  const r = Math.round(mm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * The effective drawing scale 1:N of a page drawn at 1:`drawing` printed at `factor` (sheet
 * points per page point): N = drawing / factor.
 */
export function effectiveRatio(drawing: number, factor: number): number {
  return drawing / factor;
}

/** The factor that prints a 1:`drawing` page at exactly 1:`target`. */
export function factorForRatio(drawing: number, target: number): number {
  return drawing / target;
}

/** A ratio rounded for display: 1:206, 1:12.5, 1:1. */
export function fmtRatio(n: number): string {
  if (!isFinite(n) || n <= 0) return "1:?";
  const r = n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
  return `1:${r}`;
}

export function fmtPercent(factor: number): string {
  const p = factor * 100;
  const r = p >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
  return `${r}%`;
}
