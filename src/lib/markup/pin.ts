// Markups drawn a fixed size on screen whatever the zoom (a note's icon, as other apps draw
// notes). Their drawing is in page points at the size it has when one point is one CSS pixel;
// the painter scales it about its pin (PathOp.pin) and records the scale here, so hit-testing
// and selection grips use the size the icon was last drawn at. Pure apart from that record.

/** Page points per CSS pixel at the last paint (1 until something pinned is painted). */
export const pinView = { ptPerPx: 1 };

/**
 * The scale that draws pinned operations one point to one CSS pixel, under canvas transform
 * `m` (page points to device pixels); recorded in pinView.
 */
export function pinScale(m: readonly number[], dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio || 1): number {
  const devPerPt = Math.hypot(m[0], m[1]);
  const k = devPerPt > 0 ? dpr / devPerPt : 1;
  pinView.ptPerPx = k;
  return k;
}

/** A length in a pinned drawing's points, as page points at the last paint's zoom. */
export const pinned = (v: number): number => v * pinView.ptPerPx;
