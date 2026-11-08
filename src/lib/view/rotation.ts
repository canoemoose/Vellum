// View rotation (0, 90, 180, 270 degrees clockwise): view only, never the file. Pure maths.
//
// "Page" coordinates are the unrotated page in points, x right and y down from its top-left
// corner, exactly as the renderer sees it (tiles, previews and the text layer all live here).
// "Rotated" coordinates are the same page as displayed: for 90 and 270 its width and height
// swap. The layout stacks rotated pages; the compositor maps page -> rotated -> world -> screen.

import type { PageSize } from "./layout";
import type { Rect } from "./viewMath";

export type Rotation = 0 | 90 | 180 | 270;

/** Any multiple of 90 degrees (negative allowed) to 0, 90, 180 or 270. */
export function normRotation(deg: number): Rotation {
  const r = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return r as Rotation;
}

/** Page size as displayed. */
export function rotatedSize(s: PageSize, r: Rotation): PageSize {
  return r === 90 || r === 270 ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
}

/** Page point -> rotated point, for a page of size `s` (unrotated). */
export function rotatePoint(x: number, y: number, s: PageSize, r: Rotation): [number, number] {
  switch (r) {
    case 90:
      return [s.h - y, x];
    case 180:
      return [s.w - x, s.h - y];
    case 270:
      return [y, s.w - x];
    default:
      return [x, y];
  }
}

/** Rotated point -> page point (inverse of rotatePoint). */
export function unrotatePoint(x: number, y: number, s: PageSize, r: Rotation): [number, number] {
  switch (r) {
    case 90:
      return [y, s.h - x];
    case 180:
      return [s.w - x, s.h - y];
    case 270:
      return [s.w - y, x];
    default:
      return [x, y];
  }
}

function rectFromCorners(a: [number, number], b: [number, number]): Rect {
  const x0 = Math.min(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  return { x: x0, y: y0, w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}

/** A page rect as displayed (axis-aligned, since rotations are multiples of 90). */
export function rotateRect(rc: Rect, s: PageSize, r: Rotation): Rect {
  return rectFromCorners(rotatePoint(rc.x, rc.y, s, r), rotatePoint(rc.x + rc.w, rc.y + rc.h, s, r));
}

/** A displayed rect back in page coordinates. */
export function unrotateRect(rc: Rect, s: PageSize, r: Rotation): Rect {
  return rectFromCorners(unrotatePoint(rc.x, rc.y, s, r), unrotatePoint(rc.x + rc.w, rc.y + rc.h, s, r));
}

/**
 * The 2D-canvas transform that draws an unrotated bitmap into the axis-aligned destination
 * rect (X0, Y0)-(X1, Y1) rotated by `r`, together with the size to draw the bitmap at under
 * that transform: ctx.setTransform(...m); ctx.drawImage(bmp, 0, 0, dw, dh).
 */
export function rotatedDrawTransform(
  X0: number, Y0: number, X1: number, Y1: number, r: Rotation,
): { m: [number, number, number, number, number, number]; dw: number; dh: number } {
  const W = X1 - X0;
  const H = Y1 - Y0;
  switch (r) {
    case 90:
      return { m: [0, 1, -1, 0, X1, Y0], dw: H, dh: W };
    case 180:
      return { m: [-1, 0, 0, -1, X1, Y1], dw: W, dh: H };
    case 270:
      return { m: [0, -1, 1, 0, X0, Y1], dw: H, dh: W };
    default:
      return { m: [1, 0, 0, 1, X0, Y0], dw: W, dh: H };
  }
}
