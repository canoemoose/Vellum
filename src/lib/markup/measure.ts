// Measuring maths and formatting: lengths, areas, perimeters and angles from page points, the
// conversions from page points to millimetres on paper and in the real world, the text each
// value reads as, and parsing a distance typed in for calibration. Metric only. Pure, and a
// leaf: the measuring kinds (kinds/measure*.ts) import from here, never the other way round.
// See docs/editing-phase4-scope.md.

import type { Pt } from "./base";

/** Millimetres in a PDF point (1/72 inch). */
export const MM_PER_PT = 25.4 / 72;

// ---------------------------------------------------------------- geometry, in page points

/** The length of a run of points (closed: back to the first). */
export function pathLength(pts: Pt[], closed = false): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 2) d += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return d;
}

/**
 * The area inside a polygon, by the shoelace formula, always positive. A self-crossing outline
 * counts its lobes against each other (a figure of eight measures nothing), as the formula
 * does in every app that uses it; `selfCrossing` tells the label to say so.
 */
export function polygonArea(v: Pt[]): number {
  let a = 0;
  for (let i = 0; i < v.length; i++) {
    const p = v[i], q = v[(i + 1) % v.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** Whether any two edges of a closed outline cross (not counting neighbours meeting at a corner). */
export function selfCrossing(v: Pt[]): boolean {
  const n = v.length;
  if (n < 4) return false;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const meets = (a: Pt, b: Pt, c: Pt, d: Pt) => {
    const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // the closing edge and the first share a corner
      if (meets(v[i], v[(i + 1) % n], v[j], v[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** The angle at `corner` between the arms to `a` and `b`, degrees, 0 to 180. 0 if an arm has no length. */
export function angleAt(a: Pt, corner: Pt, b: Pt): number {
  const u: Pt = [a[0] - corner[0], a[1] - corner[1]];
  const v: Pt = [b[0] - corner[0], b[1] - corner[1]];
  if (Math.hypot(...u) === 0 || Math.hypot(...v) === 0) return 0;
  const ang = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
  return (ang * 180) / Math.PI;
}

/**
 * Where a polygon's label goes: its centroid (the area's centre of mass), or, for an outline
 * whose centroid falls outside it (an L or a C shape), the middle of the widest stretch inside
 * it along the horizontal line through the centroid.
 */
export function labelPoint(v: Pt[]): Pt {
  if (v.length === 0) return [0, 0];
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < v.length; i++) {
    const p = v[i], q = v[(i + 1) % v.length];
    const k = p[0] * q[1] - q[0] * p[1];
    a += k;
    cx += (p[0] + q[0]) * k;
    cy += (p[1] + q[1]) * k;
  }
  const mean: Pt = [v.reduce((s, p) => s + p[0], 0) / v.length, v.reduce((s, p) => s + p[1], 0) / v.length];
  if (Math.abs(a) < 1e-9) return mean;
  const c: Pt = [cx / (3 * a), cy / (3 * a)];
  if (inside(c, v)) return c;
  // The crossings of the horizontal through c, paired into inside stretches; take the widest.
  const xs: number[] = [];
  for (let i = 0; i < v.length; i++) {
    const p = v[i], q = v[(i + 1) % v.length];
    if (p[1] > c[1] !== q[1] > c[1]) xs.push(p[0] + ((c[1] - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
  }
  xs.sort((x, y) => x - y);
  let best: Pt = mean, w = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > w) {
      w = xs[i + 1] - xs[i];
      best = [(xs[i] + xs[i + 1]) / 2, c[1]];
    }
  }
  return best;
}

function inside(p: Pt, v: Pt[]): boolean {
  let r = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const [xi, yi] = v[i], [xj, yj] = v[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
}

/**
 * The direction a label along the line from a to b reads in: the line's own direction or its
 * reverse, whichever isn't upside down on the page. Rightwards wins; a vertical line reads
 * upwards (bottom to top, as drawings letter vertical dimensions). Page axes, y down.
 */
export function uprightDir(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  if (l === 0) return [1, 0];
  let d: Pt = [dx / l, dy / l];
  // A hair either side of vertical counts as vertical, so a line drawn with Shift doesn't flip.
  if (d[0] < -1e-9 || (Math.abs(d[0]) <= 1e-9 && d[1] > 0)) d = [-d[0], -d[1]];
  return [d[0] + 0, d[1] + 0];
}

// ---------------------------------------------------------------- units

/** How a page measures: its scale (N in 1:N, or null when none is set) and its /UserUnit. */
export interface PageMeasure {
  ratio: number | null;
  /** Points per page unit over 1: a page with /UserUnit 10 has units ten points long. */
  userUnit: number;
}

/** Millimetres on paper for a length in page units. */
export const paperMm = (units: number, userUnit = 1): number => units * userUnit * MM_PER_PT;

/** Millimetres in the real world for a length in page units, or null with no scale. */
export const realMm = (units: number, pm: PageMeasure): number | null => (pm.ratio === null ? null : paperMm(units, pm.userUnit) * pm.ratio);

/** Square millimetres on paper for an area in square page units. */
export const paperMm2 = (units2: number, userUnit = 1): number => units2 * (userUnit * MM_PER_PT) ** 2;

/** Square millimetres in the real world, or null with no scale. */
export const realMm2 = (units2: number, pm: PageMeasure): number | null => (pm.ratio === null ? null : paperMm2(units2, pm.userUnit) * pm.ratio * pm.ratio);

// ---------------------------------------------------------------- formatting

/** Real-world units: automatic (m from 1 m up, mm below), always mm, always m. */
export type UnitMode = "auto" | "mm" | "m";

export interface MeasureFormat {
  units: UnitMode;
  /** Decimal places for metres and square metres. Millimetres are always whole. */
  decimals: number;
}

export const DEFAULT_FORMAT: MeasureFormat = { units: "auto", decimals: 2 };
export const MAX_DECIMALS = 4;

/** A format with every field in range. */
export function sanitiseFormat(raw: unknown): MeasureFormat {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const units = f.units === "mm" || f.units === "m" ? f.units : "auto";
  const d = typeof f.decimals === "number" && Number.isFinite(f.decimals) ? Math.round(f.decimals) : DEFAULT_FORMAT.decimals;
  return { units, decimals: Math.min(MAX_DECIMALS, Math.max(0, d)) };
}

/** Fixed decimals with no "-0". */
function fixed(v: number, d: number): string {
  const s = v.toFixed(d);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

/** Which unit a real-world length is written in. */
export function lengthUnit(mm: number, f: MeasureFormat): "mm" | "m" {
  if (f.units !== "auto") return f.units;
  // Decided on the rounded value, so 999.6 mm reads "1.00 m", not "1000 mm".
  return Math.abs(Math.round(mm)) >= 1000 ? "m" : "mm";
}

/** A real-world length: "12.40 m", "850 mm". */
export function formatLength(mm: number, f: MeasureFormat = DEFAULT_FORMAT): string {
  return lengthUnit(mm, f) === "m" ? `${fixed(mm / 1000, f.decimals)} m` : `${fixed(Math.round(mm), 0)} mm`;
}

/** A real-world area: "12.40 m²" (or "125000 mm²" with always mm). */
export function formatArea(mm2: number, f: MeasureFormat = DEFAULT_FORMAT): string {
  return f.units === "mm" ? `${fixed(Math.round(mm2), 0)} mm²` : `${fixed(mm2 / 1e6, f.decimals)} m²`;
}

/** An angle: "45.0°". */
export const formatAngle = (deg: number): string => `${fixed(deg, 1)}°`;

/** A length on paper: "124.0 mm". */
export const formatPaper = (mm: number): string => `${fixed(mm, 1)} mm`;

/** An area on paper: "1240.0 mm²". */
export const formatPaperArea = (mm2: number): string => `${fixed(mm2, 1)} mm²`;

/** "1:100", "1:98.73": as shell/scale.ts formatRatio writes it (a leaf can't import the shell). */
export const formatScale = (ratio: number): string => `1:${Math.round(ratio * 100) / 100}`;

// ---------------------------------------------------------------- calibration

/**
 * A real distance as typed: "4.2 m", "4200", "4200mm", "420 cm", "4,2m". A bare number is
 * millimetres, as on drawings. Returns millimetres, or null if it isn't a positive distance.
 */
export function parseDistance(s: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d*)?|[.,]\d+)\s*(mm|cm|m|km)?\s*$/i.exec(s);
  if (!m) return null;
  const v = Number(m[1].replace(",", "."));
  const k = { mm: 1, cm: 10, m: 1000, km: 1e6 }[(m[2] ?? "mm").toLowerCase() as "mm" | "cm" | "m" | "km"];
  const mm = v * k;
  return Number.isFinite(mm) && mm > 0 ? mm : null;
}

/** The range a calibrated scale may fall in: 100:1 (a large detail) to 1:100000. */
export const MIN_CALIBRATED = 0.01;
export const MAX_CALIBRATED = 100000;

/**
 * The scale from a calibration: the real distance over the same distance on paper, both in
 * mm. Null when the picked points are too close to measure or the result is out of range.
 */
export function calibrate(realMmValue: number, paperMmValue: number): number | null {
  if (!(paperMmValue > 0.01) || !(realMmValue > 0)) return null;
  const r = realMmValue / paperMmValue;
  return r >= MIN_CALIBRATED && r <= MAX_CALIBRATED ? r : null;
}

// ---------------------------------------------------------------- where the scale comes from

/**
 * What a measurement being drawn takes from the app: the scale and /UserUnit of its page, and
 * the format and text size new measurements start with. App.svelte sets it once; a finished
 * measurement keeps its own copy (so its value is a pure function of the markup), which the
 * app updates when a page's scale changes.
 */
export interface MeasureSource {
  page(page: number): PageMeasure;
  format(): MeasureFormat;
  labelSize(): number;
}

export const DEFAULT_LABEL_SIZE = 8;

let source: MeasureSource = {
  page: () => ({ ratio: null, userUnit: 1 }),
  format: () => DEFAULT_FORMAT,
  labelSize: () => DEFAULT_LABEL_SIZE,
};

export function setMeasureSource(s: MeasureSource): void {
  source = s;
}

export const measureSource = (): MeasureSource => source;
