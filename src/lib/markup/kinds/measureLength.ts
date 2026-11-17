// Length: placed the CAD way (stage 5 of docs/editing-tool-consistency-brief.md, reworked after
// Matt's review): click each end, then pull the dimension line out and click. Which way it's
// pulled picks what's measured: above or below the points, the horizontal distance; beside
// them, the vertical; Shift, straight between them (aligned). Extension lines run from each
// point to the line; a third click on the points (or a double-click on the second, or a drag)
// leaves it in line. The real-world length sits above the line (to its right on a vertical one)
// and reads from the bottom or the right of the page; its grip slides it along the line, the
// line reaching out to it past either end, and a double-click on the grip puts it back. Where it
// doesn't fit between the points it goes beyond the second by itself, and wherever it's beyond
// an end, arrows turn outside (docs/edit-lock-brief.md, 7). Saved as a Line
// annotation with the LineDimension intent, a /Measure dictionary and the standard keys for the
// pulled-out line (/LL, /LLE, /LLO) and the moved value (/CO), so other apps treat it as a
// dimension and draw it alike.

import { type MarkupBase, type Pt, normRect } from "../base";
import { type Seg, add, len, mul, path, sub, unit } from "../draw";
import { r3 } from "../annotation";
import { toUser } from "../pdf";
import { distToSegment, movePt, snapAngle } from "../shape";
import { formatLength, formatPaper, paperMm, realMm, uprightDir } from "../measure";
import {
  type MeasureFields,
  EXT_BEYOND,
  EXT_GAP,
  MEASURE_STYLE,
  dimensionEndsSpec,
  dimensionLine,
  endReach,
  faceOf,
  labelAt,
  labelSize,
  measureSpec,
  newMeasure,
  onLabel,
  pageMeasureOf,
  settleMeasure,
  VALUE_CLEAR,
  valueFits,
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
  /**
   * What it measures: the horizontal ("level") or vertical ("upright") distance on the page, or
   * (absent) straight between the points. The line's frame follows: level lines run along x.
   */
  orient?: "level" | "upright";
}

declare module "../base" {
  interface MarkupKinds {
    measureLength: MeasureLengthMarkup;
  }
}

/** Its values: real-world (null with no scale) and on paper. */
export function lengthValues(m: MeasureLengthMarkup): { real: string | null; paper: string; realMm: number | null } {
  const pm = pageMeasureOf(m);
  const d = Math.abs(dot(sub(m.to, m.from), lengthFrame(m).along));
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
export function lengthFrame(m: Pick<MeasureLengthMarkup, "from" | "to" | "orient">): { along: Pt; normal: Pt } {
  const d = sub(m.to, m.from);
  const along: Pt = m.orient === "level" ? [d[0] < 0 ? -1 : 1, 0] : m.orient === "upright" ? [0, d[1] < 0 ? -1 : 1] : unit(d);
  return { along, normal: [along[1], -along[0]] };
}

function dot(a: Pt, b: Pt): number {
  return a[0] * b[0] + a[1] * b[1];
}

/**
 * Which way a dimension pulled out to q measures (CAD's rule): pulled above or below the
 * points' box, level; beside it, upright; whichever it's further outside, if both. Inside the
 * box, or with `aligned` (Shift), straight between the points.
 */
export function orientFor(from: Pt, to: Pt, q: Pt, aligned: boolean): MeasureLengthMarkup["orient"] {
  if (aligned) return undefined;
  const outside = (k: 0 | 1) => Math.max(Math.min(from[k], to[k]) - q[k], q[k] - Math.max(from[k], to[k]), 0);
  const ex = outside(0), ey = outside(1);
  if (ex === 0 && ey === 0) return undefined;
  return ey >= ex ? "level" : "upright";
}

/**
 * Where it's drawn: the dimension line (`a` to `b`, pulled `offset` off the points) and the
 * extension lines from the points to it, each leaving EXT_GAP at its point and running EXT_BEYOND
 * past the line (none while the line is too near the points for them to show).
 */
export function lengthGeometry(m: MeasureLengthMarkup): { a: Pt; b: Pt; extensions: [Pt, Pt][] } {
  const { along, normal } = lengthFrame(m);
  const off = m.offset ?? 0;
  const d = sub(m.to, m.from);
  // The line sits `off` from the first point; the second point's foot is level with it.
  const a = add(m.from, mul(normal, off));
  const b = add(a, mul(along, dot(d, along)));
  // Each point's own reach to the line (they differ when it measures level or upright).
  const extensions: [Pt, Pt][] = [];
  for (const [p, foot, reach] of [[m.from, a, off], [m.to, b, off - dot(d, normal)]] as [Pt, Pt, number][]) {
    if (Math.abs(reach) <= EXT_GAP) continue;
    const s = Math.sign(reach);
    extensions.push([add(p, mul(normal, s * EXT_GAP)), add(foot, mul(normal, s * EXT_BEYOND))]);
  }
  return { a, b, extensions };
}

/** Space left between the value and the dimension line where the line reaches out to it. */
const REACH_PAST = 2;

/**
 * The dimension line as drawn: a to b, and where the value has been slid past either end, a
 * plain run on from that end to just past it (the CAD way of putting a value outside). With
 * arrow ends and the value beyond an end, moved there by itself or by hand (Matt's review: the
 * same either way), the arrows turn outside (`outside`), and an end with no run of its own gets
 * one to carry its arrow.
 */
export function lengthRuns(m: MeasureLengthMarkup): { a: Pt; b: Pt; beyond: [Pt, Pt][]; outside: boolean } {
  const { a, b } = lengthGeometry(m);
  const L = len(sub(b, a));
  if (L < 1e-9) return { a, b, beyond: [], outside: false };
  const u = mul(sub(b, a), 1 / L);
  const { centre, size, out } = lengthValueAt(m);
  const s = dot(sub(centre, a), u), half = size[0] / 2;
  const beyond: [Pt, Pt][] = [];
  if (s + half > L) beyond.push([b, add(a, mul(u, s + half + REACH_PAST))]);
  if (s - half < 0) beyond.push([a, add(a, mul(u, s - half - REACH_PAST))]);
  const outside = m.ends === "arrow" && (out || beyond.length > 0);
  if (outside) {
    // An arrow outside with no run carrying it: a tail as long again as the head behind it.
    const tail = 2 * endReach("arrow", m.style.width);
    if (s - half >= 0) beyond.push([a, sub(a, mul(u, tail))]);
    if (s + half <= L) beyond.push([b, add(b, mul(u, tail))]);
  }
  return { a, b, beyond, outside };
}

/**
 * Where the value goes by itself (docs/edit-lock-brief.md, 7), as a move along the line from its
 * place, or null where it fits between the ends. Out of room, it sits beyond the second point
 * clicked (as AutoCAD puts it by the second extension line), clear of that end (an arrow being
 * turned outside, its head). Measurements from before stage 5 (no offset) are left as they were.
 */
function autoSlide(m: MeasureLengthMarkup, length: number, width: number): number | null {
  if (m.value !== undefined || m.offset === undefined) return null;
  if (valueFits(length, width, m.ends, m.style.width)) return null;
  return length / 2 + endReach(m.ends, m.style.width) + VALUE_CLEAR + width / 2;
}

/**
 * Where its value is: its centre, reading direction and size, and whether it was moved out by
 * itself for want of room (`out`).
 */
export function lengthValueAt(m: MeasureLengthMarkup): { centre: Pt; home: Pt; dir: Pt; size: [number, number]; out: boolean } {
  const { a, b } = lengthGeometry(m);
  // It reads along the dimension line (level or upright when it measures so), not the points.
  const dir = uprightDir(a, b);
  const size = labelSize([lengthLabel(m)], m.labelSize, faceOf(m.font));
  const home = valueHome(a, b, dir, size[1], valueGap(m.style.width));
  const { along, normal } = lengthFrame(m);
  const slide = autoSlide(m, len(sub(b, a)), size[0]);
  const v = m.value ?? [slide ?? 0, 0];
  return { centre: add(home, add(mul(along, v[0]), mul(normal, v[1]))), home, dir, size, out: slide !== null };
}

/**
 * The geometry from the clicked points: two make an in-line dimension; a third picks what's
 * measured by the way it's pulled (orientFor; Shift, `ctx.free`, for straight between them) and
 * sets the offset by how far it is from the first point (none when it's on the line through
 * both, within `pick`: in line).
 */
export function lengthFromPoints(pts: Pt[], ctx?: DrawContext): Pick<MeasureLengthMarkup, "from" | "to" | "offset" | "orient"> {
  const from = pts[0], to = pts[Math.min(1, pts.length - 1)];
  if (pts.length < 3) return { from, to, offset: 0 };
  const q = pts[2];
  if (distToSegment(q, from, to) <= (ctx?.pick ?? 0)) return { from, to, offset: 0 };
  const orient = orientFor(from, to, q, !!ctx?.free);
  const off = dot(sub(q, from), lengthFrame({ from, to, orient }).normal);
  return { from, to, offset: off, ...(orient ? { orient } : {}) };
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
    // The second end anywhere (Shift: 15 degree steps); the third picks what's measured itself.
    lock: ["snap", "none"],
    say: "click each end, then pull the dimension line out and click: above or below measures across, beside measures up and down, Shift measures straight between the points (click on the points to keep it in line), or drag",
    preview: true,
  },
  ops(m) {
    const { extensions } = lengthGeometry(m);
    const { a, b, beyond, outside } = lengthRuns(m);
    const { centre, dir } = lengthValueAt(m);
    return [
      ...dimensionLine([a, b], m.style, m.ends ?? "bar", outside, extensions),
      ...(beyond.length ? [path(beyond.flatMap(([x, y]) => [["M", x[0], x[1]], ["L", y[0], y[1]]] as Seg[]), m.style, null)] : []),
      labelAt([lengthLabel(m)], centre, m.labelSize, m.style.stroke, faceOf(m.font), dir),
    ];
  },
  spec(m, f, spec) {
    const v = lengthValues(m);
    spec.subtype = "Line";
    // Measured level or upright, the line written is the first point and the second's foot
    // level with it, so /LL lifts it to where it's drawn (other apps take one leader for both).
    const { along } = lengthFrame(m);
    const to = m.orient ? add(m.from, mul(along, dot(sub(m.to, m.from), along))) : m.to;
    spec.line = [...toUser(f, m.from[0], m.from[1]), ...toUser(f, to[0], to[1])].map(r3) as [number, number, number, number];
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
    const { a, b, beyond } = lengthRuns(m);
    const ends = beyond.map(([, y]) => y);
    const xs = [m.from[0], m.to[0], a[0], b[0], ...ends.map((p) => p[0])], ys = [m.from[1], m.to[1], a[1], b[1], ...ends.map((p) => p[1])];
    return normRect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  },
  hits(m, p, t) {
    const { extensions } = lengthGeometry(m);
    const { a, b, beyond } = lengthRuns(m);
    if (distToSegment(p, a, b) <= t || beyond.some(([x, y]) => distToSegment(p, x, y) <= t)) return true;
    // Less reach on the extension lines (they run up to the drawing's own lines at the points)
    // and on the value (on its lettering only), so it isn't picked up in passing.
    if (extensions.some(([x, y]) => distToSegment(p, x, y) <= t / 2)) return true;
    const { centre, dir, size } = lengthValueAt(m);
    return onLabel(p, centre, size, dir, 0);
  },
  // Its value slides, and its line pulls out, from anywhere on them, not just their grips.
  partAt(m, p, t) {
    const { centre, dir, size } = lengthValueAt(m);
    if (onLabel(p, centre, size, dir, 0)) return "value";
    const { a, b, beyond } = lengthRuns(m);
    if (distToSegment(p, a, b) <= t || beyond.some(([x, y]) => distToSegment(p, x, y) <= t)) return "offset";
    return null;
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
    // An end moves freely (Shift: 15 degree steps from the other). Measured level or upright,
    // the dimension line stays where it is.
    if (h === "from" || h === "to") {
      const q = constrain ? snapAngle(h === "from" ? m.to : m.from, p) : p;
      const next = { ...m, [h]: q };
      if (!m.orient || h === "to") return next;
      const { normal } = lengthFrame(m);
      return { ...next, offset: (m.offset ?? 0) + dot(sub(m.from, q), normal) };
    }
    // The line's grip pulls it out as placing does: which way picks what's measured, Shift straight.
    if (h === "offset") {
      const orient = orientFor(m.from, m.to, p, constrain);
      const { orient: _, ...rest } = m;
      return { ...rest, ...(orient ? { orient } : {}), offset: dot(sub(p, m.from), lengthFrame({ ...m, orient }).normal) };
    }
    if (h === "value") {
      // Along the line it slides, to no more than its own width and a half past either end;
      // off the line it takes the dimension line with it (the line moves, the value stays on it).
      const { home, size } = lengthValueAt({ ...m, value: undefined });
      const { a, b } = lengthGeometry(m);
      const { along, normal } = lengthFrame(m);
      const reach = len(sub(b, a)) / 2 + size[0] * 1.5;
      const d = sub(p, home);
      const s = Math.max(-reach, Math.min(reach, dot(d, along)));
      return { ...m, offset: (m.offset ?? 0) + dot(d, normal), value: [s, 0] };
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
