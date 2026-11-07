// pdf.js renderer. Parsing runs in pdf.js's web worker; canvas drawing of the operator
// list runs on the main thread (pdf.js time-slices it, roughly 15 ms per slice).

import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { invoke } from "@tauri-apps/api/core";
import type { DocInfo, RegionRequest, Renderer } from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ASSETS = "/pdfjs/";

export class PdfjsRenderer implements Renderer {
  readonly name = "pdfjs" as const;
  private doc: PDFDocumentProxy | null = null;
  private pages = new Map<number, Promise<PDFPageProxy>>();
  private canvas = document.createElement("canvas");

  /**
   * @param hwa GPU-backed canvases (pdf.js `enableHWA`). pdf.js defaults to false, which
   * makes every canvas CPU-backed (`willReadFrequently`). Which is faster for heavy
   * vector work is one of the things this spike measures.
   */
  constructor(private hwa = true) {
    // Create the context first so pdf.js's own getContext() call returns this one.
    this.canvas.getContext("2d", { alpha: false, willReadFrequently: !hwa });
  }

  async open(path: string): Promise<DocInfo> {
    await this.close();
    const buf = await invoke<ArrayBuffer>("read_file", { path });
    const task = pdfjs.getDocument({
      data: new Uint8Array(buf),
      cMapUrl: ASSETS + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: ASSETS + "standard_fonts/",
      wasmUrl: ASSETS + "wasm/",
      iccUrl: ASSETS + "iccs/",
      enableHWA: this.hwa,
    });
    this.doc = await task.promise;
    const n = this.doc.numPages;
    // Page sizes: one worker round-trip per page, issued in parallel.
    const sizes = await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        const p = await this.page(i);
        const v = p.getViewport({ scale: 1 });
        return { w: v.width, h: v.height };
      }),
    );
    return { numPages: n, sizes };
  }

  private page(i: number): Promise<PDFPageProxy> {
    let p = this.pages.get(i);
    if (!p) {
      p = this.doc!.getPage(i + 1);
      this.pages.set(i, p);
    }
    return p;
  }

  async renderRegion(req: RegionRequest, signal: AbortSignal): Promise<ImageBitmap[] | null> {
    if (!this.doc || signal.aborted) return null;
    const page = await this.page(req.page);
    if (signal.aborted) return null;

    const c = this.canvas;
    if (c.width !== req.w || c.height !== req.h) {
      c.width = req.w;
      c.height = req.h;
    }
    const viewport = page.getViewport({ scale: req.rs });
    let task: RenderTask | null = null;
    const onAbort = () => task?.cancel();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      task = page.render({
        canvas: c,
        viewport,
        transform: [1, 0, 0, 1, -req.x, -req.y],
        background: "white",
      });
      await task.promise;
    } catch (e) {
      if (signal.aborted || (e as Error)?.name === "RenderingCancelledException") return null;
      throw e;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (signal.aborted) return null;
    return Promise.all(
      req.tiles.map((t) => createImageBitmap(c, t.x - req.x, t.y - req.y, t.w, t.h)),
    );
  }

  async close(): Promise<void> {
    this.pages.clear();
    if (this.doc) {
      const d = this.doc;
      this.doc = null;
      await d.loadingTask.destroy();
    }
  }
}
