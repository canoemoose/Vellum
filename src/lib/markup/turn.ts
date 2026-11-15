// Stage 8 (docs/editing-tool-consistency-brief.md): turning a box about its centre, for stamps,
// signatures and images. A turned box is kept as its upright box (`rect`, as if it weren't
// turned) and an angle: degrees clockwise as seen on the page (page coordinates are y down, so
// the ordinary rotation matrix turns clockwise on screen). Everything else (its corners, its
// bounds, hit-testing, resizing in its own frame, the rotate grip, which way is up as viewed) is
// worked out here. Pure, and a leaf.

import { type Pt, type Rect, normRect } from "./base";
import type { Op } from "./draw";

/** Degrees to 0 <= d < 360. */
export function normDeg(d: number): number {
  const r = ((d % 360) + 360) % 360;
  // Rounding noise (359.9999999) reads as 0.
  return Math.abs(r - 360) < 1e-9 ? 0 : r;
}

/** The box's centre. */
export const centreOf = (r: Rect): Pt => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];

/** p turned by `deg` clockwise (as seen on the page) about c. */
export function turnPt(p: Pt, c: Pt, deg: number): Pt {
  if (!deg) return p;
  const a = (deg * Math.PI) / 180;
  const s = Math.sin(a), k = Math.cos(a);
  const dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * k - dy * s, c[1] + dx * s + dy * k];
}

/** A turned box's corners: its own top left, top right, bottom right, bottom left. */
export function turnedCorners(r: Rect, deg: number): Pt[] {
  const [x0, y0, x1, y1] = normRect(r);
  const c = centreOf(r);
  return ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Pt[]).map((p) => turnPt(p, c, deg));
}

/** The upright box on the page that holds a turned box. */
export function turnedBounds(r: Rect, deg: number): Rect {
  if (!deg) return normRect(r);
  const pts = turnedCorners(r, deg);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** A page point in the box's own (unturned) frame: turned back about the centre. */
export const toOwnFrame = (p: Pt, r: Rect, deg: number): Pt => turnPt(p, centreOf(r), -deg);

/** Whether p is within `t` of the turned box (inside it, or near its edge). */
export function insideTurned(p: Pt, r: Rect, deg: number, t: number): boolean {
  const [x0, y0, x1, y1] = normRect(r);
  const q = toOwnFrame(p, r, deg);
  return q[0] >= x0 - t && q[0] <= x1 + t && q[1] >= y0 - t && q[1] <= y1 + t;
}

/** The corner grips by name, at a turned box's corners. */
export const CORNERS = ["nw", "ne", "se", "sw"] as const;
export type Corner = (typeof CORNERS)[number];

/**
 * The rotate grip: `gap` points above the middle of the box's top edge, in its own frame (so it
 * stays above the box however it's turned).
 */
export function rotateGripAt(r: Rect, deg: number, gap: number): Pt {
  const [x0, y0, x1] = normRect(r);
  return turnPt([(x0 + x1) / 2, y0 - gap], centreOf(r), deg);
}

/** The middle of the turned box's top edge (where the rotate grip's stem starts). */
export function topMiddle(r: Rect, deg: number): Pt {
  const [x0, y0, x1] = normRect(r);
  return turnPt([(x0 + x1) / 2, y0], centreOf(r), deg);
}

/**
 * The angle the rotate grip, dragged to p, gives the box: the grip points from the centre to the
 * pointer. Rule 2: `step` (Shift) holds it to 15 degree steps.
 */
export function angleTo(r: Rect, p: Pt, step: boolean): number {
  const c = centreOf(r);
  if (Math.hypot(p[0] - c[0], p[1] - c[1]) < 1e-9) return 0;
  // The grip sits straight up from the centre at 0: -90 degrees on the page (y down).
  let d = (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI + 90;
  if (step) d = Math.round(d / 15) * 15;
  return normDeg(d);
}

/**
 * Resize a turned box from a corner, in its own frame: corner `h` dragged to page point p, with
 * the opposite corner staying where it is on the page. `resize` does the upright resize (in the
 * box's own frame); the result is moved so the fixed corner doesn't shift.
 */
export function resizeTurned(r: Rect, deg: number, p: Pt, resize: (own: Rect, q: Pt) => Rect): Rect {
  const c = centreOf(r);
  const own = resize(normRect(r), turnPt(p, c, -deg));
  if (!deg) return own;
  // The new box in the old frame turns about the old centre; its own centre moves to there.
  const c1 = turnPt(centreOf(own), c, deg);
  const w = own[2] - own[0], h = own[3] - own[1];
  return [c1[0] - w / 2, c1[1] - h / 2, c1[0] + w / 2, c1[1] + h / 2];
}

/**
 * The angle that makes something upright as viewed, with the view turned `viewRotation`
 * degrees clockwise (quarter turns, viewer.rotation): turned back by as much.
 */
export const uprightAngle = (viewRotation: number): number => normDeg(-viewRotation);

/**
 * The corner of a page box that shows at the top left of the screen with the view turned
 * `viewRotation` (a quarter turn clockwise puts the page's bottom left there).
 */
export function screenTopLeft(r: Rect, viewRotation: number): Pt {
  const [x0, y0, x1, y1] = normRect(r);
  switch (normDeg(Math.round(viewRotation / 90) * 90)) {
    case 90:
      return [x0, y1];
    case 180:
      return [x1, y1];
    case 270:
      return [x1, y0];
    default:
      return [x0, y0];
  }
}

/** Whether a quarter-turned view swaps a box's width and height on screen. */
export const swapsSides = (viewRotation: number): boolean => Math.round(normDeg(viewRotation) / 90) % 2 === 1;

/** Operations turned by `deg` clockwise about c (a stamp's drawing, turned with its box). */
export function turnOps(ops: Op[], c: Pt, deg: number): Op[] {
  if (!deg) return ops;
  const P = (x: number, y: number) => turnPt([x, y], c, deg);
  const D = (d: Pt) => turnPt(d, [0, 0], deg);
  return ops.map((op): Op => {
    if (op.t === "path") {
      return {
        ...op,
        segs: op.segs.map((s) => {
          if (s[0] === "M" || s[0] === "L") return [s[0], ...P(s[1], s[2])];
          if (s[0] === "C") return ["C", ...P(s[1], s[2]), ...P(s[3], s[4]), ...P(s[5], s[6])];
          return s;
        }),
        pin: op.pin ? P(op.pin[0], op.pin[1]) : op.pin,
      };
    }
    if (op.t === "text") return { ...op, origin: P(op.origin[0], op.origin[1]), dir: D(op.dir), clip: op.clip?.map((q) => P(q[0], q[1])) ?? null };
    // A picture keeps its box (moved with its centre) and turns about its own centre.
    const [x0, y0, x1, y1] = op.rect;
    const m = P((x0 + x1) / 2, (y0 + y1) / 2);
    const w = x1 - x0, h = y1 - y0;
    return { ...op, rect: [m[0] - w / 2, m[1] - h / 2, m[0] + w / 2, m[1] + h / 2], angle: normDeg((op.angle ?? 0) + deg) };
  });
}
