// The measuring kinds' shared toolkit (kinds/measure*.ts): the fields every measurement
// carries, the page measure it's valued at, how a dimension is drawn (a thin line with an end at
// each end, extension lines when it's pulled out, its value above it), labels that never read
// upside down, and the standard /Measure entry it saves with. Pure, and a leaf: never imports a
// kind. See docs/editing-phase4-scope.md and stage 5 of docs/editing-tool-consistency-brief.md.

import type { Pt, Rgb, Style } from "./base";
import { type Op, type Seg, type TextOp, add, endedLine, mul, path, rot, sub, unit } from "./draw";
import { type Face, HELVETICA, textWidth } from "./fonts";
import { type MeasureFormat, type PageMeasure, areaDecimals, formatScale, isImperial, lengthUnit, measureSource, paperMm } from "./measure";
import { DEFAULT_FRACTION, MM_PER_FT, MM_PER_IN } from "./imperial"; // Imperial (stage 5 [A9])

/** A dimension's ends (stage 5, D15): bars square to the line, 45 degree ticks, or filled arrows. */
export type DimEnds = "bar" | "tick" | "arrow";
/** The value's font (stage 5, D6): standard fonts every reader has, so nothing is embedded. */
export type DimFont = "helvetica" | "courier" | "courierBold";

/** How new dimensions look: one setting for every measuring tool (settings.measure.look). */
export interface DimensionLook {
  ends: DimEnds;
  font: DimFont;
}

export const DEFAULT_LOOK: DimensionLook = { ends: "bar", font: "helvetica" };
export const DIM_ENDS: DimEnds[] = ["bar", "tick", "arrow"];
export const DIM_FONTS: DimFont[] = ["helvetica", "courier", "courierBold"];

/** A look with every field in range. */
export function sanitiseLook(raw: unknown): DimensionLook {
  const l = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    ends: DIM_ENDS.includes(l.ends as DimEnds) ? (l.ends as DimEnds) : DEFAULT_LOOK.ends,
    font: DIM_FONTS.includes(l.font as DimFont) ? (l.font as DimFont) : DEFAULT_LOOK.font,
  };
}

let look: () => DimensionLook = () => DEFAULT_LOOK;

/** Where new dimensions take their look from (App.svelte: the remembered setting). */
export function setDimensionLook(get: () => DimensionLook): void {
  look = get;
}

/** /LE for each kind of end (the saved look is ours; other apps draw the nearest they have). */
export const LE_OF: Record<DimEnds, string> = { bar: "Butt", tick: "Slash", arrow: "ClosedArrow" };

/** /LE and /IC for a dimension's ends: an arrow's head is filled in the line's colour. */
export function dimensionEndsSpec(spec: { lineEnds?: string[]; interior?: [number, number, number] }, ends: DimEnds | undefined, s: Style): void {
  const le = LE_OF[ends ?? "bar"];
  spec.lineEnds = [le, le];
  if (ends === "arrow") spec.interior = s.stroke;
  else delete spec.interior;
}

/** The face a value is written in. */
export function faceOf(font: DimFont | undefined): Face {
  if (font === "courier") return { family: "courier", bold: false, italic: false };
  if (font === "courierBold") return { family: "courier", bold: true, italic: false };
  return HELVETICA;
}

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
  // Stage 5: both undefined in measurements made before it (bars, Helvetica).
  /** Its ends, where it has a dimension line (length, polyline length). */
  ends?: DimEnds;
  /** The value's font. */
  font?: DimFont;
}

/** The fields a new measurement starts with (its scale is settled once it's made). */
export function newMeasure(): MeasureFields {
  const s = measureSource();
  const l = look();
  return { fmt: s.format(), labelSize: s.labelSize(), ends: l.ends, font: l.font };
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

/** The gap between a dimension line and its value, points. */
export const valueGap = (width: number) => barHalf(width) * 0.5 + 1;

/**
 * Extension lines (stage 5): the gap they leave at the measured point (/LLO) and how far they
 * run past the dimension line (/LLE), points.
 */
export const EXT_GAP = 2;
export const EXT_BEYOND = 3;

// ---------------------------------------------------------------- drawing

const lineSegs = (pts: Pt[]): Seg[] => pts.map((p, i) => [i ? "L" : "M", p[0], p[1]] as Seg);

/**
 * A dimension line through `pts` with an end at each: a bar square to the line (the default), a
 * tick at 45 degrees (both leaning the same way, drawn twice the line's weight), or a filled
 * arrow pointing out. The line takes the style's pattern; the ends are always solid.
 */
export function dimensionLine(pts: Pt[], s: Style, ends: DimEnds = "bar"): Op[] {
  if (pts.length < 2) return [];
  if (ends === "arrow") return endedLine(pts, ["filled", "filled"], s);
  const h = barHalf(s.width);
  // Square to the line, or for a tick, a further eighth of a turn: the same line at both ends.
  const turn = ends === "tick" ? Math.PI / 4 : 0;
  const bar = (p: Pt, d: Pt): Seg[] => {
    const n = rot([-d[1], d[0]], turn);
    const a = add(p, mul(n, h)), b = add(p, mul(n, -h));
    return [["M", a[0], a[1]], ["L", b[0], b[1]]];
  };
  const n = pts.length;
  const bars = [...bar(pts[0], unit(sub(pts[1], pts[0]))), ...bar(pts[n - 1], unit(sub(pts[n - 1], pts[n - 2])))];
  const endStyle = { ...s, dash: null, width: ends === "tick" ? s.width * 2 : s.width };
  return [path(lineSegs(pts), s, null), path(bars, endStyle, null)];
}

/** Extension lines, solid, each from its measured point out to past the dimension line. */
export function extensionLines(lines: [Pt, Pt][], s: Style): Op[] {
  if (!lines.length) return [];
  return [path(lines.flatMap(([a, b]) => [["M", a[0], a[1]], ["L", b[0], b[1]]] as Seg[]), { ...s, dash: null }, null)];
}

/** Lines of text in a block, centred on each other, with `dir` reading direction. */
function textBlock(lines: string[], size: number, colour: Rgb, dir: Pt, face: Face, place: (w: number, h: number) => Pt): TextOp {
  const leading = size * 1.2;
  const widths = lines.map((l) => textWidth(l, size, face));
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
    face,
    offsets: widths.map((x) => (w - x) / 2),
  };
}

/**
 * A label along the segment a to b, centred on its middle, above the line (on the side "up"
 * is, for its upright reading direction), `gap` points clear of it.
 */
export function labelAlong(text: string, a: Pt, b: Pt, size: number, colour: Rgb, gap: number, dir: Pt, face: Face = HELVETICA): TextOp {
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const up: Pt = [dir[1], -dir[0]];
  return textBlock([text], size, colour, dir, face, (w, h) => add(add(mid, mul(dir, -w / 2)), mul(up, gap + h + size * 0.25)));
}

/** A label centred on a point, reading along `dir` (across the page by default). */
export function labelAt(lines: string[], c: Pt, size: number, colour: Rgb, face: Face = HELVETICA, dir: Pt = [1, 0]): TextOp {
  const up: Pt = [dir[1], -dir[0]];
  return textBlock(lines, size, colour, dir, face, (w, h) => add(add(c, mul(dir, -w / 2)), mul(up, (h + size * 0.25) / 2)));
}

/** A label's width and height (for keeping it clear of what it labels). */
export function labelSize(lines: string[], size: number, face: Face = HELVETICA): [number, number] {
  return [Math.max(0, ...lines.map((l) => textWidth(l, size, face))), size * 1.25 + (lines.length - 1) * size * 1.2];
}

/** Whether p is on a label of size [w, h] centred on c reading along dir, with `t` to spare. */
export function onLabel(p: Pt, c: Pt, wh: [number, number], dir: Pt, t: number): boolean {
  const d = sub(p, c);
  return Math.abs(d[0] * dir[0] + d[1] * dir[1]) <= wh[0] / 2 + t && Math.abs(d[0] * dir[1] - d[1] * dir[0]) <= wh[1] / 2 + t;
}

/**
 * Where a value along the segment a to b goes by default: centred on its middle, `gap` clear of
 * the line, on the side "up" is for its reading direction `dir` (the side facing the top of the
 * page); with `right`, on a vertical line, to its right instead (stage 5, D6).
 */
export function valueHome(a: Pt, b: Pt, dir: Pt, height: number, gap: number, right: boolean): Pt {
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const side: Pt = right && Math.abs(dir[0]) <= 1e-9 ? [1, 0] : [dir[1], -dir[0]];
  return add(mid, mul(side, gap + height / 2));
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
