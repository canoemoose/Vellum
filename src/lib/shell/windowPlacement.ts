// Window size and position restore, kept on screen. All figures are physical pixels, as
// Tauri reports monitors and window positions.

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlap(a: Bounds, b: Bounds): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Fit saved window bounds onto the screen: pick the work area the window overlaps most (the
 * first, normally the primary, if it overlaps none, e.g. a monitor that has since been
 * unplugged), shrink the window to fit it, then move it inside. Returns null when there's
 * nothing to restore or no monitors are known.
 */
export function placeOnScreen(saved: Bounds | null, workAreas: Bounds[], minW = 720, minH = 480): Bounds | null {
  if (!saved || !workAreas.length) return null;
  if (![saved.x, saved.y, saved.w, saved.h].every(Number.isFinite) || saved.w <= 0 || saved.h <= 0) return null;
  let best = workAreas[0];
  let bestArea = 0;
  for (const a of workAreas) {
    const o = overlap(saved, a);
    if (o > bestArea) {
      best = a;
      bestArea = o;
    }
  }
  const w = Math.max(Math.min(saved.w, best.w), Math.min(minW, best.w));
  const h = Math.max(Math.min(saved.h, best.h), Math.min(minH, best.h));
  let x = saved.x;
  let y = saved.y;
  if (bestArea === 0) {
    x = best.x + Math.round((best.w - w) / 2);
    y = best.y + Math.round((best.h - h) / 2);
  }
  x = Math.min(Math.max(x, best.x), best.x + best.w - w);
  y = Math.min(Math.max(y, best.y), best.y + best.h - h);
  return { x, y, w, h };
}
