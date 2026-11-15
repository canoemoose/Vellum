// The drawing toolkit every kind of markup draws with: operations in page coordinates (points,
// y down), paths and lines of text, and the pieces shapes are made of (fitted dashes, fills
// inside the line, arcs, line ends, text boxes). The overlay paints operations on the canvas
// (engine/markupPainter.ts) and pdf.ts turns the same operations into the annotation's
// appearance stream, so the screen and the file agree. Each kind's own drawing is in its file
// under kinds/; ops.ts picks the right one. Geometry ported from the phase 0 spike
// (spikes/annot-writer/src/appearance.rs). Pure, and a leaf: never imports a kind.

import { type LineEnd, type Pt, type Rect, type Rgb, type Style, type TextStyle, faceOf, fillOpacity, fullText, normRect } from "./base";
import { type Face, textWidth, wrap } from "./fonts";
import { drawnDash } from "./dash";

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
  /** Underline or strikethrough: square ends, and hidden with the text while it's typed. */
  decoration?: boolean;
  // Text markups
  /** Multiplied into what's under it (the highlighter, text highlights): darkens, never covers. */
  blend?: "multiply";
  /**
   * Drawn a fixed size on screen (a note's icon): the path is in page points at its size when
   * one point is one CSS pixel, and the painter scales it about this point to keep it so.
   */
  pin?: Pt;
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
  face: Face;
  /** Each line's start along `dir` from the origin (alignment). */
  offsets: number[];
}

export type Op = PathOp | TextOp | ImageOp;

// Stamps
/** A picture filling `rect` (page points, upright on the page as rendered): a stamp's image. */
export interface ImageOp {
  t: "image";
  rect: Rect;
  /** The PNG, base64; the painter decodes it once per hash. */
  png: string;
  /** Hex SHA-256 of the PNG bytes. */
  hash: string;
}

export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
export const len = (a: Pt) => Math.hypot(a[0], a[1]);
export const unit = (a: Pt): Pt => {
  const l = len(a);
  return l === 0 ? [1, 0] : [a[0] / l, a[1] / l];
};
export const rot = (a: Pt, ang: number): Pt => {
  const s = Math.sin(ang), c = Math.cos(ang);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
};

export function path(segs: Seg[], s: Style, fill: Rgb | null = s.fill, stroke: Rgb | null = s.stroke): PathOp {
  let dash = stroke ? drawnDash(s.dash, s.width) : null;
  // Straight edges: the dashes are drawn out here, fitted to the corners.
  const fit = dash ? fitDashes(segs, dash) : null;
  if (fit) {
    segs = fit;
    dash = null;
  }
  return { t: "path", segs, stroke, fill, width: stroke ? s.width : 0, dash, strokeOpacity: s.opacity, fillOpacity: fillOpacity(s) };
}

/**
 * A dashed outline of straight edges, drawn out as solid pieces so every corner (and each end of
 * an open line) has a dash centred on it, turning the corner with it (a dot, for a dotted line),
 * and each edge holds a whole number of repeats, stretched or squeezed to fit. Null if the path
 * has curves (those keep an ordinary dash pattern).
 */
export function fitDashes(segs: Seg[], dash: number[]): Seg[] | null {
  if (segs.some((g) => g[0] === "C")) return null;
  const pat = dash.length % 2 ? [...dash, ...dash] : dash; // an odd pattern repeats to even
  const period = pat.reduce((a, b) => a + b, 0);
  if (period <= 0) return null;
  // The subpaths as point lists.
  const subs: { pts: Pt[]; closed: boolean }[] = [];
  for (const g of segs) {
    if (g[0] === "M") subs.push({ pts: [[g[1], g[2]]], closed: false });
    else if (g[0] === "L") subs.at(-1)?.pts.push([g[1], g[2]]);
    else if (g[0] === "Z" && subs.length) subs[subs.length - 1].closed = true;
  }
  const out: Seg[] = [];
  const eps = 1e-6;
  for (const { pts, closed } of subs) {
    const v = pts.filter((p, i) => i === 0 || len(sub(p, pts[i - 1])) > eps);
    if (closed && v.length > 1 && len(sub(v[0], v[v.length - 1])) <= eps) v.pop();
    if (v.length < 2) continue;
    const edges = closed ? v.length : v.length - 1;
    // Pieces as point lists; a piece reaching an edge's end carries on round the corner.
    const pieces: Pt[][] = [];
    let open: Pt[] | null = null;
    let first: Pt[] | null = null; // a closed outline's piece at its starting corner
    for (let e = 0; e < edges; e++) {
      const a = v[e], b = v[(e + 1) % v.length];
      const L = len(sub(b, a));
      const u = mul(sub(b, a), 1 / L);
      const n = Math.max(1, Math.round(L / period));
      const k = L / (n * period);
      const at = (t: number): Pt => add(a, mul(u, t));
      // On-intervals: the pattern from minus half its first dash, so a dash centres on each end.
      for (let j = 0; j <= n; j++) {
        let t = j * period * k - (pat[0] * k) / 2;
        for (let i = 0; i < pat.length; i += 2) {
          const s0 = Math.max(0, t), s1 = Math.min(L, t + pat[i] * k);
          t += (pat[i] + pat[i + 1]) * k;
          if (s1 < s0 - eps) continue; // past the edge's end
          const startsAtCorner = s0 <= eps, endsAtCorner = s1 >= L - eps;
          if (startsAtCorner && open) open.push(at(s1));
          else {
            if (open) pieces.push(open);
            open = [at(s0), at(s1)];
            if (startsAtCorner && e === 0 && closed) first = open;
          }
          if (!endsAtCorner) {
            if (open !== first) pieces.push(open);
            open = null;
          }
        }
      }
    }
    if (open) {
      // Round the last corner of a closed outline into its first piece.
      if (closed && first) {
        first.unshift(...open.slice(0, -1));
        if (open !== first) open = null;
      }
      if (open) pieces.push(open);
    }
    if (first) pieces.push(first);
    for (const pc of pieces) {
      const q = pc.filter((p, i) => i === 0 || len(sub(p, pc[i - 1])) > eps);
      // A dot: a point, drawn as a line too short to see so its round caps make a circle.
      if (q.length === 1) q.push(add(q[0], [0.001, 0]));
      out.push(["M", q[0][0], q[0][1]], ...q.slice(1).map((p) => ["L", p[0], p[1]] as Seg));
    }
  }
  return out;
}

/**
 * A filled, outlined shape as two operations: the fill, drawn only inside the line's inner edge
 * (`inner`, the outline inset by half the line weight), then the line. So a see-through line
 * and fill don't overlap and the line reads as one tone. One operation when there's no line.
 */
export function filled(outline: Seg[], inner: () => Seg[], s: Style): Op[] {
  if (!s.fill) return [path(outline, s, null)];
  if (s.width <= 0) return [path(outline, s, s.fill, null)];
  return [path(inner(), s, s.fill, null), path(outline, s, null)];
}

export const box = (x0: number, y0: number, x1: number, y1: number, d: number): Seg[] => {
  // Inset by d, never past the middle.
  const dx = Math.min(d, (x1 - x0) / 2), dy = Math.min(d, (y1 - y0) / 2);
  return [["M", x0 + dx, y0 + dy], ["L", x1 - dx, y0 + dy], ["L", x1 - dx, y1 - dy], ["L", x0 + dx, y1 - dy], ["Z"]];
};

/**
 * A circular arc about `c`, radius r, from direction `from` to direction `to` (unit vectors),
 * going round the side `via` points to, as Bezier pieces of at most a quarter turn.
 */
export function arc(c: Pt, r: number, from: Pt, to: Pt, via: Pt): Seg[] {
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

export const HEAD_ANGLE = 0.4636; // about 26.6 degrees either side: a 2:1 head

/** A dot end's radius for a line weight. */
export const dotRadius = (width: number) => 1.5 + 1.25 * width;

/**
 * One end of a line at `p`, facing outwards along unit `d`: the strokes it adds (wings, a bar,
 * a slash), the solid shape it fills (a filled head, a dot), and how far back from `p` the line
 * should stop so it doesn't run under a filled shape (see-through lines would show it twice).
 */
export function lineEnd(kind: LineEnd, p: Pt, d: Pt, width: number): { segs: Seg[]; solid: Seg[] | null; back: number } {
  const len = arrowLength(width);
  const back = mul(d, -len);
  const n: Pt = [-d[1], d[0]];
  const half = len * Math.sin(HEAD_ANGLE);
  const line = (a: Pt, b: Pt): Seg[] => [["M", a[0], a[1]], ["L", b[0], b[1]]];
  switch (kind) {
    case "open": {
      const w1 = add(p, rot(back, HEAD_ANGLE)), w2 = add(p, rot(back, -HEAD_ANGLE));
      return { segs: [["M", w1[0], w1[1]], ["L", p[0], p[1]], ["L", w2[0], w2[1]]], solid: null, back: 0 };
    }
    case "filled": {
      const w1 = add(p, rot(back, HEAD_ANGLE)), w2 = add(p, rot(back, -HEAD_ANGLE));
      // The line stops so its round end just meets the head's base.
      return { segs: [], solid: [["M", p[0], p[1]], ["L", w1[0], w1[1]], ["L", w2[0], w2[1]], ["Z"]], back: len * Math.cos(HEAD_ANGLE) + width / 2 };
    }
    case "dot": {
      const r = dotRadius(width);
      // Where the line's sides meet the circle.
      return { segs: [], solid: circle(p, r), back: Math.sqrt(Math.max(0, r * r - (width * width) / 4)) };
    }
    case "bar":
      return { segs: line(add(p, mul(n, half)), add(p, mul(n, -half))), solid: null, back: 0 };
    case "slash": {
      // Through the end, 30 degrees off square, as PDF's /Slash.
      const t = rot(n, Math.PI / 6);
      return { segs: line(add(p, mul(t, half)), add(p, mul(t, -half))), solid: null, back: 0 };
    }
    default:
      return { segs: [], solid: null, back: 0 };
  }
}

/** A full circle as four quarter arcs. */
export function circle(c: Pt, r: number): Seg[] {
  return [["M", c[0] + r, c[1]], ...arc(c, r, [1, 0], [-1, 0], [0, 1]), ...arc(c, r, [-1, 0], [1, 0], [0, -1]), ["Z"]];
}

/**
 * An open line through `pts` with an end drawn at each end ([tail, head]): the line takes the
 * pattern and stops short of filled ends; the ends are always solid, filled ones in the line's
 * colour with no outline (so nothing is drawn twice). An arrow is the two-point case.
 */
export function endedLine(pts: Pt[], ends: [LineEnd, LineEnd], s: Style): Op[] {
  if (pts.length < 2) return [];
  const n = pts.length;
  const u0 = unit(sub(pts[1], pts[0]));
  const un = unit(sub(pts[n - 1], pts[n - 2]));
  const tail = lineEnd(ends[0], pts[0], mul(u0, -1), s.width);
  const head = lineEnd(ends[1], pts[n - 1], un, s.width);
  let line: Pt[];
  if (n === 2) {
    // Never past each other: the room left between the ends, from the tail's side.
    const total = len(sub(pts[1], pts[0]));
    const room = Math.max(0, total - tail.back - head.back);
    const a = add(pts[0], mul(u0, Math.min(tail.back, total)));
    line = [a, add(a, mul(u0, room))];
  } else {
    const first = len(sub(pts[1], pts[0])), last = len(sub(pts[n - 1], pts[n - 2]));
    line = [add(pts[0], mul(u0, Math.min(tail.back, first))), ...pts.slice(1, -1), sub(pts[n - 1], mul(un, Math.min(head.back, last)))];
  }
  const shaft = path([["M", line[0][0], line[0][1]], ...line.slice(1).map((p) => ["L", p[0], p[1]] as Seg)], s, null);
  const ops: Op[] = [{ ...shaft, segs: [...shaft.segs, ...tail.segs, ...head.segs] }];
  for (const e of [tail, head]) {
    if (e.solid) ops.push({ t: "path", segs: e.solid, stroke: null, fill: s.stroke, width: 0, dash: null, strokeOpacity: s.opacity, fillOpacity: s.opacity });
  }
  return ops;
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

/** Padding inside a text box's border, points. */
export const TEXT_PAD = 4;
/** Where the first baseline sits below the top, as a share of the size (every family). */
export const ASCENT = 0.78;

/** A text box's inner width for its text. */
export function innerWidth(r: Rect, size: number, borderWidth: number): number {
  const [x0, , x1] = normRect(r);
  return Math.max(size, x1 - x0 - 2 * (TEXT_PAD + borderWidth));
}

/** A text box's lines, wrapped to its inner width. */
export function textLines(text: string, r: Rect, t: TextStyle, borderWidth: number): string[] {
  return wrap(text, innerWidth(r, t.size, borderWidth), t.size, faceOf(t));
}

/** The height a text box needs for `lines` lines. */
export function textHeight(lines: number, t: TextStyle, borderWidth: number): number {
  const lead = fullText(t).spacing;
  return 2 * (TEXT_PAD + borderWidth) + Math.max(1, lines) * t.size * lead - t.size * (lead - 1);
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
    else if (op.t === "image") for (const p of [[op.rect[0], op.rect[1]], [op.rect[2], op.rect[3]]] as Pt[]) take(p, 0);
    else if (op.clip) for (const p of op.clip) take(p, 1);
    else
      op.lines.forEach((l, i) => {
        const o = add(op.origin, [0, i * op.leading]);
        take(add(o, [0, -op.size]), 1);
        take(add(o, [op.offsets[i] + textWidth(l, op.size, op.face), op.size * 0.25]), 1);
      });
  }
  if (!Number.isFinite(b[0])) return [0, 0, 0, 0];
  return [Math.floor(b[0]), Math.floor(b[1]), Math.ceil(b[2]), Math.ceil(b[3])];
}
