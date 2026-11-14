// A markup's drawing as operations in page coordinates (points, y down): paths and lines of
// text. The overlay paints these on the canvas (engine/markupPainter.ts) and pdf.ts turns the
// same operations into the annotation's appearance stream, so the screen and the file agree.
// Geometry ported from the phase 0 spike (spikes/annot-writer/src/appearance.rs). Pure.

import { type Markup, type Pt, type Rect, type Rgb, type Style, normRect } from "./types";
import { textWidth, wrap } from "./helvetica";

export type Seg = ["M", number, number] | ["L", number, number] | ["C", number, number, number, number, number, number] | ["Z"];

export interface PathOp {
  t: "path";
  segs: Seg[];
  stroke: Rgb | null;
  fill: Rgb | null;
  width: number;
  dash: number[] | null;
  opacity: number;
}

export interface TextOp {
  t: "text";
  lines: string[];
  /** Baseline start of the first line. Lines run along `dir` and stack down the page from it. */
  origin: Pt;
  /** Unit reading direction (1, 0) for ordinary text. */
  dir: Pt;
  size: number;
  leading: number;
  colour: Rgb;
  /** Text is clipped to this quadrilateral (a text box's inside), if set. */
  clip: Pt[] | null;
}

export type Op = PathOp | TextOp;

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => {
  const l = len(a);
  return l === 0 ? [1, 0] : [a[0] / l, a[1] / l];
};
const rot = (a: Pt, ang: number): Pt => {
  const s = Math.sin(ang), c = Math.cos(ang);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
};

function path(segs: Seg[], s: Style, fill: Rgb | null = s.fill, stroke: Rgb | null = s.stroke): PathOp {
  return { t: "path", segs, stroke, fill, width: s.width, dash: s.dash, opacity: s.opacity };
}

/** Arrowhead length for a line weight: readable on a drawing, growing with weight. */
export function arrowLength(width: number): number {
  return 6 + 4 * width;
}

/** An open arrowhead (two wings) at `tip`, pointing along `dir`. */
function arrowhead(tip: Pt, dir: Pt, width: number): Seg[] {
  const back = mul(unit(dir), -arrowLength(width));
  const w1 = add(tip, rot(back, 0.4636)); // about 26.6 degrees: a 2:1 head
  const w2 = add(tip, rot(back, -0.4636));
  return [["M", w1[0], w1[1]], ["L", tip[0], tip[1]], ["L", w2[0], w2[1]]];
}

function rectOps(r: Rect, s: Style): Op[] {
  const [x0, y0, x1, y1] = normRect(r);
  return [path([["M", x0, y0], ["L", x1, y0], ["L", x1, y1], ["L", x0, y1], ["Z"]], s)];
}

function arrowOps(from: Pt, to: Pt, s: Style): Op[] {
  const dir = sub(to, from);
  return [path([["M", from[0], from[1]], ["L", to[0], to[1]], ...arrowhead(to, dir, s.width)], s, null)];
}

/** Signed area (positive for one winding, negative for the other; either works below). */
export function signedArea(v: Pt[]): number {
  let a = 0;
  for (let i = 0; i < v.length; i++) {
    const p = v[i], q = v[(i + 1) % v.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Scallop chord for a cloud of the given intensity. */
export function cloudChord(intensity: number): number {
  return 14 * Math.max(0.5, intensity);
}

/**
 * Revision cloud: each edge divided into equal chords, each bulging outwards as a half circle
 * drawn as two Bezier quarter arcs.
 */
function cloudOps(v: Pt[], intensity: number, s: Style): Op[] {
  if (v.length < 2) return [];
  const pos = signedArea(v) > 0;
  const target = cloudChord(intensity);
  const k = 0.55228475;
  const segs: Seg[] = [];
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    const e = len(sub(b, a));
    if (e < 1e-6) continue;
    const count = Math.max(1, Math.round(e / target));
    const d = mul(sub(b, a), 1 / count);
    const u = unit(d);
    // Outward normal: one side of travel or the other, by the winding.
    const out: Pt = pos ? [u[1], -u[0]] : [-u[1], u[0]];
    const r = len(d) / 2;
    for (let j = 0; j < count; j++) {
      const p0 = add(a, mul(d, j));
      const p1 = add(p0, d);
      const top = add(mul(add(p0, p1), 0.5), mul(out, r));
      if (!segs.length) segs.push(["M", p0[0], p0[1]]);
      const c1 = add(p0, mul(out, k * r)), c2 = sub(top, mul(u, k * r));
      const c3 = add(top, mul(u, k * r)), c4 = add(p1, mul(out, k * r));
      segs.push(["C", c1[0], c1[1], c2[0], c2[1], top[0], top[1]]);
      segs.push(["C", c3[0], c3[1], c4[0], c4[1], p1[0], p1[1]]);
    }
  }
  segs.push(["Z"]);
  return [path(segs, s)];
}

/** Freehand ink: each stroke smoothed with a Catmull-Rom spline through its points. */
function inkOps(strokes: Pt[][], s: Style): Op[] {
  const segs: Seg[] = [];
  for (const st of strokes) {
    if (!st.length) continue;
    segs.push(["M", st[0][0], st[0][1]]);
    if (st.length === 1) segs.push(["L", st[0][0] + 0.01, st[0][1]]); // a dot still shows
    for (let i = 0; i + 1 < st.length; i++) {
      const p0 = st[Math.max(0, i - 1)], p1 = st[i], p2 = st[i + 1], p3 = st[Math.min(st.length - 1, i + 2)];
      const c1 = add(p1, mul(sub(p2, p0), 1 / 6));
      const c2 = sub(p2, mul(sub(p3, p1), 1 / 6));
      segs.push(["C", c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]]);
    }
  }
  return [path(segs, s, null)];
}

/** Padding inside a text box's border, points. */
export const TEXT_PAD = 4;
/** Line spacing as a multiple of the size. */
export const LEADING = 1.2;
/** Helvetica's ascent as a share of the size: where the first baseline sits below the top. */
const ASCENT = 0.78;

/** A text box's lines, wrapped to its inner width. */
export function textLines(text: string, r: Rect, size: number, borderWidth: number): string[] {
  const [x0, , x1] = normRect(r);
  return wrap(text, Math.max(size, x1 - x0 - 2 * (TEXT_PAD + borderWidth)), size);
}

/** The height a text box needs for its text at its current width. */
export function textHeight(lines: number, size: number, borderWidth: number): number {
  return 2 * (TEXT_PAD + borderWidth) + Math.max(1, lines) * size * LEADING - size * (LEADING - 1);
}

function textOps(r: Rect, text: string, size: number, colour: Rgb, s: Style): Op[] {
  const [x0, y0, x1, y1] = normRect(r);
  const ops: Op[] = [];
  const hw = s.width / 2;
  if (s.width > 0 || s.fill) {
    ops.push(
      path(
        [["M", x0 + hw, y0 + hw], ["L", x1 - hw, y0 + hw], ["L", x1 - hw, y1 - hw], ["L", x0 + hw, y1 - hw], ["Z"]],
        s,
        s.fill,
        s.width > 0 ? s.stroke : null,
      ),
    );
  }
  const inset = TEXT_PAD + s.width;
  ops.push({
    t: "text",
    lines: textLines(text, r, size, s.width),
    origin: [x0 + inset, y0 + inset + size * ASCENT],
    dir: [1, 0],
    size,
    leading: size * LEADING,
    colour,
    clip: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
  });
  return ops;
}

/** A markup's drawing. */
export function opsFor(m: Markup): Op[] {
  switch (m.kind) {
    case "rect":
      return rectOps(m.rect, m.style);
    case "arrow":
      return arrowOps(m.from, m.to, m.style);
    case "cloud":
      return cloudOps(m.vertices, m.intensity, m.style);
    case "text":
      return textOps(m.rect, m.text, m.textStyle.size, m.textStyle.colour, m.style);
    case "ink":
      return inkOps(m.strokes, m.style);
  }
}

/** Every point a segment list touches (Bezier control points bound the curve). */
function segPoints(segs: Seg[]): Pt[] {
  const out: Pt[] = [];
  for (const s of segs) {
    if (s[0] === "M" || s[0] === "L") out.push([s[1], s[2]]);
    else if (s[0] === "C") out.push([s[1], s[2]], [s[3], s[4]], [s[5], s[6]]);
  }
  return out;
}

/** The area the operations cover, stroke included, grown by a point and snapped outwards. */
export function opsBounds(ops: Op[]): Rect {
  let b: Rect = [Infinity, Infinity, -Infinity, -Infinity];
  const take = (p: Pt, g: number) => {
    b = [Math.min(b[0], p[0] - g), Math.min(b[1], p[1] - g), Math.max(b[2], p[0] + g), Math.max(b[3], p[1] + g)];
  };
  for (const op of ops) {
    if (op.t === "path") for (const p of segPoints(op.segs)) take(p, op.width / 2 + 1);
    else if (op.clip) for (const p of op.clip) take(p, 1);
    else
      op.lines.forEach((l, i) => {
        const o = add(op.origin, [0, i * op.leading]);
        take(add(o, [0, -op.size]), 1);
        take(add(o, [textWidth(l, op.size), op.size * 0.25]), 1);
      });
  }
  if (!Number.isFinite(b[0])) return [0, 0, 0, 0];
  return [Math.floor(b[0]), Math.floor(b[1]), Math.ceil(b[2]), Math.ceil(b[3])];
}
