// Framing a photo before the paper is knocked out: quarter turns, straightening and a crop,
// chosen on a preview and applied in Rust (`import::Adjust`, src-tauri/src/signature/import.rs).
// The maths for the framing view, pure so it's tested.
//
// The frame is the photo after its quarter turns (its width and height swap on odd turns).
// Straightening turns the photo about the frame's centre without changing the frame. The crop is
// in fractions of the frame, so it means the same on the preview and on the full-size photo.

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Adjust {
  /** Quarter turns clockwise, 0 to 3. */
  turns: number;
  /** Straightening in degrees clockwise, -45 to 45. */
  angle: number;
  /** The part to keep, in fractions of the frame. */
  crop: Crop;
}

export const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };
export const MAX_ANGLE = 45;

export function initialAdjust(): Adjust {
  return { turns: 0, angle: 0, crop: { ...FULL } };
}

export interface Size {
  w: number;
  h: number;
}

/** The frame's size for a picture `w` x `h` after `turns` quarter turns. */
export function frameSize(w: number, h: number, turns: number): Size {
  return turns % 2 ? { w: h, h: w } : { w, h };
}

/**
 * A quarter turn (`dir` 1 clockwise, -1 anticlockwise). The crop turns with the picture, so it
 * still holds the same part of it; the straightening angle is unchanged.
 */
export function turn(a: Adjust, dir: 1 | -1): Adjust {
  const { x, y, w, h } = a.crop;
  const crop = dir === 1 ? { x: 1 - y - h, y: x, w: h, h: w } : { x: y, y: 1 - x - w, w: h, h: w };
  return { turns: (((a.turns + dir) % 4) + 4) % 4, angle: a.angle, crop };
}

export function clampAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, deg));
}

/** Which part of the crop a pointer grabbed: a corner, an edge, or the middle (to move it). */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

/**
 * Resize or move a crop by (dx, dy), in fractions of the frame, from where the drag started.
 * It stays inside the frame and no smaller than `min` (fractions); a moved crop keeps its size.
 */
export function dragCrop(start: Crop, handle: Handle, dx: number, dy: number, min: Size): Crop {
  if (handle === "move") {
    return {
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
      w: start.w,
      h: start.h,
    };
  }
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.w;
  let y1 = start.y + start.h;
  if (handle.includes("w")) x0 = clamp(x0 + dx, 0, x1 - min.w);
  if (handle.includes("e")) x1 = clamp(x1 + dx, x0 + min.w, 1);
  if (handle.includes("n")) y0 = clamp(y0 + dy, 0, y1 - min.h);
  if (handle.includes("s")) y1 = clamp(y1 + dy, y0 + min.h, 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A new crop drawn from point a to point b (fractions of the frame, either way round). */
export function cropBetween(a: { x: number; y: number }, b: { x: number; y: number }, min: Size): Crop {
  let x0 = clamp(Math.min(a.x, b.x), 0, 1);
  let y0 = clamp(Math.min(a.y, b.y), 0, 1);
  let x1 = clamp(Math.max(a.x, b.x), 0, 1);
  let y1 = clamp(Math.max(a.y, b.y), 0, 1);
  // Grow a too-small box away from where the drag started, staying in the frame.
  if (x1 - x0 < min.w) {
    if (b.x >= a.x) x1 = Math.min(1, x0 + min.w);
    else x0 = Math.max(0, x1 - min.w);
    if (x1 - x0 < min.w) [x0, x1] = x0 === 0 ? [0, min.w] : [1 - min.w, 1];
  }
  if (y1 - y0 < min.h) {
    if (b.y >= a.y) y1 = Math.min(1, y0 + min.h);
    else y0 = Math.max(0, y1 - min.h);
    if (y1 - y0 < min.h) [y0, y1] = y0 === 0 ? [0, min.h] : [1 - min.h, 1];
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Whether the crop is the whole frame (nothing to send). */
export function isFull(c: Crop): boolean {
  const eps = 1e-6;
  return c.x < eps && c.y < eps && c.w > 1 - eps && c.h > 1 - eps;
}

/** What the import command takes: the crop left out when it's the whole frame. */
export function toCommand(a: Adjust): { turns: number; angle: number; crop: Crop | null } {
  return { turns: a.turns, angle: clampAngle(a.angle), crop: isFull(a.crop) ? null : a.crop };
}

// ---- The view: frame pixels to screen pixels, screen = frame * scale + (x, y). ----

export interface View {
  scale: number;
  x: number;
  y: number;
}

/** The view that fits the frame in a box `box` with `pad` pixels round it, centred. */
export function fitView(frame: Size, box: Size, pad: number): View {
  const scale = Math.max(1e-6, Math.min((box.w - 2 * pad) / frame.w, (box.h - 2 * pad) / frame.h));
  return { scale, x: (box.w - frame.w * scale) / 2, y: (box.h - frame.h * scale) / 2 };
}

/** Zoom by `factor` keeping the screen point `at` still, the scale kept within [min, max]. */
export function zoomAt(v: View, factor: number, at: { x: number; y: number }, min: number, max: number): View {
  const scale = clamp(v.scale * factor, min, max);
  const k = scale / v.scale;
  return { scale, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k };
}

/** A screen point in fractions of the frame. */
export function screenToFrame(v: View, frame: Size, p: { x: number; y: number }): { x: number; y: number } {
  return { x: (p.x - v.x) / v.scale / frame.w, y: (p.y - v.y) / v.scale / frame.h };
}

/** The crop's rectangle on screen. */
export function cropOnScreen(v: View, frame: Size, c: Crop): { x: number; y: number; w: number; h: number } {
  return {
    x: v.x + c.x * frame.w * v.scale,
    y: v.y + c.y * frame.h * v.scale,
    w: c.w * frame.w * v.scale,
    h: c.h * frame.h * v.scale,
  };
}

/**
 * What a screen point grabs on a crop drawn at `r` (screen pixels): a corner or edge within
 * `tol` pixels, the middle, or nothing (outside it).
 */
export function hitCrop(r: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }, tol: number): Handle | null {
  const nearL = Math.abs(p.x - r.x) <= tol;
  const nearR = Math.abs(p.x - (r.x + r.w)) <= tol;
  const nearT = Math.abs(p.y - r.y) <= tol;
  const nearB = Math.abs(p.y - (r.y + r.h)) <= tol;
  const inX = p.x >= r.x - tol && p.x <= r.x + r.w + tol;
  const inY = p.y >= r.y - tol && p.y <= r.y + r.h + tol;
  if (!inX || !inY) return null;
  const v = nearT ? "n" : nearB ? "s" : "";
  const h = nearL ? "w" : nearR ? "e" : "";
  if (v || h) return (v + h) as Handle;
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h ? "move" : null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
