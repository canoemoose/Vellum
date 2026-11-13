// Bringing a small thing (a search hit, a link target) into view. Pure.

import { MAX_SCALE, type Rect, type View } from "./viewMath";

export interface RevealOptions {
  /** Zoom in when the target's smaller side would be under this many CSS px... */
  minPx: number;
  /** ...until it's this big. */
  targetPx: number;
  /** Keep this much of the viewport (fraction per side) clear around the target. */
  margin: number;
}

export const REVEAL_DEFAULTS: RevealOptions = { minPx: 8, targetPx: 20, margin: 0.1 };

/**
 * The view that shows world rect `r`, or null if the current view already shows it well
 * (inside the viewport's margins, and big enough to read). Zooming in is capped so the
 * target still fits across the viewport; it never zooms out.
 */
export function revealView(view: View, r: Rect, vw: number, vh: number, o: RevealOptions = REVEAL_DEFAULTS): View | null {
  let s = view.scale;
  const small = Math.min(r.w, r.h) * s;
  if (small < o.minPx) {
    s = (s * o.targetPx) / Math.max(small, 1e-6);
    // Don't zoom past the point where the whole target no longer fits.
    const fit = Math.min((vw * (1 - 2 * o.margin)) / Math.max(r.w, 1e-6), (vh * (1 - 2 * o.margin)) / Math.max(r.h, 1e-6));
    s = Math.max(view.scale, Math.min(s, fit, MAX_SCALE));
  }
  if (s === view.scale) {
    const x0 = r.x * s + view.tx;
    const y0 = r.y * s + view.ty;
    const inside = x0 >= vw * o.margin && y0 >= vh * o.margin && x0 + r.w * s <= vw * (1 - o.margin) && y0 + r.h * s <= vh * (1 - o.margin);
    if (inside) return null;
  }
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return { scale: s, tx: vw / 2 - cx * s, ty: vh / 2 - cy * s };
}
