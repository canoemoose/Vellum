// Hit-testing, handles, moving and resizing markups. Page coordinates. The toolkit is shape.ts;
// each kind's rules are in its file under kinds/. Pure.

import { type Markup, type Pt, type Rect, normRect } from "./base";
import { opsBounds } from "./draw";
import { opsFor } from "./ops";
import { type Handle, type HandleId } from "./shape";
import { defOf } from "./kinds";

export * from "./shape";

/** The markup's geometry box (not counting stroke or scallops). */
export function shapeBounds(m: Markup): Rect {
  return defOf(m).bounds(m);
}

/** Everything it draws, stroke and arrowheads included (what needs repainting). */
export function drawnBounds(m: Markup): Rect {
  return opsBounds(opsFor(m));
}

/**
 * Whether page point p picks the markup, within `tol` points of its line (or anywhere inside
 * it, for a filled shape or a text box).
 */
export function hits(m: Markup, p: Pt, tol: number): boolean {
  return defOf(m).hits(m, p, tol + m.style.width / 2);
}

/** Whether the markup lies within a marquee (wholly inside it). */
export function insideMarquee(m: Markup, r: Rect): boolean {
  const b = shapeBounds(m);
  const q = normRect(r);
  return b[0] >= q[0] && b[1] >= q[1] && b[2] <= q[2] && b[3] <= q[3];
}

/** The grips a selected markup shows. */
export function handles(m: Markup): Handle[] {
  return defOf(m).handles(m);
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

export function moveBy(m: Markup, dx: number, dy: number): Markup {
  return defOf(m).moveBy(m, dx, dy);
}

/**
 * Drag handle `h` to page point p. `constrain` (Shift) snaps lines to 15 degrees and keeps a
 * box's proportions. Boxes never turn inside out: past the opposite edge they flip.
 */
export function dragHandle(m: Markup, h: HandleId, p: Pt, constrain: boolean, minSize = 2): Markup {
  return defOf(m).dragHandle(m, h, p, constrain, minSize);
}
