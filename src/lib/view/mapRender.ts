// When the mini map should ask for a sharper image of a page than the one it has, and at what
// size. The map starts from the viewer's low-resolution previews; drawn bigger than those, it
// asks for a proper render (viewer.thumbnail) at the size it's actually drawing.

/** Never ask for more pixels than this in all, device px (a 2048 px square). Capping the area
 * rather than the long side lets a long, thin page (the aerial drawing, 1:19) be as long as the
 * map draws it while still stopping a large square page running away. */
export const MAP_RENDER_MAX_AREA = 2048 * 2048;
/** Never ask for more than this along a page's longer side, device px, whatever the area. */
export const MAP_RENDER_MAX_SIDE = 8192;
/** Sizes are rounded up to this step, so small resizes don't each trigger a new render. */
export const MAP_RENDER_STEP = 64;
/** Only re-render when the wanted size is this much bigger than what's held. */
export const MAP_RENDER_SLACK = 1.15;

/**
 * The longer side, in device px, to render a page at so it's sharp when drawn `w` x `h` device
 * px on the map (the whole page, even where the map shows only a window onto it). Rounded up to
 * the step, then capped by area and by side; 0 for nothing visible.
 */
export function mapRenderSide(w: number, h: number): number {
  const long = Math.max(Math.abs(w), Math.abs(h));
  const short = Math.min(Math.abs(w), Math.abs(h));
  if (!Number.isFinite(long) || long <= 0) return 0;
  let side = Math.ceil(long / MAP_RENDER_STEP) * MAP_RENDER_STEP;
  const ratio = short / long; // the page's short side per unit of long side
  if (ratio > 0) {
    const byArea = Math.floor(Math.sqrt(MAP_RENDER_MAX_AREA / ratio) / MAP_RENDER_STEP) * MAP_RENDER_STEP;
    side = Math.min(side, Math.max(MAP_RENDER_STEP, byArea));
  }
  return Math.min(side, MAP_RENDER_MAX_SIDE);
}

/** Whether an image `have` px along its longer side is too small for `want`. Never downgrades. */
export function needsSharper(have: number, want: number): boolean {
  return want > 0 && want > have * MAP_RENDER_SLACK;
}
