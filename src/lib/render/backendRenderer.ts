// The renderer for documents held in the Rust backend. PDFs (PDFium pool) and images
// (imagedoc.rs) use the same doc_* commands with the same shapes; the backend dispatches on
// the document's kind. Pixels come back as raw RGBA over Tauri's binary IPC and are sliced
// into tile ImageBitmaps here, so nothing heavy runs on the WebView main thread.
//
// PdfiumRenderer and ImageRenderer are thin subclasses that only differ in name; one class
// does the work for both (see ARCHITECTURE.md, "Documents").

import { Channel, invoke } from "@tauri-apps/api/core";
import { RegionAssembler } from "./assembler";
import type {
  BandBitmap,
  DocInfo,
  OutlineNode,
  RegionRequest,
  Renderer,
  RendererName,
  ScaleCandidate,
} from "./types";

/** Request ids for cancellation; shared by every renderer instance so they never collide. */
let nextRequestId = 1;

const regionArgs = (id: number, req: RegionRequest) => ({
  id, page: req.page, rs: req.rs, x: req.x, y: req.y, w: req.w, h: req.h,
});

/** Tauri delivers raw channel bodies as ArrayBuffer; be tolerant of other shapes. */
function toBytes(m: unknown): Uint8Array {
  if (m instanceof ArrayBuffer) return new Uint8Array(m);
  if (ArrayBuffer.isView(m)) return new Uint8Array(m.buffer, m.byteOffset, m.byteLength);
  if (Array.isArray(m)) return Uint8Array.from(m as number[]);
  throw new Error("unexpected band message");
}

export abstract class BackendRenderer implements Renderer {
  abstract readonly name: RendererName;
  /** Two in flight: one rendering in Rust while the other's bytes are being turned into bitmaps. */
  readonly concurrency = 2;
  /** Parallel PDFium instances in the backend (reported by open). */
  workers = 0;

  async open(path: string, password?: string): Promise<DocInfo> {
    const info = await invoke<DocInfo>("doc_open", { path, password: password ?? null });
    if (info.workers) this.workers = info.workers;
    return info;
  }

  async close(docId: number): Promise<void> {
    await invoke("doc_close", { docId });
  }

  /** Abort hook: cancel the backend request (skipped if it hasn't started yet). */
  private watch(signal: AbortSignal, id: number): () => void {
    const onAbort = () => {
      invoke("doc_cancel", { id }).catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return () => signal.removeEventListener("abort", onAbort);
  }

  async renderRegion(docId: number, req: RegionRequest, signal: AbortSignal): Promise<ImageBitmap[] | null> {
    if (signal.aborted) return null;
    const id = nextRequestId++;
    const unwatch = this.watch(signal, id);
    try {
      const buf = await invoke<ArrayBuffer>("doc_render", { docId, region: regionArgs(id, req) });
      if (signal.aborted || buf.byteLength === 0) return null;
      const data = new ImageData(new Uint8ClampedArray(buf), req.w, req.h);
      return await Promise.all(
        req.tiles.map((t) => createImageBitmap(data, t.x - req.x, t.y - req.y, t.w, t.h)),
      );
    } finally {
      unwatch();
    }
  }

  async renderRegionProgressive(
    docId: number,
    req: RegionRequest,
    onBand: (b: BandBitmap) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return;
    const id = nextRequestId++;
    const unwatch = this.watch(signal, id);
    const asm = new RegionAssembler(req, req.tiles);
    const whole = new ImageData(asm.pixels, req.w, req.h);
    let received = 0;
    let expected: number | null = null;
    let failed: unknown = null;
    let wake: (() => void) | null = null;
    // Bitmap creation is async; chain deliveries so bands reach onBand in arrival order and
    // the promise resolves only after the last one.
    let chain = Promise.resolve();

    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (m) => {
      received++;
      if (signal.aborted) {
        wake?.();
        return;
      }
      let bytes: Uint8Array;
      try {
        bytes = toBytes(m);
      } catch (e) {
        failed = e;
        wake?.();
        return;
      }
      // Trailer: four little-endian u32s (x, y, w, h of the band within the region).
      const dv = new DataView(bytes.buffer, bytes.byteOffset + bytes.byteLength - 16, 16);
      const bx = dv.getUint32(0, true), by = dv.getUint32(4, true);
      const bw = dv.getUint32(8, true), bh = dv.getUint32(12, true);
      const px = new Uint8ClampedArray(bytes.buffer as ArrayBuffer, bytes.byteOffset, bw * bh * 4);
      const completed = asm.addBand(bx, by, bw, bh, px);
      // Snapshot now: createImageBitmap copies an ImageData source when called.
      // A band whose tiles are all complete needs no overlay of its own (one-band regions).
      const bandP = asm.bandDone(bx, by, bw, bh) ? Promise.resolve(null) : createImageBitmap(new ImageData(px, bw, bh));
      const tileP = Promise.all(
        completed.map((k) => {
          const t = req.tiles[k];
          return createImageBitmap(whole, t.x - req.x, t.y - req.y, t.w, t.h).then((bitmap) => ({ index: k, bitmap }));
        }),
      );
      chain = chain.then(async () => {
        const [bitmap, tiles] = await Promise.all([bandP, tileP]);
        if (signal.aborted) {
          bitmap?.close();
          tiles.forEach((t) => t.bitmap.close());
          return;
        }
        onBand({ x: req.x + bx, y: req.y + by, w: bw, h: bh, bitmap, tiles });
      });
      wake?.();
    };

    const onAbort = () => wake?.();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      expected = await invoke<number | null>("doc_render_stream", { docId, region: regionArgs(id, req), onBand: channel });
      if (expected === null) return; // cancelled before it started
      // Messages may still be in flight after the command resolves.
      while (received < expected && !signal.aborted && failed === null) {
        await new Promise<void>((r) => (wake = r));
        wake = null;
      }
      if (failed !== null) throw failed;
      await chain;
    } finally {
      signal.removeEventListener("abort", onAbort);
      unwatch();
    }
  }

  async thumbnail(docId: number, page: number, maxSide: number): Promise<ImageBitmap> {
    const buf = await invoke<ArrayBuffer>("doc_thumbnail", { docId, page, maxSide: Math.round(maxSide) });
    const dv = new DataView(buf, buf.byteLength - 8, 8);
    const w = dv.getUint32(0, true), h = dv.getUint32(4, true);
    return createImageBitmap(new ImageData(new Uint8ClampedArray(buf, 0, w * h * 4), w, h));
  }

  knownBands(docId: number, page: number): Promise<number | null> {
    return invoke<number | null>("doc_known_bands", { docId, page });
  }

  async cachedPreview(docId: number, page: number): Promise<ImageBitmap | null> {
    const buf = await invoke<ArrayBuffer>("doc_cached_preview", { docId, page });
    if (buf.byteLength === 0) return null;
    return createImageBitmap(new Blob([buf], { type: "image/webp" }));
  }

  async storePreview(docId: number, page: number, bitmap: ImageBitmap): Promise<void> {
    if (typeof OffscreenCanvas === "undefined") return;
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    c.getContext("2d", { alpha: false })!.drawImage(bitmap, 0, 0);
    const blob = await c.convertToBlob({ type: "image/webp", quality: 0.85 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await invoke("doc_store_preview", bytes, { headers: { "doc-id": String(docId), page: String(page) } });
  }

  pageText(docId: number, page: number): Promise<string> {
    return invoke<string>("doc_page_text", { docId, page });
  }

  outline(docId: number): Promise<OutlineNode[]> {
    return invoke<OutlineNode[]>("doc_outline", { docId });
  }

  findScale(docId: number, page: number): Promise<ScaleCandidate[]> {
    return invoke<ScaleCandidate[]>("doc_find_scale", { docId, page });
  }
}
