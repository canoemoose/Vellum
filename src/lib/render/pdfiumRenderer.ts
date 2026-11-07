// PDFium renderer: regions are rasterised by PDFium on a Rust thread and come back as
// raw RGBA over Tauri's binary IPC, then are sliced into tile ImageBitmaps here.
// Nothing heavy runs on the WebView main thread, unlike pdf.js.

import { invoke } from "@tauri-apps/api/core";
import type { DocInfo, RegionRequest, Renderer } from "./types";

export class PdfiumRenderer implements Renderer {
  readonly name = "pdfium" as const;
  /** Two in flight: one rendering in Rust while the other's bytes are being turned into bitmaps. */
  readonly concurrency = 2;
  private nextId = 1;

  open(path: string): Promise<DocInfo> {
    return invoke<DocInfo>("pdfium_open", { path });
  }

  async renderRegion(req: RegionRequest, signal: AbortSignal): Promise<ImageBitmap[] | null> {
    if (signal.aborted) return null;
    const id = this.nextId++;
    const onAbort = () => {
      invoke("pdfium_cancel", { id }).catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const buf = await invoke<ArrayBuffer>("pdfium_render", {
        args: { id, page: req.page, rs: req.rs, x: req.x, y: req.y, w: req.w, h: req.h },
      });
      if (signal.aborted || buf.byteLength === 0) return null;
      const data = new ImageData(new Uint8ClampedArray(buf), req.w, req.h);
      return await Promise.all(
        req.tiles.map((t) => createImageBitmap(data, t.x - req.x, t.y - req.y, t.w, t.h)),
      );
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  async close(): Promise<void> {}
}
