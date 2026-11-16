// Stage 6 [A11]: adding and removing a shape's corners. Every kind drawn by clicking out its
// points with no fixed count (polygon, cloud, polyline, area, polyline length) can take another
// corner (a double-click on an edge) or lose one (the right-click menu on it), never going below
// the fewest its gesture takes. Found by the gesture, not by kind, so a new kind can't opt out.
// Page coordinates. Pure.

import type { Markup, Pt } from "./base";
import { defOf } from "./kinds";
import { distToSegment, vertexIndex } from "./shape";

interface Corners {
  pts: Pt[];
  closed: boolean;
  /** The fewest it may have. */
  min: number;
}

/** Its corners, if they can be added and removed. */
export function cornersOf(m: Markup): Corners | null {
  const d = defOf(m).draw;
  const pts = (m as { vertices?: unknown }).vertices;
  if (d.gesture !== "points" || d.max || !Array.isArray(pts)) return null;
  return { pts: pts as Pt[], closed: d.closed, min: d.min };
}

const withCorners = (m: Markup, pts: Pt[]): Markup => {
  const def = defOf(m);
  const next = { ...m, vertices: pts } as Markup;
  return def.freeform ? def.freeform(next) : next;
};

/**
 * A corner added on the edge nearest p, within `tol` of it, at the point on the edge nearest
 * p (so the outline doesn't change until it's dragged). Null if no edge is that close.
 */
export function addCorner(m: Markup, p: Pt, tol: number): { markup: Markup; index: number } | null {
  const c = cornersOf(m);
  if (!c || c.pts.length < 2) return null;
  const n = c.closed ? c.pts.length : c.pts.length - 1;
  let best = -1, bd = Infinity;
  for (let i = 0; i < n; i++) {
    const d = distToSegment(p, c.pts[i], c.pts[(i + 1) % c.pts.length]);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  if (best < 0 || bd > tol) return null;
  const a = c.pts[best], b = c.pts[(best + 1) % c.pts.length];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  const at: Pt = [a[0] + t * dx, a[1] + t * dy];
  const pts = [...c.pts.slice(0, best + 1), at, ...c.pts.slice(best + 1)];
  return { markup: withCorners(m, pts), index: best + 1 };
}

/** Whether corner `index` can be removed (it has more than the fewest). */
export function canRemoveCorner(m: Markup, index: number): boolean {
  const c = cornersOf(m);
  return !!c && index >= 0 && index < c.pts.length && c.pts.length > c.min;
}

/** It without corner `index`; null if that would leave fewer than it may have. */
export function removeCorner(m: Markup, index: number): Markup | null {
  if (!canRemoveCorner(m, index)) return null;
  const c = cornersOf(m)!;
  return withCorners(m, c.pts.filter((_, i) => i !== index));
}

/** The corner a grip stands for, or -1 (not a corner, or not a shape whose corners change). */
export function cornerOfGrip(m: Markup, h: string): number {
  const c = cornersOf(m);
  return c ? vertexIndex(h as `v${number}`, c.pts.length) : -1;
}
