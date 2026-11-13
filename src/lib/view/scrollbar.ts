// Canvas scrollbars (Document navigation): where the thumb sits on one axis, and how a drag
// along the track maps back to the document. Pure, so it's tested.

/** The scrollable range on one axis: the document, widened to include the view (the margins
 * around a fitted page are part of what can be scrolled). */
function range(viewStart: number, viewLen: number, docStart: number, docLen: number): [number, number] {
  const a = Math.min(docStart, viewStart);
  const b = Math.max(docStart + docLen, viewStart + viewLen);
  return [a, b - a];
}

/** Whether there's anything to scroll on this axis (the view doesn't already show it all). */
export function canScroll(viewStart: number, viewLen: number, docStart: number, docLen: number): boolean {
  const [, len] = range(viewStart, viewLen, docStart, docLen);
  return len - viewLen > 0.5;
}

/**
 * The thumb on a track `track` px long: its start and length in px. Length is the view's
 * share of the range (at least `min` px); position is how far through the range the view is.
 */
export function thumb(viewStart: number, viewLen: number, docStart: number, docLen: number, track: number, min = 24): { pos: number; len: number } {
  const [a, len] = range(viewStart, viewLen, docStart, docLen);
  const tl = Math.min(track, Math.max(min, (track * viewLen) / len));
  const free = len - viewLen;
  const pos = free > 0 ? ((viewStart - a) / free) * (track - tl) : 0;
  return { pos, len: tl };
}

/** Document units moved per px of thumb drag on a track `track` px long. */
export function dragRatio(viewStart: number, viewLen: number, docStart: number, docLen: number, track: number, min = 24): number {
  const [, len] = range(viewStart, viewLen, docStart, docLen);
  const { len: tl } = thumb(viewStart, viewLen, docStart, docLen, track, min);
  const room = track - tl;
  return room > 0 ? (len - viewLen) / room : 0;
}
