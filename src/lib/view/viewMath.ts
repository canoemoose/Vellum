// Pure view maths: no DOM, no state. Everything here is unit-tested.
//
// Coordinate spaces
//   world  : PDF points (1/72 inch) in document layout space (pages stacked).
//   screen : CSS pixels relative to the viewport's top-left corner.
//   device : screen * devicePixelRatio (only the compositor cares).
//
// A view maps world to screen:  screen = world * scale + (tx, ty)

export interface View {
  /** CSS pixels per PDF point. */
  scale: number;
  tx: number;
  ty: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** CSS pixels per point at 100% ("actual size": 1 pt = 1/72 in, 96 CSS px per inch). */
export const PT_TO_CSS = 96 / 72;
export const MIN_ZOOM = 0.05; // 5%
export const MAX_ZOOM = 64; // 6400%
export const MIN_SCALE = MIN_ZOOM * PT_TO_CSS;
export const MAX_SCALE = MAX_ZOOM * PT_TO_CSS;

/** One mouse-wheel notch zooms by this factor (brief: 10–15%). */
export const WHEEL_NOTCH_FACTOR = 1.12;
/** Chromium reports 100 px of deltaY per notch for a standard wheel (deltaMode 0). */
export const PIXELS_PER_NOTCH = 100;

/** Zoom presets for the toolbar dropdown and preset stepping (1 = 100%). */
export const ZOOM_PRESETS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8, 16, 32, 64];

/**
 * The next preset above (dir 1) or below (dir -1) `zoom`, ignoring presets within 1% of
 * it; null past the ends.
 */
export function nextZoomPreset(zoom: number, dir: 1 | -1, presets: number[] = ZOOM_PRESETS): number | null {
  if (dir > 0) return presets.find((p) => p > zoom * 1.01) ?? null;
  for (let i = presets.length - 1; i >= 0; i--) if (presets[i] < zoom / 1.01) return presets[i];
  return null;
}

export function zoomToScale(zoom: number): number {
  return zoom * PT_TO_CSS;
}

export function scaleToZoom(scale: number): number {
  return scale / PT_TO_CSS;
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function worldToScreen(v: View, wx: number, wy: number): [number, number] {
  return [wx * v.scale + v.tx, wy * v.scale + v.ty];
}

export function screenToWorld(v: View, sx: number, sy: number): [number, number] {
  return [(sx - v.tx) / v.scale, (sy - v.ty) / v.scale];
}

/**
 * Change scale while keeping the world point under screen point (sx, sy) fixed.
 * The requested scale is clamped to the zoom range.
 */
export function zoomAt(v: View, sx: number, sy: number, newScale: number): View {
  const s = clampScale(newScale);
  const [wx, wy] = screenToWorld(v, sx, sy);
  return { scale: s, tx: sx - wx * s, ty: sy - wy * s };
}

export function zoomBy(v: View, sx: number, sy: number, factor: number): View {
  return zoomAt(v, sx, sy, v.scale * factor);
}

export function panBy(v: View, dx: number, dy: number): View {
  return { scale: v.scale, tx: v.tx + dx, ty: v.ty + dy };
}

/**
 * Zoom factor for a wheel event. Positive deltaY (wheel towards the user) zooms out.
 * Continuous: a 100 px notch gives exactly WHEEL_NOTCH_FACTOR, a 50 px high-resolution
 * step gives half of that in log space, and so on.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, perNotch = WHEEL_NOTCH_FACTOR): number {
  const px = deltaToPixels(deltaY, deltaMode);
  return Math.pow(perNotch, -px / PIXELS_PER_NOTCH);
}

/** Pinch gestures arrive as ctrl+wheel with small deltas; they want a faster response. */
export function pinchZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.01);
}

/** Normalise a WheelEvent delta to CSS pixels. */
export function deltaToPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * 40; // lines
  if (deltaMode === 2) return delta * 800; // pages
  return delta;
}

/**
 * Heuristic: does this wheel event come from a notched mouse wheel (zoom in CAD mode)
 * rather than a precision touchpad / free-spinning wheel (pan)?
 * Chromium on Windows reports notches as whole multiples of 100 (or of 100 * a system
 * wheel-scroll setting) on a single axis; touchpads produce small and/or fractional
 * deltas, often on both axes.
 */
export function isNotchedWheel(deltaX: number, deltaY: number, deltaMode: number): boolean {
  if (deltaMode !== 0) return true; // line/page mode only comes from real wheels
  if (deltaX !== 0) return false;
  const a = Math.abs(deltaY);
  if (a < 50) return false;
  // Chromium on Windows gives 100/3 px per "line" of the system wheel setting, so a notch
  // is a whole multiple of 33.33 px (100 at the default of 3 lines). Touchpad deltas are
  // whole pixels, so a fractional multiple of 33.33 can only be a wheel.
  const lines = (a * 3) / 100;
  if (Math.abs(lines - Math.round(lines)) < 1e-6) return true;
  // Otherwise notches are integers; touchpad deltas at fractional DPI scales usually aren't.
  return a % 1 === 0;
}

/** A smooth (touchpad) gesture is assumed to continue for this long after its last event. */
export const SMOOTH_GESTURE_GAP_MS = 150;

/**
 * Stateful wheel classification: judge the gesture, not the single event. A touchpad
 * scroll is a dense stream of events (a few ms apart) whose magnitudes ramp up from small
 * values, so a fast flick soon crosses the 50 px per-event threshold and would read as a
 * notch on its own. Once any event in a stream is smooth, the whole stream is smooth until
 * there has been a SMOOTH_GESTURE_GAP_MS pause. A mouse notch is an isolated event with a
 * fixed magnitude, so it is unaffected unless it lands inside a touchpad gesture.
 */
export class WheelClassifier {
  private smoothUntil = -Infinity;

  classify(deltaX: number, deltaY: number, deltaMode: number, now: number): "notch" | "smooth" {
    if (deltaMode !== 0) return "notch";
    if (now < this.smoothUntil || !isNotchedWheel(deltaX, deltaY, deltaMode)) {
      this.smoothUntil = now + SMOOTH_GESTURE_GAP_MS;
      return "smooth";
    }
    return "notch";
  }
}

export type FitMode = "page" | "width";

/**
 * View that fits `rect` (world) into a viewport of vw x vh CSS pixels with `pad` pixels
 * of breathing room. "page" fits the whole rect, centred. "width" fits the width and
 * aligns the rect's top with the top padding.
 */
export function fitRect(rect: Rect, vw: number, vh: number, pad: number, mode: FitMode): View {
  const aw = Math.max(1, vw - 2 * pad);
  const ah = Math.max(1, vh - 2 * pad);
  const sx = aw / rect.w;
  const sy = ah / rect.h;
  const scale = clampScale(mode === "page" ? Math.min(sx, sy) : sx);
  const tx = vw / 2 - (rect.x + rect.w / 2) * scale;
  const ty =
    mode === "page" ? vh / 2 - (rect.y + rect.h / 2) * scale : pad - rect.y * scale;
  return { scale, tx, ty };
}

/**
 * Keep the document on screen, axis by axis. Where it's smaller than the view (less a `pad`
 * margin each side) it stays wholly in view, free to move within it; where it's larger, its
 * edges can't come further in than the margin, so no page (or the document's end) can be
 * scrolled off leaving an empty view.
 */
export function constrainView(v: View, bounds: Rect, vw: number, vh: number, pad = 16): View {
  const axis = (start: number, len: number, view: number): number => {
    const lo = Math.min(pad, view - pad - len);
    const hi = Math.max(pad, view - pad - len);
    return Math.min(hi, Math.max(lo, start)) - start;
  };
  const dx = axis(bounds.x * v.scale + v.tx, bounds.w * v.scale, vw);
  const dy = axis(bounds.y * v.scale + v.ty, bounds.h * v.scale, vh);
  return dx === 0 && dy === 0 ? v : { scale: v.scale, tx: v.tx + dx, ty: v.ty + dy };
}

/** Visible world rectangle for a viewport of vw x vh CSS pixels. */
export function visibleWorldRect(v: View, vw: number, vh: number): Rect {
  const [x0, y0] = screenToWorld(v, 0, 0);
  return { x: x0, y: y0, w: vw / v.scale, h: vh / v.scale };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Exponential approach of `current` towards `target` in log space, frame-rate
 * independent. `tau` is the time constant in ms. Used for smooth wheel zoom.
 */
export function approachScale(current: number, target: number, dtMs: number, tau = 45): number {
  const k = 1 - Math.exp(-dtMs / tau);
  const next = Math.exp(Math.log(current) + (Math.log(target) - Math.log(current)) * k);
  return Math.abs(Math.log(target / next)) < 1e-3 ? target : next;
}

// ---------------------------------------------------------------- eased view changes

/** Ease-out cubic on 0..1: quick to start, gentle to land. */
export function easeOutCubic(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return 1 - (1 - u) ** 3;
}

/**
 * The view part way (`e`, 0..1) from `a` to `b`: the world point at the viewport centre
 * moves in a straight line and the scale changes geometrically, so a zoom feels even at
 * every size and nothing swings off sideways.
 */
export function interpolateView(a: View, b: View, e: number, vw: number, vh: number): View {
  if (e <= 0) return a;
  if (e >= 1) return b;
  const [ax, ay] = screenToWorld(a, vw / 2, vh / 2);
  const [bx, by] = screenToWorld(b, vw / 2, vh / 2);
  const scale = Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * e);
  const cx = ax + (bx - ax) * e;
  const cy = ay + (by - ay) * e;
  return { scale, tx: vw / 2 - cx * scale, ty: vh / 2 - cy * scale };
}

/**
 * How far (CSS px) anything on screen still has to move to get from view `v` to view `f`:
 * the largest displacement of the world points under the viewport's four corners. For a
 * zoom or a pan the corners move most, so this bounds every point in the view.
 */
export function remainingMove(v: View, f: View, vw: number, vh: number): number {
  let m = 0;
  for (const [sx, sy] of [[0, 0], [vw, 0], [0, vh], [vw, vh]]) {
    const [wx, wy] = screenToWorld(v, sx, sy);
    const [fx, fy] = worldToScreen(f, wx, wy);
    m = Math.max(m, Math.hypot(fx - sx, fy - sy));
  }
  return m;
}

/**
 * Fit the page's width, keeping the point at the vertical centre of the view where it is
 * (so fitting width doesn't jump to the top), unless that point isn't on the page: then the
 * page's top, as `fitRect` does.
 */
export function fitWidthKeepingY(rect: Rect, current: View, vw: number, vh: number, pad: number): View {
  const fit = fitRect(rect, vw, vh, pad, "width");
  const [, wy] = screenToWorld(current, vw / 2, vh / 2);
  if (wy < rect.y || wy > rect.y + rect.h) return fit;
  return { scale: fit.scale, tx: fit.tx, ty: vh / 2 - wy * fit.scale };
}

/** After the viewport changes size, keep the world point at its centre at the new centre. */
export function keepCentre(v: View, oldW: number, oldH: number, newW: number, newH: number): View {
  return { scale: v.scale, tx: v.tx + (newW - oldW) / 2, ty: v.ty + (newH - oldH) / 2 };
}

/**
 * Where a zoom from `from` towards `to` should stop: at the first of `stops` it crosses
 * (sticky zoom at 100%, fit width and fit page), or `to` if it crosses none. A stop the zoom
 * starts on (within 0.5%) doesn't hold it, so the next notch carries on past.
 */
export function stickyZoomTarget(from: number, to: number, stops: number[]): number {
  if (to === from) return to;
  const up = to > from;
  let best = to;
  for (const s of stops) {
    if (!(s > 0) || Math.abs(Math.log(s / from)) < 0.005) continue;
    const between = up ? s > from && s < to : s < from && s > to;
    if (between && (up ? s < best : s > best)) best = s;
  }
  return best;
}

/**
 * Whether the page fits in the viewport at the current zoom (the viewport, in the page's
 * points as Viewer.viewportOnPage gives it, is at least as big as the page both ways),
 * wherever it's scrolled to. The mini map shows only when it doesn't: it's for finding your
 * way round a page you're zoomed into, and judging by size, not position, keeps it from
 * flickering on and off while you scroll from page to page at fit.
 */
export function pageFitsView(viewport: Rect | null, pageW: number, pageH: number): boolean {
  if (!viewport) return false;
  const e = 0.5; // half a point of slack for rounding
  return viewport.w >= pageW - e && viewport.h >= pageH - e;
}

/** The smallest rect containing all of `rects`; null for none. */
export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The rect part way (`e`, 0..1) from `a` to `b`, edges moving in straight lines. */
export function lerpRect(a: Rect, b: Rect, e: number): Rect {
  const t = Math.min(1, Math.max(0, e));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };
}

/**
 * Whether the mini map has something to say: a page in view (world rects) is cut off at the
 * view's left or right (zoomed in, or where columns meet), or, when `tallCounts` (CAD
 * navigation), is taller than the view (inside a long drawing like the aerial one at fit
 * width, its top and bottom included). In Document navigation a tall page is just reading
 * down a document at fit width, where the map would only be in the way. A page no taller than
 * the view, cut only by scrolling from page to page, says nothing the window and the
 * thumbnails don't. Half a point of slack.
 */
export function mapUseful(view: Rect, pages: Rect[], tallCounts = true): boolean {
  const e = 0.5;
  return pages.some((r) => r.x < view.x - e || r.x + r.w > view.x + view.w + e || (tallCounts && r.h > view.h + e));
}

/** Mini map shape limits (width / height) and its drawing width at default size, CSS px. */
export const MAP_MIN_ASPECT = 1 / 6;
export const MAP_MAX_ASPECT = 6;
export const MAP_WIDTH = 136;

/**
 * What the mini map frames: `pages` (the union of the pages in view), unless that's longer
 * than MAP_MIN_ASPECT..MAP_MAX_ASPECT allows, when it's a window of the limit's shape onto
 * it, the page's full width (or height), centred on the view and kept inside the pages.
 */
export function mapFraming(pages: Rect, view: Rect): Rect {
  const a = pages.w / pages.h;
  if (a < MAP_MIN_ASPECT) {
    const h = pages.w / MAP_MIN_ASPECT;
    const cy = view.y + view.h / 2;
    const y = Math.min(pages.y + pages.h - h, Math.max(pages.y, cy - h / 2));
    return { x: pages.x, y, w: pages.w, h };
  }
  if (a > MAP_MAX_ASPECT) {
    const w = pages.h * MAP_MAX_ASPECT;
    const cx = view.x + view.w / 2;
    const x = Math.min(pages.x + pages.w - w, Math.max(pages.x, cx - w / 2));
    return { x, y: pages.y, w, h: pages.h };
  }
  return pages;
}

/** The mini map's size, as a multiple of its default width (MAP_WIDTH), that the user can set. */
export const MAP_SIZE_MIN = 0.6;
/** Large enough to reach any screen's width; the drawing area limits it in practice (mapLimits). */
export const MAP_SIZE_MAX = 20;
/** Space kept between the mini map and the drawing area's edges, each side, CSS px. */
export const MAP_GUTTER = 16;
/** The map's padding and border round its drawing area, both sides together, CSS px. */
export const MAP_FRAME = 14;

/**
 * The largest size that keeps a map of aspect `a` within the guards: 60% of the drawing area
 * (`stageW` x `stageH`) both ways. Sizes beyond this are a temporary blow-up: only this much
 * is remembered. `turned`: the view is a quarter turn round (see mapBox).
 */
export function mapGuardSize(stageW: number, stageH: number, a: number, turned = false): number {
  if (turned) return mapGuardSize(stageH, stageW, 1 / a);
  const s = Math.min(MAP_MAX_ASPECT, Math.max(MAP_MIN_ASPECT, a));
  const w = Math.min(stageW * 0.6 - MAP_FRAME, (stageH * 0.6 - MAP_FRAME) * s);
  return Math.max(MAP_SIZE_MIN, w / MAP_WIDTH);
}

/**
 * The most room the mini map's drawing area may take in a drawing area `stageW` x `stageH`:
 * 60% of it at default size, growing with the size the user sets, up to the whole drawing
 * area less the gutters. Also the largest size the grip may set for a framing of aspect `a`
 * (beyond it the map can't grow, so the grip stops rather than run on unseen).
 */
export function mapLimits(
  stageW: number,
  stageH: number,
  size: number,
  a: number,
  turned = false,
): { maxW: number; maxH: number; maxSize: number } {
  if (turned) {
    const r = mapLimits(stageH, stageW, size, 1 / a);
    return { maxW: r.maxH, maxH: r.maxW, maxSize: r.maxSize };
  }
  const fullW = Math.max(1, stageW - 2 * MAP_GUTTER - MAP_FRAME);
  const fullH = Math.max(1, stageH - 2 * MAP_GUTTER - MAP_FRAME);
  const frac = 0.6 * Math.max(1, size);
  const maxW = Math.min(fullW, stageW * frac - MAP_FRAME);
  const maxH = Math.min(fullH, stageH * frac - MAP_FRAME);
  const s = Math.min(MAP_MAX_ASPECT, Math.max(MAP_MIN_ASPECT, a));
  const maxSize = Math.max(MAP_SIZE_MIN, Math.min(fullW, fullH * s) / MAP_WIDTH);
  return { maxW, maxH, maxSize };
}

/**
 * The mini map's drawing area for a framing of aspect `a` (width / height): MAP_WIDTH times
 * `size` wide, as tall as that shape makes it, shrunk evenly if need be to fit within
 * `maxW` x `maxH` (so a tall or enlarged map never outgrows the window). `turned`: the view is
 * a quarter turn round, so the map turns with it: the fixed side follows the page's own width,
 * which is now upright, and width and height swap rather than the map changing size.
 */
export function mapBox(a: number, size = 1, maxW = Infinity, maxH = Infinity, turned = false): { w: number; h: number } {
  if (turned) {
    const b = mapBox(1 / a, size, maxH, maxW);
    return { w: b.h, h: b.w };
  }
  const s = Math.min(MAP_MAX_ASPECT, Math.max(MAP_MIN_ASPECT, a));
  let w = MAP_WIDTH * size;
  let h = w / s;
  const k = Math.min(1, maxW / w, maxH / h);
  w *= k;
  h *= k;
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}
