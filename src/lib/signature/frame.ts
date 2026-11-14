// Framing a photo before the paper is knocked out: quarter turns and a crop box, which may be
// turned to lie along a slanted signature. Chosen on a preview and applied in Rust
// (`import::Adjust`, src-tauri/src/signature/import.rs). The maths for the framing view, pure
// so it's tested.
//
// The frame is the photo after its quarter turns (its width and height swap on odd turns). The
// crop is the box before it's turned, in fractions of the frame, so it means the same on the
// preview and on the full-size photo; the angle turns it about its own centre. While dragging,
// the box is handled in frame pixels (`Box`), where turning keeps right angles.

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Adjust {
  /** Quarter turns clockwise, 0 to 3. */
  turns: number;
  /** The crop box's turn in degrees clockwise about its centre, -180 to 180. */
  angle: number;
  /** The box before it's turned, in fractions of the frame. */
  crop: Crop;
}

export const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

export function initialAdjust(): Adjust {
  return { turns: 0, angle: 0, crop: { ...FULL } };
}

export interface Size {
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** A rectangle, level. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The crop box in frame pixels: its centre and its sides before it's turned. */
export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** The frame's size for a picture `w` x `h` after `turns` quarter turns. */
export function frameSize(w: number, h: number, turns: number): Size {
  return turns % 2 ? { w: h, h: w } : { w, h };
}

/**
 * A quarter turn (`dir` 1 clockwise, -1 anticlockwise). The box turns with the picture, so it
 * still holds the same part of it; its own angle is unchanged (it swaps its sides instead).
 */
export function turn(a: Adjust, dir: 1 | -1): Adjust {
  const { x, y, w, h } = a.crop;
  const crop = dir === 1 ? { x: 1 - y - h, y: x, w: h, h: w } : { x: y, y: 1 - x - w, w: h, h: w };
  return { turns: (((a.turns + dir) % 4) + 4) % 4, angle: a.angle, crop };
}

/** An angle in degrees brought into (-180, 180]; anything not a number is level. */
export function normAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const a = ((deg % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

/** Whether the box is level (then it's kept inside the frame). */
export function isLevel(angle: number): boolean {
  return Math.abs(angle) < 1e-3;
}

/** A point turned `deg` clockwise about the origin (y down, as on screen). */
export function rotate(p: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function toBox(c: Crop, f: Size): Box {
  return { cx: (c.x + c.w / 2) * f.w, cy: (c.y + c.h / 2) * f.h, w: c.w * f.w, h: c.h * f.h };
}

export function toCrop(b: Box, f: Size): Crop {
  return { x: (b.cx - b.w / 2) / f.w, y: (b.cy - b.h / 2) / f.h, w: b.w / f.w, h: b.h / f.h };
}

/** The box's corners, turned: top left, top right, bottom right, bottom left (of the box). */
export function corners(b: Box, angle: number): Pt[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const d = rotate({ x: (sx * b.w) / 2, y: (sy * b.h) / 2 }, angle);
    return { x: b.cx + d.x, y: b.cy + d.y };
  });
}

/** The level rectangle round some points. */
export function bounds(points: Pt[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Which part of the box a pointer grabbed: a corner, an edge, or the middle (to move it). */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

/**
 * Resize or move the box by `d` (frame pixels) from where the drag started. Corners and edges
 * move along the box's own sides, the opposite side staying put, and no side gets shorter than
 * `min`. Level, the box stays inside the frame. Turned, it may stick out (what's beyond the
 * photo is paper), but its centre stays on the photo and its sides within twice the frame's.
 */
export function dragBox(start: Box, angle: number, handle: Handle, d: Pt, min: number, f: Size): Box {
  if (handle === "move") {
    const b = { ...start, cx: start.cx + d.x, cy: start.cy + d.y };
    if (isLevel(angle)) {
      b.cx = clamp(b.cx, b.w / 2, f.w - b.w / 2);
      b.cy = clamp(b.cy, b.h / 2, f.h - b.h / 2);
      return b;
    }
    return keepCentre(b, f);
  }
  // Along the box's sides, from its centre.
  const l = rotate(d, -angle);
  let x0 = -start.w / 2;
  let x1 = start.w / 2;
  let y0 = -start.h / 2;
  let y1 = start.h / 2;
  const level = isLevel(angle);
  // Level, the frame's edges in the same terms.
  const fx0 = level ? -start.cx : -Infinity;
  const fx1 = level ? f.w - start.cx : Infinity;
  const fy0 = level ? -start.cy : -Infinity;
  const fy1 = level ? f.h - start.cy : Infinity;
  const mw = level ? Math.min(min, f.w) : min;
  const mh = level ? Math.min(min, f.h) : min;
  if (handle.includes("w")) x0 = clamp(x0 + l.x, Math.max(fx0, x1 - 2 * f.w), x1 - mw);
  if (handle.includes("e")) x1 = clamp(x1 + l.x, x0 + mw, Math.min(fx1, x0 + 2 * f.w));
  if (handle.includes("n")) y0 = clamp(y0 + l.y, Math.max(fy0, y1 - 2 * f.h), y1 - mh);
  if (handle.includes("s")) y1 = clamp(y1 + l.y, y0 + mh, Math.min(fy1, y0 + 2 * f.h));
  const c = rotate({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, angle);
  const b = { cx: start.cx + c.x, cy: start.cy + c.y, w: x1 - x0, h: y1 - y0 };
  return level ? b : keepCentre(b, f);
}

/**
 * A new box drawn from frame point `a` to `b`, either way round, lying at `angle` (the box's
 * current turn, so drawing a new one doesn't undo it). A click with no drag makes a box `min`
 * square from where it started. Level, it's kept inside the frame.
 */
export function boxBetween(a: Pt, b: Pt, angle: number, min: number, f: Size): Box {
  const level = isLevel(angle);
  if (level) {
    a = { x: clamp(a.x, 0, f.w), y: clamp(a.y, 0, f.h) };
    b = { x: clamp(b.x, 0, f.w), y: clamp(b.y, 0, f.h) };
  }
  // In the box's own directions.
  const p = rotate(a, -angle);
  const q = rotate(b, -angle);
  let x0 = Math.min(p.x, q.x);
  let x1 = Math.max(p.x, q.x);
  let y0 = Math.min(p.y, q.y);
  let y1 = Math.max(p.y, q.y);
  // Grow a too-small box away from where the drag started.
  if (x1 - x0 < min) [x0, x1] = q.x >= p.x ? [p.x, p.x + min] : [p.x - min, p.x];
  if (y1 - y0 < min) [y0, y1] = q.y >= p.y ? [p.y, p.y + min] : [p.y - min, p.y];
  const c = rotate({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, angle);
  const box = { cx: c.x, cy: c.y, w: x1 - x0, h: y1 - y0 };
  if (!level) return keepCentre(box, f);
  // Level: no room to grow forwards at the frame's edge, so shift back inside.
  box.w = Math.min(box.w, f.w);
  box.h = Math.min(box.h, f.h);
  box.cx = clamp(box.cx, box.w / 2, f.w - box.w / 2);
  box.cy = clamp(box.cy, box.h / 2, f.h - box.h / 2);
  return box;
}

function keepCentre(b: Box, f: Size): Box {
  return { ...b, cx: clamp(b.cx, 0, f.w), cy: clamp(b.cy, 0, f.h) };
}

/** Whether the crop is the whole frame (nothing to send). */
export function isFull(c: Crop): boolean {
  const eps = 1e-6;
  return Math.abs(c.x) < eps && Math.abs(c.y) < eps && Math.abs(c.w - 1) < eps && Math.abs(c.h - 1) < eps;
}

/** What the import command takes: the crop left out when it's the whole frame. */
export function toCommand(a: Adjust): { turns: number; angle: number; crop: Crop | null } {
  return { turns: a.turns, angle: normAngle(a.angle), crop: isFull(a.crop) ? null : a.crop };
}

// ---- The view: frame pixels to screen pixels, screen = rotate(frame, rot) * scale + (x, y). ----
// The view turns too: settled on a turned box, it turns the other way so the box is level on
// screen and the photo lies tilted under it.

export interface View {
  scale: number;
  /** The view's turn, degrees clockwise. */
  rot: number;
  x: number;
  y: number;
}

/** The view with frame point `p` at the stage's centre. */
function centredOn(p: Pt, scale: number, rot: number, stage: Size): View {
  const q = rotate(p, rot);
  return { scale, rot, x: stage.w / 2 - q.x * scale, y: stage.h / 2 - q.y * scale };
}

/** The view that fits the frame, turned `rot`, in the stage with `pad` pixels round it, centred. */
export function fitView(frame: Size, stage: Size, pad: number, rot = 0): View {
  const b = bounds(corners({ cx: 0, cy: 0, w: frame.w, h: frame.h }, rot));
  const scale = Math.max(1e-6, Math.min((stage.w - 2 * pad) / b.w, (stage.h - 2 * pad) / b.h));
  return centredOn({ x: frame.w / 2, y: frame.h / 2 }, scale, rot, stage);
}

/**
 * The view to settle on once the box is placed: turned so the box is level, the box centred
 * and filling `fill` of the stage, so there's room round it to see the photo and drag it
 * bigger. Never further out than the whole photo fitted (at that turn), nor in past `maxScale`.
 */
export function settleView(frame: Size, box: Box, angle: number, stage: Size, pad: number, fill: number, maxScale: number): View {
  const rot = normAngle(-angle);
  const whole = fitView(frame, stage, pad, rot);
  const want = Math.min(((stage.w - 2 * pad) * fill) / box.w, ((stage.h - 2 * pad) * fill) / box.h);
  const scale = Math.min(want, Math.max(whole.scale, maxScale));
  if (!(scale > whole.scale)) return whole;
  return centredOn({ x: box.cx, y: box.cy }, scale, rot, stage);
}

/**
 * Part way (`t`, 0 to 1) from one view to another: zooming evenly, turning the short way round,
 * and the frame point at the stage's centre moving in a straight line.
 */
export function between(a: View, b: View, t: number, stage: Size): View {
  const scale = a.scale * Math.pow(b.scale / a.scale, t);
  const rot = a.rot + normAngle(b.rot - a.rot) * t;
  const mid = { x: stage.w / 2, y: stage.h / 2 };
  const ca = toFrame(a, mid);
  const cb = toFrame(b, mid);
  return centredOn({ x: ca.x + (cb.x - ca.x) * t, y: ca.y + (cb.y - ca.y) * t }, scale, rot, stage);
}

/** How far the rotate handle sits above the box's top edge, in screen pixels. */
export const KNOB_GAP = 28;
/** Within this many degrees of level (or of a quarter turn), the rotate handle snaps to it. */
export const SNAP = 2;

/** Where the rotate handle is drawn: on a stalk out from the middle of the box's top edge. */
export function knobAt(v: View, b: Box, angle: number): Pt {
  const c = toScreen(v, { x: b.cx, y: b.cy });
  const d = rotate({ x: 0, y: -((b.h * v.scale) / 2 + KNOB_GAP) }, angle + v.rot);
  return { x: c.x + d.x, y: c.y + d.y };
}

/**
 * The box's angle while the rotate handle is dragged from `from` to `to` (screen points) about
 * the box's centre `c` (on screen), starting at `start` degrees: turned as far as the pointer has
 * gone round the centre, to a tenth of a degree, any way round. Within `SNAP` degrees of level
 * or of a quarter turn it snaps there, unless `snap` is false (Alt held).
 */
export function angleByDrag(start: number, c: Pt, from: Pt, to: Pt, snap = true): number {
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  const a1 = Math.atan2(to.y - c.y, to.x - c.x);
  let d = ((a1 - a0) * 180) / Math.PI;
  d = ((((d + 180) % 360) + 360) % 360) - 180;
  const a = normAngle(Math.round((start + d) * 10) / 10);
  const q = Math.round(a / 90) * 90;
  return snap && Math.abs(a - q) <= SNAP ? normAngle(q) : a;
}

/** A screen point in frame pixels. */
export function toFrame(v: View, p: Pt): Pt {
  return rotate({ x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale }, -v.rot);
}

/** A frame point on screen. */
export function toScreen(v: View, p: Pt): Pt {
  const q = rotate(p, v.rot);
  return { x: v.x + q.x * v.scale, y: v.y + q.y * v.scale };
}

/** A movement on screen as a movement in frame pixels. */
export function screenToFrameDelta(v: View, d: Pt): Pt {
  return rotate({ x: d.x / v.scale, y: d.y / v.scale }, -v.rot);
}

/**
 * What a screen point grabs on a level rectangle `r` (screen pixels): a corner or edge within
 * `tol` pixels, the middle, or nothing (outside it).
 */
export function hitRect(r: Rect, p: Pt, tol: number): Handle | null {
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

/** What a screen point grabs on the box, turned or not. */
export function hitBox(v: View, b: Box, angle: number, p: Pt, tol: number): Handle | null {
  const c = toScreen(v, { x: b.cx, y: b.cy });
  const l = rotate({ x: p.x - c.x, y: p.y - c.y }, -(angle + v.rot));
  const w = b.w * v.scale;
  const h = b.h * v.scale;
  return hitRect({ x: -w / 2, y: -h / 2, w, h }, l, tol);
}

const HANDLE_DIRECTION: Record<Exclude<Handle, "move">, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
const RESIZE_CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];

/** The cursor for a handle on a box turned `angle` on screen: the resize arrow nearest its direction. */
export function handleCursor(handle: Handle, angle: number): string {
  if (handle === "move") return "move";
  const deg = (((HANDLE_DIRECTION[handle] + angle) % 180) + 180) % 180;
  return RESIZE_CURSORS[Math.round(deg / 45) % 4];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
