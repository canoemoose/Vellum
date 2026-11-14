// A markup's drawing as operations in page coordinates (points, y down): paths and lines of
// text. The overlay paints these on the canvas (engine/markupPainter.ts) and pdf.ts turns the
// same operations into the annotation's appearance stream, so the screen and the file agree.
// Geometry ported from the phase 0 spike (spikes/annot-writer/src/appearance.rs). Pure.

import { type Markup, type Pt, type Rect, type Rgb, type Style, fillOpacity, normRect } from "./types";
import { textWidth, wrap } from "./helvetica";

export type Seg = ["M", number, number] | ["L", number, number] | ["C", number, number, number, number, number, number] | ["Z"];

export interface PathOp {
  t: "path";
  segs: Seg[];
  stroke: Rgb | null;
  fill: Rgb | null;
  width: number;
  dash: number[] | null;
  /** Line and fill opacity, 0..1. */
  strokeOpacity: number;
  fillOpacity: number;
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
  return { t: "path", segs, stroke, fill, width: stroke ? s.width : 0, dash: s.dash, strokeOpacity: s.opacity, fillOpacity: fillOpacity(s) };
}

/**
 * A filled, outlined shape as two operations: the fill, drawn only inside the line's inner edge
 * (`inner`, the outline inset by half the line weight), then the line. So a see-through line
 * and fill don't overlap and the line reads as one tone. One operation when there's no line.
 */
function filled(outline: Seg[], inner: () => Seg[], s: Style): Op[] {
  if (!s.fill) return [path(outline, s, null)];
  if (s.width <= 0) return [path(outline, s, s.fill, null)];
  return [path(inner(), s, s.fill, null), path(outline, s, null)];
}

const box = (x0: number, y0: number, x1: number, y1: number, d: number): Seg[] => {
  // Inset by d, never past the middle.
  const dx = Math.min(d, (x1 - x0) / 2), dy = Math.min(d, (y1 - y0) / 2);
  return [["M", x0 + dx, y0 + dy], ["L", x1 - dx, y0 + dy], ["L", x1 - dx, y1 - dy], ["L", x0 + dx, y1 - dy], ["Z"]];
};

/**
 * A circular arc about `c`, radius r, from direction `from` to direction `to` (unit vectors),
 * going round the side `via` points to, as Bezier pieces of at most a quarter turn.
 */
function arc(c: Pt, r: number, from: Pt, to: Pt, via: Pt): Seg[] {
  const a0 = Math.atan2(from[1], from[0]);
  let d = Math.atan2(to[1], to[0]) - a0;
  while (d <= 0) d += 2 * Math.PI;
  // d runs anticlockwise (in these axes); the other way round is d - 2 pi. Take the one through `via`.
  const mid = a0 + d / 2;
  if (Math.cos(mid) * via[0] + Math.sin(mid) * via[1] < 0) d -= 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 2) - 1e-9));
  const step = d / n;
  const k = (4 / 3) * Math.tan(step / 4) * r;
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + i * step, t1 = t0 + step;
    const p0: Pt = [c[0] + r * Math.cos(t0), c[1] + r * Math.sin(t0)];
    const p1: Pt = [c[0] + r * Math.cos(t1), c[1] + r * Math.sin(t1)];
    segs.push(["C", p0[0] - k * Math.sin(t0), p0[1] + k * Math.cos(t0), p1[0] + k * Math.sin(t1), p1[1] - k * Math.cos(t1), p1[0], p1[1]]);
  }
  return segs;
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
  return filled(box(x0, y0, x1, y1, 0), () => box(x0, y0, x1, y1, s.width / 2), s);
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

interface Scallop {
  /** Centre, radius, direction along the edge, outward normal. */
  c: Pt;
  r: number;
  u: Pt;
  out: Pt;
}

/** A revision cloud's scallops: each edge divided into equal chords, each a half circle bulging outwards. */
function scallops(v: Pt[], intensity: number): Scallop[] {
  const pos = signedArea(v) > 0;
  const target = cloudChord(intensity);
  const out: Scallop[] = [];
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    const e = len(sub(b, a));
    if (e < 1e-6) continue;
    const count = Math.max(1, Math.round(e / target));
    const d = mul(sub(b, a), 1 / count);
    const u = unit(d);
    // Outward normal: one side of travel or the other, by the winding.
    const n: Pt = pos ? [u[1], -u[0]] : [-u[1], u[0]];
    for (let j = 0; j < count; j++) out.push({ c: add(a, mul(d, j + 0.5)), r: len(d) / 2, u, out: n });
  }
  return out;
}

/** The cloud's outline: the scallops end to end. */
function cloudOutline(sc: Scallop[]): Seg[] {
  const segs: Seg[] = [];
  for (const q of sc) {
    const p0 = sub(q.c, mul(q.u, q.r));
    if (!segs.length) segs.push(["M", p0[0], p0[1]]);
    segs.push(...arc(q.c, q.r, mul(q.u, -1), q.u, q.out));
  }
  segs.push(["Z"]);
  return segs;
}

/**
 * The cloud's outline inset by d: each scallop shrunk about its centre, and between scallops a
 * small inward arc round the point where they meet (the line's round join there).
 */
function cloudInner(sc: Scallop[], d: number): Seg[] {
  const segs: Seg[] = [];
  sc.forEach((q, i) => {
    const r = Math.max(0, q.r - d);
    const p0 = sub(q.c, mul(q.u, r));
    segs.push([segs.length ? "L" : "M", p0[0], p0[1]]);
    if (r > 0) segs.push(...arc(q.c, r, mul(q.u, -1), q.u, q.out));
    // Round the meeting point, from this scallop's end to the next one's start.
    const nx = sc[(i + 1) % sc.length];
    const meet = add(q.c, mul(q.u, q.r));
    if (q.r > d && nx.r > d) {
      const inward: Pt = mul(add(q.out, nx.out), -1);
      segs.push(...arc(meet, d, mul(q.u, -1), nx.u, len(inward) > 1e-6 ? inward : mul(q.out, -1)));
    }
  });
  segs.push(["Z"]);
  return segs;
}

/** Revision cloud: half-circle scallops along each edge, bulging outwards. */
function cloudOps(v: Pt[], intensity: number, s: Style): Op[] {
  if (v.length < 2) return [];
  const sc = scallops(v, intensity);
  if (!sc.length) return [];
  return filled(cloudOutline(sc), () => cloudInner(sc, s.width / 2), s);
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
  // The border sits inside the box: its centre half a weight in, its inner edge a whole weight.
  if (s.width > 0) ops.push(...filled(box(x0, y0, x1, y1, s.width / 2), () => box(x0, y0, x1, y1, s.width), s));
  else if (s.fill) ops.push(path(box(x0, y0, x1, y1, 0), s, s.fill, null));
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
