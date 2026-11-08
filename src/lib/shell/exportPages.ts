// File > Export pages as images: render each chosen page at a DPI through the renderer, in
// horizontal strips (so no single IPC response is huge), compose on an OffscreenCanvas,
// encode as PNG or JPEG and write next to each other in a folder.

import type { Renderer } from "../render/types";
import type { PageSize } from "../view/layout";
import { exportFileName, joinPath } from "./format";

/** Chromium's canvas limits: 16384 px a side; stay well under its area cap too. */
export const MAX_SIDE = 16384;
export const MAX_PIXELS = 120e6;
const STRIP = 1024;

/**
 * The render scale (device px per point) to export a page at `dpi`, reduced when the result
 * would exceed the canvas limits. Pure, so the size rules are tested.
 */
export function exportScale(size: PageSize, dpi: number): { rs: number; dpi: number; limited: boolean } {
  let rs = dpi / 72;
  const w = size.w * rs;
  const h = size.h * rs;
  const k = Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
  if (k < 1) rs *= k * 0.999;
  return { rs, dpi: Math.floor(rs * 72), limited: k < 1 };
}

export interface ExportJob {
  renderer: Renderer;
  docId: number;
  docName: string;
  sizes: PageSize[];
  pages: number[];
  dpi: number;
  format: "png" | "jpg";
  folder: string;
  write: (path: string, bytes: Uint8Array) => Promise<void>;
  onProgress: (done: number, total: number) => void;
  signal: AbortSignal;
}

export interface ExportResult {
  written: string[];
  /** Pages exported below the requested DPI because of the size limit: [page, dpi]. */
  reduced: [number, number][];
}

export async function exportPages(job: ExportJob): Promise<ExportResult> {
  const out: ExportResult = { written: [], reduced: [] };
  let done = 0;
  job.onProgress(0, job.pages.length);
  for (const page of job.pages) {
    if (job.signal.aborted) break;
    const size = job.sizes[page];
    const { rs, dpi, limited } = exportScale(size, job.dpi);
    if (limited) out.reduced.push([page, dpi]);
    const W = Math.max(1, Math.ceil(size.w * rs));
    const H = Math.max(1, Math.ceil(size.h * rs));
    const canvas = new OffscreenCanvas(W, H);
    const g = canvas.getContext("2d", { alpha: false })!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += STRIP) {
      const h = Math.min(STRIP, H - y);
      const bmps = await job.renderer.renderRegion(
        job.docId,
        { page, rs, x: 0, y, w: W, h, tiles: [{ i: 0, j: 0, x: 0, y, w: W, h }] },
        job.signal,
      );
      if (!bmps) return out; // aborted
      g.drawImage(bmps[0], 0, y);
      bmps.forEach((b) => b.close());
    }
    const blob = await canvas.convertToBlob(
      job.format === "png" ? { type: "image/png" } : { type: "image/jpeg", quality: 0.92 },
    );
    const path = joinPath(job.folder, exportFileName(job.docName, page, job.sizes.length, job.format));
    await job.write(path, new Uint8Array(await blob.arrayBuffer()));
    out.written.push(path);
    done++;
    job.onProgress(done, job.pages.length);
  }
  return out;
}
