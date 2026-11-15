// The measuring kinds' shared toolkit (kinds/measure*.ts): the fields every measurement
// carries, the page measure it's valued at, how a dimension is drawn (a thin line with a bar at
// each end and its value above it), labels that never read upside down, and the standard
// /Measure entry it saves with. Pure, and a leaf: never imports a kind. See
// docs/editing-phase4-scope.md.

import type { Pt, Rgb, Style } from "./base";
import { type Op, type Seg, type TextOp, add, mul, path, sub, unit } from "./draw";
import { HELVETICA, textWidth } from "./fonts";
import { type MeasureFormat, type PageMeasure, areaDecimals, formatScale, isImperial, lengthUnit, measureSource, paperMm } from "./measure";
import { DEFAULT_FRACTION, MM_PER_FT, MM_PER_IN } from "./imperial"; // Imperial (stage 5 [A9])

/** What every measurement carries besides its geometry. */
export interface MeasureFields {
  /**
   * The scale it's valued at (N in 1:N), or null for none (paper millimetres). Undefined only
   * while it's being drawn: the page's is used, and `settle` writes it in once it's made. The
   * app rewrites it when the page's scale changes, so a measurement follows its page.
   */
  scale?: number | null;
  /** Its page's /UserUnit (1 for nearly every page); undefined while drawn, as `scale`. */
  userUnit?: number;
  /** How its values are written. */
  fmt: MeasureFormat;
  /** The label's text size, points. */
  labelSize: number;
}

/** The fields a new measurement starts with (its scale is settled once it's made). */
export function newMeasure(): MeasureFields {
  const s = measureSource();
  return { fmt: s.format(), labelSize: s.labelSize() };
}

/** The page measure a measurement is valued at: its own, or while drawn, its page's. */
export function pageMeasureOf(m: MeasureFields & { page: number }): PageMeasure {
  if (m.scale !== undefined) return { ratio: m.scale, userUnit: m.userUnit ?? 1 };
  return measureSource().page(m.page);
}

/** A new measurement with its page's scale written in (the kinds' `finish`). */
export function settleMeasure<M extends MeasureFields & { page: number }>(m: M): M {
  const pm = measureSource().page(m.page);
  return { ...m, scale: pm.ratio, userUnit: pm.userUnit };
}

/** Blue, thin and solid: measurements read apart from red markups (scope, "Assumed" 3). */
export const MEASURE_BLUE: Rgb = [0.05, 0.35, 0.8];
export const MEASURE_STYLE: Style = { stroke: MEASURE_BLUE, width: 0.75, fill: null, opacity: 1, fillOpacity: 1, dash: null };

/** Half a dimension's end bar, points: readable at a line's weight. */
export const barHalf = (width: number) => 3 + 2 * width;

// ---------------------------------------------------------------- drawing

const lineSegs = (pts: Pt[]): Seg[] => pts.map((p, i) => [i ? "L" : "M", p[0], p[1]] as Seg);

/**
 * A dimension line through `pts` with a bar square to the line at each end. The line takes
 * the style's pattern; the bars are always solid.
 */
export function dimensionLine(pts: Pt[], s: Style): Op[] {
  if (pts.length < 2) return [];
  const h = barHalf(s.width);
  const bar = (p: Pt, d: Pt): Seg[] => {
    const n: Pt = [-d[1], d[0]];
    const a = add(p, mul(n, h)), b = add(p, mul(n, -h));
    return [["M", a[0], a[1]], ["L", b[0], b[1]]];
  };
  const n = pts.length;
  const bars = [...bar(pts[0], unit(sub(pts[1], pts[0]))), ...bar(pts[n - 1], unit(sub(pts[n - 1], pts[n - 2])))];
  return [path(lineSegs(pts), s, null), path(bars, { ...s, dash: null }, null)];
}

/** Lines of text in a block, centred on each other, with `dir` reading direction. */
function textBlock(lines: string[], size: number, colour: Rgb, dir: Pt, place: (w: number, h: number) => Pt): TextOp {
  const leading = size * 1.2;
  const widths = lines.map((l) => textWidth(l, size, HELVETICA));
  const w = Math.max(0, ...widths);
  const h = size + (lines.length - 1) * leading;
  // The block's top-left corner in its own frame (u along dir, v down the lines).
  const tl = place(w, h);
  const down: Pt = [-dir[1], dir[0]];
  const origin = add(tl, mul(down, size * 0.78));
  const at = (u: number, v: number): Pt => add(add(tl, mul(dir, u)), mul(down, v));
  const m = 1; // the clip's margin: generous, so it never cuts a glyph; it also bounds the label
  return {
    t: "text",
    lines,
    origin,
    dir,
    size,
    leading,
    colour,
    clip: [at(-m, -m), at(w + m, -m), at(w + m, h + size * 0.25 + m), at(-m, h + size * 0.25 + m)],
    face: HELVETICA,
    offsets: widths.map((x) => (w - x) / 2),
  };
}

/**
 * A label along the segment a to b, centred on its middle, above the line (on the side "up"
 * is, for its upright reading direction), `gap` points clear of it.
 */
export function labelAlong(text: string, a: Pt, b: Pt, size: number, colour: Rgb, gap: number, dir: Pt): TextOp {
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const up: Pt = [dir[1], -dir[0]];
  return textBlock([text], size, colour, dir, (w, h) => add(add(mid, mul(dir, -w / 2)), mul(up, gap + h + size * 0.25)));
}

/** A label centred on a point, reading across the page. */
export function labelAt(lines: string[], c: Pt, size: number, colour: Rgb): TextOp {
  return textBlock(lines, size, colour, [1, 0], (w, h) => [c[0] - w / 2, c[1] - (h + size * 0.25) / 2]);
}

/** A label's width and height (for keeping it clear of what it labels). */
export function labelSize(lines: string[], size: number): [number, number] {
  return [Math.max(0, ...lines.map((l) => textWidth(l, size, HELVETICA))), size * 1.25 + (lines.length - 1) * size * 1.2];
}

// ---------------------------------------------------------------- saving

/** The /Measure entry for a saved measurement (AnnotSpec's `measure`). */
export interface MeasureSpec {
  /** /R: the scale as text ("1:100"). */
  ratio: string;
  /** The unit values are written in ("m", "mm"). */
  unit: string;
  /** Units per user-space unit: page /UserUnit, paper millimetres and the scale together. */
  factor: number;
  /** /D in the number formats: 100 for two decimals, 1 for whole numbers; with `fraction`, the denominator. */
  precision: number;
  // Imperial (stage 5 [A9]): absent for metric, which is written as before.
  /** Distances are written as fractions (/F /F), `precision` the denominator. */
  fraction?: boolean;
  /** Distances read as whole feet, then inches (`unit` is "ft"). */
  feetInches?: boolean;
  /** Areas' unit ("sq ft"), its size in squares of `unit` (1/144 for "in"), and /D for it. Absent: the square of `unit` at `precision`. */
  areaUnit?: string;
  areaFactor?: number;
  areaPrecision?: number;
}

/**
 * The /Measure entry for a measurement valued at `pm`, written in the unit its label uses for
 * a typical value `typicalMm` (real millimetres; paper millimetres when there's no scale).
 */
export function measureSpec(pm: PageMeasure, fmt: MeasureFormat, typicalMm: number): MeasureSpec {
  const ratio = pm.ratio ?? 1;
  const u = pm.ratio === null ? "mm" : lengthUnit(typicalMm, fmt);
  const mmPerUnit = paperMm(1, pm.userUnit) * ratio;
  const r = pm.ratio === null ? "1:1 (paper)" : formatScale(pm.ratio, isImperial(fmt) ? "imperial" : "metric");
  if (u === "mm" || u === "m") {
    return {
      ratio: r,
      unit: u,
      factor: u === "m" ? mmPerUnit / 1000 : mmPerUnit,
      precision: u === "m" ? 10 ** fmt.decimals : pm.ratio === null ? 10 : 1,
    };
  }
  // Imperial: distances in feet or inches, areas always in square feet.
  const inFeet = u === "ft-in" || u === "ft";
  const fraction = u === "ft-in" || u === "in-frac";
  return {
    ratio: r,
    unit: inFeet ? "ft" : "in",
    factor: mmPerUnit / (inFeet ? MM_PER_FT : MM_PER_IN),
    precision: fraction ? (fmt.fraction ?? DEFAULT_FRACTION) : 10 ** fmt.decimals,
    fraction,
    feetInches: u === "ft-in",
    areaUnit: "sq ft",
    areaFactor: inFeet ? 1 : 1 / 144,
    areaPrecision: 10 ** areaDecimals(fmt),
  };
}
