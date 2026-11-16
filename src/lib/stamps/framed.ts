// An image stamp's picture as framed (quarter turns, then a crop box that may be turned; see
// src/lib/signature/frame.ts), drawn at full size on a canvas. The same framing as a signature
// import's (`frame` in src-tauri/src/signature/import.rs), except that what lies beyond the
// photo is left transparent rather than repeating its edge: a stamp has no paper to repeat.

import { type Adjust, frameSize } from "../signature/frame";
import type { Pixels } from "./knockout";

/** Where the framed picture comes from: its size, and the box's centre in frame pixels. */
export interface FramedGeometry {
  /** The result's size, at most `maxSide` on its long side. */
  w: number;
  h: number;
  /** The box's centre in frame pixels. */
  cx: number;
  cy: number;
  /** Result pixels per frame pixel (below 1 when the box was bigger than `maxSide`). */
  scale: number;
}

/** The framed picture's size and placement, for a picture `w` x `h`. Pure. */
export function framedGeometry(w: number, h: number, a: Adjust, maxSide: number): FramedGeometry {
  const f = frameSize(w, h, a.turns);
  const c = a.crop;
  const cx = Math.min(1, Math.max(0, c.x + c.w / 2)) * f.w;
  const cy = Math.min(1, Math.max(0, c.y + c.h / 2)) * f.h;
  const bw = Math.max(1, Math.min(2, Math.abs(c.w)) * f.w);
  const bh = Math.max(1, Math.min(2, Math.abs(c.h)) * f.h);
  const scale = Math.min(1, maxSide / Math.max(bw, bh));
  return { w: Math.max(1, Math.round(bw * scale)), h: Math.max(1, Math.round(bh * scale)), cx, cy, scale };
}

/** Draw `img` framed by `a` onto a new canvas, at most `maxSide` on its long side. */
export function drawFramed(img: CanvasImageSource & { width: number; height: number }, a: Adjust, maxSide: number): HTMLCanvasElement {
  const g = framedGeometry(img.width, img.height, a, maxSide);
  const f = frameSize(img.width, img.height, a.turns);
  const canvas = document.createElement("canvas");
  canvas.width = g.w;
  canvas.height = g.h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  // Result pixel -> frame: from the box's centre, along its sides, turned by its angle. So the
  // canvas runs that backwards: centre, unturn, scale, back to the box's centre in the frame.
  ctx.translate(g.w / 2, g.h / 2);
  ctx.scale(g.scale, g.scale);
  ctx.rotate((-a.angle * Math.PI) / 180);
  ctx.translate(-g.cx, -g.cy);
  // Picture -> frame: the quarter turns, clockwise.
  const t = ((a.turns % 4) + 4) % 4;
  if (t === 1) ctx.translate(f.w, 0);
  else if (t === 2) ctx.translate(f.w, f.h);
  else if (t === 3) ctx.translate(0, f.h);
  ctx.rotate((t * Math.PI) / 2);
  ctx.drawImage(img, 0, 0);
  return canvas;
}

/** A canvas's pixels. */
export function pixelsOf(c: HTMLCanvasElement): Pixels {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
  return { data: d.data, width: d.width, height: d.height };
}
