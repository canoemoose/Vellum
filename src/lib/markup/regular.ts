// Stage 6 [D11]: regular polygons. Dragging with Polygon makes one from the centre out, a corner
// on the pointer (so it turns to follow it); Shift puts a flat side at the bottom as viewed.
// Its parameters ride along with the polygon (kinds/polygon.ts) until a corner is changed by
// hand, so Sides can still change it. Page coordinates. Pure.

import type { Pt, Rect } from "./base";

export interface Regular {
  centre: Pt;
  /** Centre to each corner, page points. */
  radius: number;
  /** Radians: the direction from the centre to the first corner. */
  angle: number;
  sides: number;
}

export const MIN_SIDES = 3;
export const MAX_SIDES = 12;
export const DEFAULT_SIDES = 6;

/** A number of sides held to 3 to 12 (whole); anything unreadable is the default. */
export function clampSides(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(MAX_SIDES, Math.max(MIN_SIDES, Math.round(n))) : DEFAULT_SIDES;
}

/** Its corners, in order round from the first. */
export function regularVertices(r: Regular): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < r.sides; k++) {
    const a = r.angle + (2 * Math.PI * k) / r.sides;
    out.push([r.centre[0] + r.radius * Math.cos(a), r.centre[1] + r.radius * Math.sin(a)]);
  }
  return out;
}

/**
 * The first corner's angle that puts a flat side facing `down` (the page direction that is
 * down on screen, so it follows the view's quarter turns): that side's middle is half a step
 * round from a corner.
 */
export function flatAngle(sides: number, down: Pt): number {
  return Math.atan2(down[1], down[0]) - Math.PI / sides;
}

/**
 * The polygon dragged from `centre` to `p`: a corner on the pointer, or with `flatDown` (Shift:
 * the page direction that is down on screen) a flat side at the bottom, the pointer's distance
 * still setting its size.
 */
export function regularFromDrag(centre: Pt, p: Pt, sides: number, flatDown: Pt | null): Regular {
  const dx = p[0] - centre[0], dy = p[1] - centre[1];
  const n = clampSides(sides);
  return { centre, radius: Math.hypot(dx, dy), angle: flatDown ? flatAngle(n, flatDown) : Math.atan2(dy, dx), sides: n };
}

/** The same polygon with another number of sides: same centre, size and turn. */
export const withSides = (r: Regular, sides: number): Regular => ({ ...r, sides: clampSides(sides) });

/** Moved by (dx, dy). */
export const moveRegular = (r: Regular, dx: number, dy: number): Regular => ({ ...r, centre: [r.centre[0] + dx, r.centre[1] + dy] });

/**
 * Scaled with its box from `from` to `to`: still regular only if both ways scale alike (a resize
 * that kept proportions); null otherwise, when it becomes freeform.
 */
export function scaleRegular(r: Regular, from: Rect, to: Rect): Regular | null {
  const fw = from[2] - from[0], fh = from[3] - from[1];
  if (fw < 1e-9 || fh < 1e-9) return null;
  const sx = (to[2] - to[0]) / fw, sy = (to[3] - to[1]) / fh;
  if (Math.abs(sx - sy) > 1e-6 * Math.max(sx, sy)) return null;
  const centre: Pt = [to[0] + (r.centre[0] - from[0]) * sx, to[1] + (r.centre[1] - from[1]) * sy];
  return { ...r, centre, radius: r.radius * sx };
}

/** A regular polygon's parameters read back (from Vellum's saved copy), or null if not sound. */
export function readRegular(v: unknown): Regular | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  const c = r.centre;
  if (!Array.isArray(c) || c.length !== 2 || !fin(c[0]) || !fin(c[1])) return null;
  if (!fin(r.radius) || r.radius <= 0 || !fin(r.angle) || !fin(r.sides) || r.sides !== clampSides(r.sides)) return null;
  return { centre: [c[0], c[1]], radius: r.radius, angle: r.angle, sides: r.sides };
}

/** Whether `pts` are this polygon's corners (to within a thousandth of a point). */
export function matchesRegular(r: Regular, pts: Pt[]): boolean {
  const v = regularVertices(r);
  return v.length === pts.length && v.every((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]) < 1e-3);
}
