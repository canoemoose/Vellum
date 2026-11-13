// The size of the small picture of a tab's view kept when the tab goes to the background
// (shown in the tab's hover card, like Chrome's tab previews).

/** The picture's longer side, device px: the card draws it about 260 CSS px wide, so this is
 * sharp up to 200% display scaling. */
export const SNAPSHOT_MAX_SIDE = 520;

/**
 * The size to shrink a `w` x `h` canvas to so its longer side is at most `maxSide`, keeping the
 * aspect ratio and never enlarging it. Null when there's nothing to picture.
 */
export function snapshotSize(w: number, h: number, maxSide = SNAPSHOT_MAX_SIDE): { w: number; h: number } | null {
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
