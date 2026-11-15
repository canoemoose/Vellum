// Decoded pictures for stamps on the overlay (markupPainter.ts draws ImageOps through here). A
// PNG is decoded once per hash into an ImageBitmap and kept while it's in use; the first paint
// of one not yet decoded draws a faint box and asks for a frame again when it's ready. Never
// logs image data: errors name the hash only.

import type { ImageOp } from "../markup/draw";
import { fromBase64 } from "../markup/stamps";

/** Decoded pictures kept at once (each is a signature or a stamp, a few hundred kilobytes). */
const KEEP = 24;

const ready = new Map<string, ImageBitmap>();
const pending = new Set<string>();
const failed = new Set<string>();
let onReady: () => void = () => {};

/** What to call when a picture has been decoded (the viewer's requestFrame). */
export function setImageReady(fn: () => void): void {
  onReady = fn;
}

/** Start decoding a picture before it's needed (when a signature is picked, say). */
export function preloadImage(hash: string, png: string): void {
  if (ready.has(hash) || pending.has(hash) || failed.has(hash) || typeof createImageBitmap !== "function") return;
  pending.add(hash);
  const bytes = fromBase64(png);
  createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }))
    .then((bmp) => {
      ready.set(hash, bmp);
      // Oldest first: drop the oldest beyond the limit.
      while (ready.size > KEEP) {
        const [k, v] = ready.entries().next().value as [string, ImageBitmap];
        v.close();
        ready.delete(k);
      }
      onReady();
    })
    .catch(() => {
      failed.add(hash);
      console.warn(`stamp image ${hash.slice(0, 12)} could not be decoded`);
    })
    .finally(() => pending.delete(hash));
}

/** Draw an image operation (the context already maps page points to pixels). */
export function paintImage(ctx: CanvasRenderingContext2D, op: ImageOp): void {
  const [x0, y0, x1, y1] = op.rect;
  const bmp = ready.get(op.hash);
  if (bmp) {
    // Most recently used last, so it's kept.
    ready.delete(op.hash);
    ready.set(op.hash, bmp);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, x0, y0, x1 - x0, y1 - y0);
    return;
  }
  preloadImage(op.hash, op.png);
  ctx.fillStyle = "rgba(128, 128, 128, 0.12)";
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}
