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
 * Keep at least `keep` CSS pixels of the document bounds visible, so the drawing can
 * never be panned completely out of sight. Free panning otherwise (CAD style).
 */
export function constrainView(v: View, bounds: Rect, vw: number, vh: number, keep = 64): View {
  const left = bounds.x * v.scale + v.tx;
  const right = (bounds.x + bounds.w) * v.scale + v.tx;
  const top = bounds.y * v.scale + v.ty;
  const bottom = (bounds.y + bounds.h) * v.scale + v.ty;
  let { tx, ty } = v;
  const kx = Math.min(keep, (right - left) / 2);
  const ky = Math.min(keep, (bottom - top) / 2);
  if (right < kx) tx += kx - right;
  if (left > vw - kx) tx -= left - (vw - kx);
  if (bottom < ky) ty += ky - bottom;
  if (top > vh - ky) ty -= top - (vh - ky);
  return tx === v.tx && ty === v.ty ? v : { scale: v.scale, tx, ty };
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
