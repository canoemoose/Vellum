// Hit-testing, handles, moving and resizing markups. Page coordinates. Pure.

import { type Markup, type Pt, type Rect, normRect } from "./types";
import { cloudChord, opsBounds, opsFor } from "./ops";

/** The markup's geometry box (not counting stroke or scallops). */
export function shapeBounds(m: Markup): Rect {
  switch (m.kind) {
    case "rect":
    case "text":
      return normRect(m.rect);
    case "arrow":
      return normRect([m.from[0], m.from[1], m.to[0], m.to[1]]);
    case "cloud":
      return pointsBounds(m.vertices);
    case "ink":
      return pointsBounds(m.strokes.flat());
  }
}

/** Everything it draws, stroke and arrowheads included (what needs repainting). */
export function drawnBounds(m: Markup): Rect {
  return opsBounds(opsFor(m));
}

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

function distToPolyline(p: Pt, pts: Pt[], closed: boolean): number {
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

const rectPts = (r: Rect): Pt[] => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];

/**
 * Whether page point p picks the markup, within `tol` points of its line (or anywhere inside
 * it, for a filled shape or a text box).
 */
export function hits(m: Markup, p: Pt, tol: number): boolean {
  const t = tol + m.style.width / 2;
  switch (m.kind) {
    case "rect": {
      const r = normRect(m.rect);
      if (m.style.fill && insidePolygon(p, rectPts(r))) return true;
      return distToPolyline(p, rectPts(r), true) <= t;
    }
    case "text":
      return insidePolygon(p, rectPts(normRect(m.rect))) || distToPolyline(p, rectPts(normRect(m.rect)), true) <= t;
    case "arrow":
      return distToSegment(p, m.from, m.to) <= t;
    case "cloud":
      if (m.style.fill && insidePolygon(p, m.vertices)) return true;
      // The scallops stand out from the edges by up to half a chord.
      return distToPolyline(p, m.vertices, true) <= t + cloudChord(m.intensity) / 2;
    case "ink":
      return m.strokes.some((s) => distToPolyline(p, s, false) <= t);
  }
}

/** Whether the markup lies within a marquee (wholly inside it). */
export function insideMarquee(m: Markup, r: Rect): boolean {
  const b = shapeBounds(m);
  const q = normRect(r);
  return b[0] >= q[0] && b[1] >= q[1] && b[2] <= q[2] && b[3] <= q[3];
}

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "from" | "to" | `v${number}`;

export interface Handle {
  id: HandleId;
  at: Pt;
}

/** The grips a selected markup shows. */
export function handles(m: Markup): Handle[] {
  switch (m.kind) {
    case "arrow":
      return [{ id: "from", at: m.from }, { id: "to", at: m.to }];
    case "cloud":
      return m.vertices.map((v, i) => ({ id: `v${i}` as HandleId, at: v }));
    default: {
      const [x0, y0, x1, y1] = shapeBounds(m);
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const all: Handle[] = [
        { id: "nw", at: [x0, y0] }, { id: "n", at: [mx, y0] }, { id: "ne", at: [x1, y0] }, { id: "e", at: [x1, my] },
        { id: "se", at: [x1, y1] }, { id: "s", at: [mx, y1] }, { id: "sw", at: [x0, y1] }, { id: "w", at: [x0, my] },
      ];
      // Ink scales from its corners only.
      return m.kind === "ink" ? all.filter((h) => h.id.length === 2) : all;
    }
  }
}

/** The handle under p, within tol points. */
export function handleAt(m: Markup, p: Pt, tol: number): HandleId | null {
  let best: HandleId | null = null;
  let bd = Infinity;
  for (const h of handles(m)) {
    const d = Math.hypot(p[0] - h.at[0], p[1] - h.at[1]);
    if (d <= tol && d < bd) {
      best = h.id;
      bd = d;
    }
  }
  return best;
}

const mv = (p: Pt, dx: number, dy: number): Pt => [p[0] + dx, p[1] + dy];

export function moveBy(m: Markup, dx: number, dy: number): Markup {
  switch (m.kind) {
    case "rect":
    case "text":
      return { ...m, rect: [m.rect[0] + dx, m.rect[1] + dy, m.rect[2] + dx, m.rect[3] + dy] };
    case "arrow":
      return { ...m, from: mv(m.from, dx, dy), to: mv(m.to, dx, dy) };
    case "cloud":
      return { ...m, vertices: m.vertices.map((v) => mv(v, dx, dy)) };
    case "ink":
      return { ...m, strokes: m.strokes.map((s) => s.map((v) => mv(v, dx, dy))) };
  }
}

/** Snap the vector from `a` to `b` to the nearest 15 degrees. */
export function snapAngle(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 12;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)];
}

/** Make the box from fixed corner `a` to `b` square (Shift). */
export function squareFrom(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return [a[0] + Math.sign(dx || 1) * s, a[1] + Math.sign(dy || 1) * s];
}

/**
 * Drag handle `h` to page point p. `constrain` (Shift) snaps lines to 15 degrees and keeps a
 * box's proportions. Boxes never turn inside out: past the opposite edge they flip.
 */
export function dragHandle(m: Markup, h: HandleId, p: Pt, constrain: boolean, minSize = 2): Markup {
  if (m.kind === "arrow") {
    if (h === "from") return { ...m, from: constrain ? snapAngle(m.to, p) : p };
    if (h === "to") return { ...m, to: constrain ? snapAngle(m.from, p) : p };
    return m;
  }
  if (m.kind === "cloud") {
    const i = h.startsWith("v") ? Number(h.slice(1)) : -1;
    if (i < 0 || i >= m.vertices.length) return m;
    const vertices = m.vertices.slice();
    vertices[i] = p;
    return { ...m, vertices };
  }
  const old = shapeBounds(m);
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
  if (m.kind === "ink") {
    // Scale the strokes into the new box.
    const sx = (r[2] - r[0]) / Math.max(1e-6, old[2] - old[0]);
    const sy = (r[3] - r[1]) / Math.max(1e-6, old[3] - old[1]);
    const map = (v: Pt): Pt => [r[0] + (v[0] - old[0]) * sx, r[1] + (v[1] - old[1]) * sy];
    return { ...m, strokes: m.strokes.map((s) => s.map(map)) };
  }
  return { ...m, rect: r };
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
