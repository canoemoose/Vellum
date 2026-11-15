// Length: placed the CAD way (stage 5 of docs/editing-tool-consistency-brief.md): click each
// end, then a third click sets how far the dimension line sits from them, with extension lines
// back to the points; a third click on the points (or a double-click on the second, or a drag)
// leaves it in line. The ends start ortho-locked and Shift frees them. The real-world length
// sits above the line (to its right on a vertical one) and reads from the bottom or the right of
// the page; its grip moves it, and a double-click on the grip puts it back. Saved as a Line
// annotation with the LineDimension intent, a /Measure dictionary and the standard keys for the
// pulled-out line (/LL, /LLE, /LLO) and the moved value (/CO), so other apps treat it as a
// dimension and draw it alike.

import { type MarkupBase, type Pt, normRect } from "../base";
import { add, mul, sub, unit } from "../draw";
import { r3 } from "../annotation";
import { toUser } from "../pdf";
import { distToSegment, movePt, orthoFrom } from "../shape";
import { formatLength, formatPaper, paperMm, realMm, uprightDir } from "../measure";
import {
  type MeasureFields,
  EXT_BEYOND,
  EXT_GAP,
  MEASURE_STYLE,
  dimensionEndsSpec,
  dimensionLine,
  extensionLines,
  faceOf,
  labelAt,
  labelSize,
  measureSpec,
  newMeasure,
  onLabel,
  pageMeasureOf,
  settleMeasure,
  valueGap,
  valueHome,
} from "../dimension";
import { type DrawContext, defineKind } from "./kind";

export interface MeasureLengthMarkup extends MarkupBase, MeasureFields {
  kind: "measureLength";
  /** The measured points. */
  from: Pt;
  to: Pt;
  /**
   * Stage 5: how far the dimension line sits from the points, page points, along the line's
   * left normal (`normal` below; the PDF's /LL). Undefined in one made before: in line, with
   * its value where it was then.
   */
  offset?: number;
  /** Stage 5: how far the value has been moved from its place, [along from-to, along the normal], points. */
  value?: [number, number];
}

declare module "../base" {
  interface MarkupKinds {
    measureLength: MeasureLengthMarkup;
  }
}

/** Its values: real-world (null with no scale) and on paper. */
export function lengthValues(m: MeasureLengthMarkup): { real: string | null; paper: string; realMm: number | null } {
  const pm = pageMeasureOf(m);
  const d = Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]);
  const r = realMm(d, pm);
  return { real: r === null ? null : formatLength(r, m.fmt), paper: formatPaper(paperMm(d, pm.userUnit)), realMm: r };
}

/** What its label reads: the real length, or with no scale, the paper length marked as such. */
export const lengthLabel = (m: MeasureLengthMarkup): string => {
  const v = lengthValues(m);
  return v.real ?? `${v.paper} (paper)`;
};

// ---------------------------------------------------------------- geometry (stage 5)

/**
 * The line's own frame: `along` from `from` to `to`, `normal` a quarter turn anticlockwise as
 * seen (on the page, y down, that's [along.y, -along.x]). In user space it's the anticlockwise
 * normal too, whatever the page's /Rotate, so it's the frame /LL and /CO are written in.
 */
export function lengthFrame(m: Pick<MeasureLengthMarkup, "from" | "to">): { along: Pt; normal: Pt } {
  const along = unit(sub(m.to, m.from));
  return { along, normal: [along[1], -along[0]] };
}

const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];

/**
 * Where it's drawn: the dimension line (`a` to `b`, pulled `offset` off the points) and the
 * extension lines from the points to it, each leaving EXT_GAP at its point and running EXT_BEYOND
 * past the line (none while the line is too near the points for them to show).
 */
export function lengthGeometry(m: MeasureLengthMarkup): { a: Pt; b: Pt; extensions: [Pt, Pt][] } {
  const { normal } = lengthFrame(m);
  const off = m.offset ?? 0;
  const a = add(m.from, mul(normal, off)), b = add(m.to, mul(normal, off));
  const s = Math.sign(off);
  const extensions: [Pt, Pt][] = Math.abs(off) > EXT_GAP ? [m.from, m.to].map((p) => [add(p, mul(normal, s * EXT_GAP)), add(p, mul(normal, off + s * EXT_BEYOND))]) : [];
  return { a, b, extensions };
}

/** Where its value is: its centre, reading direction and size. */
export function lengthValueAt(m: MeasureLengthMarkup): { centre: Pt; home: Pt; dir: Pt; size: [number, number] } {
  const { a, b } = lengthGeometry(m);
  const dir = uprightDir(m.from, m.to);
  const size = labelSize([lengthLabel(m)], m.labelSize, faceOf(m.font));
  // One made before stage 5 keeps its value where it was: above, or left of a vertical line.
  const home = valueHome(a, b, dir, size[1], valueGap(m.style.width), m.offset !== undefined);
  const { along, normal } = lengthFrame(m);
  const v = m.value ?? [0, 0];
  return { centre: add(home, add(mul(along, v[0]), mul(normal, v[1]))), home, dir, size };
}

/**
 * The geometry from the clicked points: two make an in-line dimension; a third sets the offset
 * by how far it is from the line through the first two (none when it's on them, within `pick`).
 */
export function lengthFromPoints(pts: Pt[], ctx?: DrawContext): Pick<MeasureLengthMarkup, "from" | "to" | "offset"> {
  const from = pts[0], to = pts[Math.min(1, pts.length - 1)];
  if (pts.length < 3) return { from, to, offset: 0 };
  const off = dot(sub(pts[2], from), lengthFrame({ from, to }).normal);
  return { from, to, offset: Math.abs(off) <= (ctx?.pick ?? 0) ? 0 : off };
}

/** Where other apps put a caption above the line (poppler: its bottom twice the line weight clear), as a centre offset. */
const captionNormal = (m: MeasureLengthMarkup, height: number) => 2 * m.style.width + height / 2;

/** /CO: the value's centre from where other apps put a top caption, [along, normal], points. */
export function captionOffset(m: MeasureLengthMarkup): [number, number] {
  const { a, b } = lengthGeometry(m);
  const { along, normal } = lengthFrame(m);
  const { centre, size } = lengthValueAt(m);
  const d = sub(centre, mul(add(a, b), 0.5));
  return [dot(d, along), dot(d, normal) - captionNormal(m, size[1])];
}

/** The value's move from its place, from a file's /CO (the inverse of captionOffset). */
export function valueFromCaption(m: MeasureLengthMarkup, co: [number, number]): [number, number] {
  const { a, b } = lengthGeometry(m);
  const { along, normal } = lengthFrame(m);
  const { home, size } = lengthValueAt({ ...m, value: undefined });
  const c = add(mul(add(a, b), 0.5), add(mul(along, co[0]), mul(normal, co[1] + captionNormal(m, size[1]))));
  const d = sub(c, home);
  return [dot(d, along), dot(d, normal)];
}

export const measureLength = defineKind<MeasureLengthMarkup>({
  kind: "measureLength",
  label: "Length",
  defaultStyle: () => ({ ...MEASURE_STYLE }),
  controls: { fill: false, ends: false, text: false },
  draw: {
    gesture: "points",
    make: (pts, ctx) => ({ ...lengthFromPoints(pts, ctx), ...newMeasure() }),
    closed: false,
    min: 2,
    max: 3,
    drag: "line",
    // The second end level or upright with the first; the offset only counts its distance.
    lock: ["ortho", "none"],
    say: "click each end, then where the dimension line goes (on the points to keep it in line), or drag",
    preview: true,
  },
  ops(m) {
    const { a, b, extensions } = lengthGeometry(m);
    const { centre, dir } = lengthValueAt(m);
    return [
      ...extensionLines(extensions, m.style),
      ...dimensionLine([a, b], m.style, m.ends ?? "bar"),
      labelAt([lengthLabel(m)], centre, m.labelSize, m.style.stroke, faceOf(m.font), dir),
    ];
  },
  spec(m, f, spec) {
    const v = lengthValues(m);
    spec.subtype = "Line";
    spec.line = [...toUser(f, m.from[0], m.from[1]), ...toUser(f, m.to[0], m.to[1])].map(r3) as [number, number, number, number];
    dimensionEndsSpec(spec, m.ends, m.style);
    spec.intent = "LineDimension";
    spec.contents = lengthLabel(m);
    spec.caption = true;
    spec.measure = measureSpec(pageMeasureOf(m), m.fmt, v.realMm ?? 0);
    // Stage 5: the pulled-out line and the moved value, in the standard keys.
    const off = m.offset ?? 0;
    if (Math.abs(off) > 1e-3) spec.leader = [r3(off), Math.abs(off) > EXT_GAP ? EXT_BEYOND : 0, Math.abs(off) > EXT_GAP ? EXT_GAP : 0];
    if (m.offset !== undefined) {
      const co = captionOffset(m).map(r3) as [number, number];
      if (Math.abs(co[0]) > 0.01 || Math.abs(co[1]) > 0.01) spec.captionOffset = co;
    }
  },
  bounds(m) {
    const { a, b } = lengthGeometry(m);
    const xs = [m.from[0], m.to[0], a[0], b[0]], ys = [m.from[1], m.to[1], a[1], b[1]];
    return normRect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  },
  hits(m, p, t) {
    const { a, b, extensions } = lengthGeometry(m);
    if (distToSegment(p, m.from, m.to) <= t || distToSegment(p, a, b) <= t) return true;
    if (extensions.some(([x, y]) => distToSegment(p, x, y) <= t)) return true;
    const { centre, dir, size } = lengthValueAt(m);
    return onLabel(p, centre, size, dir, t);
  },
  handles(m) {
    const { a, b } = lengthGeometry(m);
    return [
      { id: "from", at: m.from },
      { id: "to", at: m.to },
      // The dimension line's middle pulls it off the points.
      { id: "offset", at: mul(add(a, b), 0.5) },
      { id: "value", at: lengthValueAt(m).centre },
    ];
  },
  dragHandle(m, h, p, constrain) {
    // Rule 2: a dimension's end stays level or upright with the other; Shift frees it.
    if (h === "from") return { ...m, from: constrain ? p : orthoFrom(m.to, p) };
    if (h === "to") return { ...m, to: constrain ? p : orthoFrom(m.from, p) };
    if (h === "offset") return { ...m, offset: dot(sub(p, m.from), lengthFrame(m).normal) };
    if (h === "value") {
      const { home } = lengthValueAt(m);
      const { along, normal } = lengthFrame(m);
      const d = sub(p, home);
      return { ...m, value: [dot(d, along), dot(d, normal)] };
    }
    return m;
  },
  resetHandle(m, h) {
    if (h !== "value" || !m.value) return null;
    const { value: _, ...rest } = m;
    return rest;
  },
  moveBy: (m, dx, dy) => ({ ...m, from: movePt(m.from, dx, dy), to: movePt(m.to, dx, dy) }),
  finish: settleMeasure,
});
