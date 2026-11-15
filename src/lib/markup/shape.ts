// The geometry toolkit every kind of markup is hit-tested, gripped and resized with: distances,
// bounds, the eight box handles and dragging them, angle and square constraints, simplifying
// freehand strokes. Page coordinates. Each kind's own rules are in its file under kinds/;
// geometry.ts picks the right one. Pure, and a leaf: never imports a kind.

import { type Pt, type Rect, normRect } from "./base";

export function pointsBounds(pts: Pt[]): Rect {
  if (!pts.length) return [0, 0, 0, 0];
  let b: Rect = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of pts) b = [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])];
  return b;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distToPolyline(p: Pt, pts: Pt[], closed: boolean): number {
  if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
  let d = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) d = Math.min(d, distToSegment(p, pts[i], pts[(i + 1) % pts.length]));
  return d;
}

export function insidePolygon(p: Pt, v: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const [xi, yi] = v[i], [xj, yj] = v[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A box's corners, clockwise from the top left. */
export const rectPts = (r: Rect): Pt[] => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "from" | "to" | `v${number}` | "rotate"; // Stage 8: rotate

export interface Handle {
  id: HandleId;
  at: Pt;
}

/** A box's eight grips (or its four corners only). */
export function boxHandles(b: Rect, cornersOnly = false): Handle[] {
  const [x0, y0, x1, y1] = b;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const all: Handle[] = [
    { id: "nw", at: [x0, y0] }, { id: "n", at: [mx, y0] }, { id: "ne", at: [x1, y0] }, { id: "e", at: [x1, my] },
    { id: "se", at: [x1, y1] }, { id: "s", at: [mx, y1] }, { id: "sw", at: [x0, y1] }, { id: "w", at: [x0, my] },
  ];
  return cornersOnly ? all.filter((h) => h.id.length === 2) : all;
}

/** A grip on each of a shape's points ("v0", "v1"...). */
export const vertexHandles = (pts: Pt[]): Handle[] => pts.map((v, i) => ({ id: `v${i}` as HandleId, at: v }));

/** The point index a vertex grip stands for, or -1. */
export function vertexIndex(h: HandleId, count: number): number {
  const i = h.startsWith("v") ? Number(h.slice(1)) : -1;
  return i >= 0 && i < count ? i : -1;
}

/** `pts` with the point under vertex grip `h` moved to p (unchanged for any other grip). */
export function dragVertex(pts: Pt[], h: HandleId, p: Pt): Pt[] | null {
  const i = vertexIndex(h, pts.length);
  if (i < 0) return null;
  const out = pts.slice();
  out[i] = p;
  return out;
}

/**
 * A shape's point under grip `h` dragged to p. Shift snaps it to 15 degrees from the point
 * before it (the one after, for the first point of an open line).
 */
export function dragPoint<M extends { vertices: Pt[] }>(m: M, h: HandleId, p: Pt, constrain: boolean, closed: boolean): M {
  const v = m.vertices;
  const i = vertexIndex(h, v.length);
  if (i < 0) return m;
  const prev = i > 0 ? v[i - 1] : closed ? v[v.length - 1] : v[1];
  const vertices = dragVertex(v, h, constrain && prev ? snapAngle(prev, p) : p);
  return vertices ? { ...m, vertices } : m;
}

export const movePt = (p: Pt, dx: number, dy: number): Pt => [p[0] + dx, p[1] + dy];

/** Snap the vector from `a` to `b` to the nearest 15 degrees. */
export function snapAngle(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 12;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)];
}

/** `b` moved onto the horizontal or vertical through `a`, whichever is nearer (ortho on the page). */
export function orthoFrom(a: Pt, b: Pt): Pt {
  return Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? [b[0], a[1]] : [a[0], b[1]];
}

/** Make the box from fixed corner `a` to `b` square (Shift). */
export function squareFrom(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return [a[0] + Math.sign(dx || 1) * s, a[1] + Math.sign(dy || 1) * s];
}

/**
 * Box `old` with box grip `h` dragged to p. `constrain` (Shift) keeps the proportions from the
 * opposite corner. Never inside out: past the opposite edge it flips. At least minSize each way.
 */
export function dragBox(old: Rect, h: HandleId, p: Pt, constrain: boolean, minSize: number): Rect {
  let [x0, y0, x1, y1] = old;
  if (h.includes("w")) x0 = p[0];
  if (h.includes("e")) x1 = p[0];
  if (h.includes("n")) y0 = p[1];
  if (h.includes("s")) y1 = p[1];
  if (constrain && h.length === 2) {
    // Keep the aspect ratio from the opposite corner.
    const ax = h.includes("w") ? old[2] : old[0];
    const ay = h.includes("n") ? old[3] : old[1];
    const ratio = (old[2] - old[0]) / Math.max(1e-6, old[3] - old[1]);
    const w = Math.abs(p[0] - ax), hh = Math.abs(p[1] - ay);
    const s = Math.max(w / ratio, hh);
    const bx = ax + Math.sign(p[0] - ax || 1) * s * ratio;
    const by = ay + Math.sign(p[1] - ay || 1) * s;
    [x0, y0, x1, y1] = [ax, ay, bx, by];
  }
  let r = normRect([x0, y0, x1, y1]);
  if (r[2] - r[0] < minSize) r = [r[0], r[1], r[0] + minSize, r[3]];
  if (r[3] - r[1] < minSize) r = [r[0], r[1], r[2], r[1] + minSize];
  return r;
}

/** Points mapped from box `from` into box `to` (a shape scaled by its box's grips). */
export function mapPoints(pts: Pt[], from: Rect, to: Rect): Pt[] {
  const sx = (to[2] - to[0]) / Math.max(1e-6, from[2] - from[0]);
  const sy = (to[3] - to[1]) / Math.max(1e-6, from[3] - from[1]);
  return pts.map((v) => [to[0] + (v[0] - from[0]) * sx, to[1] + (v[1] - from[1]) * sy]);
}

/**
 * Reduce a freehand stroke (Ramer-Douglas-Peucker): drop points within `tol` points of the
 * line through their neighbours. Keeps the ends.
 */
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  let maxD = -1, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
  const a = simplify(pts.slice(0, idx + 1), tol);
  const b = simplify(pts.slice(idx), tol);
  return [...a.slice(0, -1), ...b];
}

/**
 * The cursor for a handle: the resize arrows along its direction on screen (swapped when the
 * view is turned a quarter turn), or the four-way move arrows for a point (an arrow's end, a
 * cloud's corner). Never a hand: that means panning.
 */
export function handleCursor(h: HandleId, viewRotation: number, turn = 0): string {
  // Stage 8: the rotate grip has its own; a turned box's grips point the way they face on screen.
  if (h === "rotate") return ROTATE_CURSOR;
  const dir = GRIP_DIR[h];
  if (dir === undefined) return "move";
  const on = (((Math.round((dir + viewRotation + turn) / 45) * 45) % 180) + 180) % 180;
  return on === 0 ? "ew-resize" : on === 45 ? "nwse-resize" : on === 90 ? "ns-resize" : "nesw-resize";
}

// Stage 8
/** Which way each box grip points from the box's middle, degrees clockwise from the right (y down). */
const GRIP_DIR: Partial<Record<HandleId, number>> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };

/** The rotate grip's cursor: a circling arrow (there's no standard one), its hot spot in the middle. */
export const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18.5 12a6.5 6.5 0 1 1-2-4.7" stroke="#fff" stroke-width="4"/><path d="M17 3.5v4.5h-4.5" stroke="#fff" stroke-width="4"/><path d="M18.5 12a6.5 6.5 0 1 1-2-4.7" stroke="#000" stroke-width="1.6"/><path d="M17 3.5v4.5h-4.5" stroke="#000" stroke-width="1.6"/></g></svg>',
)}") 12 12, crosshair`;
