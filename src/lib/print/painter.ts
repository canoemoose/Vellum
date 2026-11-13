// Draws print sheets on a canvas: the dialog's preview and the manual layout editor.
//
// Items are rendered through the shared renderer exactly as the viewer renders pages (an item
// is a page at a scale with a crop: a region render), cached by page, render scale and region,
// and drawn with the item's transform and clip. Drawing is synchronous with whatever is
// cached; `want` asks for a sharper render and calls back when it lands, so callers redraw.

import type { Renderer } from "../render/types";
import { type Box, intersect, quarter } from "./model/geom";
import type { JobItem, JobLine, JobText } from "./model/job";
import { type ManualItem, itemBox, sheetToPage } from "./model/manual";
import type { ColourMode } from "./model/settings";
import { BLACK_RADIUS_PT, BLACK_SENSITIVITY_DEFAULT, type PxRect, blackLinesIn } from "./blackLines";

/** Canvas pixels per sheet point, and where the sheet's origin is on the canvas. */
export interface SheetView {
  k: number;
  ox: number;
  oy: number;
}

interface Entry {
  docId: number;
  page: number;
  rs: number;
  /** Page region the bitmap covers, in displayed page points. */
  region: Box;
  bmp: ImageBitmap;
  px: number;
  used: number;
}

/** Placement as the model's ManualItem, so its maths (sheetToPage) applies to job items. */
export function asItem(it: JobItem): ManualItem {
  return {
    id: 0,
    ref: { docId: it.docId, page: it.page, path: it.path, kind: "pdf", title: "", w: it.srcW, h: it.srcH, drawingScale: null },
    crop: it.crop,
    x: it.x,
    y: it.y,
    scale: it.scale,
    rotation: quarter(it.rotation),
    border: false,
    showName: false,
    showPage: false,
    showScale: false,
  };
}

const MAX_SIDE = 4096;
const MAX_CACHE_PX = 80e6;
/** Render scales are quantised to quarter-octaves so small zoom changes reuse bitmaps. */
const quantRs = (rs: number): number => Math.pow(2, Math.ceil(Math.log2(rs) * 4) / 4);

export class SheetPainter {
  private cache: Entry[] = [];
  private inflight = new Map<string, Promise<void>>();
  private tick = 0;
  private disposed = false;

  constructor(private renderer: Renderer, private onReady: () => void) {}

  dispose(): void {
    this.disposed = true;
    for (const e of this.cache) e.bmp.close();
    this.cache = [];
  }

  /** The page region (displayed points) of `it` that falls inside sheet box `vis`. */
  private pageRegion(it: ManualItem, vis: Box): Box | null {
    const v = intersect(itemBox(it), vis);
    if (!v) return null;
    const a = sheetToPage(it, v.x0, v.y0);
    const b = sheetToPage(it, v.x1, v.y1);
    const r = { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
    return intersect(r, { x0: 0, y0: 0, x1: it.ref.w, y1: it.ref.h });
  }

  /**
   * Ask for a render of the part of `it` visible in sheet box `vis`, sharp at `k` canvas
   * pixels per sheet point. Resolves when cached (or failed); calls onReady on success.
   */
  want(it: ManualItem, vis: Box, k: number): void {
    const region = this.pageRegion(it, vis);
    if (!region) return;
    let rs = quantRs(Math.max(1e-3, it.scale * k));
    // Keep a render to a sane size; zoomed far in, the preview is just softer.
    const side = Math.max(region.x1 - region.x0, region.y1 - region.y0) * rs;
    if (side > MAX_SIDE) rs = (rs * MAX_SIDE) / side;
    if (this.covering(it.ref.docId, it.ref.page, region, rs * 0.99)) return;
    // Grow the region to a 256 px grid at this scale so panning reuses the bitmap.
    const g = 256 / rs;
    const pw = it.ref.w;
    const ph = it.ref.h;
    const grown = {
      x0: Math.max(0, Math.floor(region.x0 / g) * g),
      y0: Math.max(0, Math.floor(region.y0 / g) * g),
      x1: Math.min(pw, Math.ceil(region.x1 / g) * g),
      y1: Math.min(ph, Math.ceil(region.y1 / g) * g),
    };
    const x = Math.floor(grown.x0 * rs);
    const y = Math.floor(grown.y0 * rs);
    const w = Math.max(1, Math.min(Math.ceil(pw * rs), Math.ceil(grown.x1 * rs)) - x);
    const h = Math.max(1, Math.min(Math.ceil(ph * rs), Math.ceil(grown.y1 * rs)) - y);
    const key = `${it.ref.docId}:${it.ref.page}:${rs.toPrecision(6)}:${x}:${y}:${w}:${h}`;
    if (this.inflight.has(key)) return;
    const ac = new AbortController();
    const p = this.renderer
      .renderRegion(it.ref.docId, { page: it.ref.page, rs, x, y, w, h, tiles: [{ i: 0, j: 0, x, y, w, h }] }, ac.signal)
      .then((bmps) => {
        const bmp = bmps?.[0];
        if (!bmp) return;
        if (this.disposed) {
          bmp.close();
          return;
        }
        this.cache.push({
          docId: it.ref.docId,
          page: it.ref.page,
          rs,
          region: { x0: x / rs, y0: y / rs, x1: (x + w) / rs, y1: (y + h) / rs },
          bmp,
          px: w * h,
          used: ++this.tick,
        });
        this.evict();
        this.onReady();
      })
      .catch(() => {})
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
  }

  private covering(docId: number, page: number, r: Box, minRs: number): Entry | null {
    let best: Entry | null = null;
    for (const e of this.cache) {
      if (e.docId !== docId || e.page !== page || e.rs < minRs) continue;
      if (e.region.x0 <= r.x0 + 0.01 && e.region.y0 <= r.y0 + 0.01 && e.region.x1 >= r.x1 - 0.01 && e.region.y1 >= r.y1 - 0.01) {
        if (!best || e.rs < best.rs) best = e;
      }
    }
    return best;
  }

  private evict(): void {
    let total = this.cache.reduce((s, e) => s + e.px, 0);
    if (total <= MAX_CACHE_PX) return;
    this.cache.sort((a, b) => a.used - b.used);
    while (total > MAX_CACHE_PX && this.cache.length > 1) {
      const e = this.cache.shift()!;
      total -= e.px;
      e.bmp.close();
    }
  }

  /** True when everything `it` needs at `k` is cached. */
  isSharp(it: ManualItem, vis: Box, k: number): boolean {
    const region = this.pageRegion(it, vis);
    if (!region) return true;
    let rs = quantRs(Math.max(1e-3, it.scale * k));
    const side = Math.max(region.x1 - region.x0, region.y1 - region.y0) * rs;
    if (side > MAX_SIDE) rs = (rs * MAX_SIDE) / side;
    return !!this.covering(it.ref.docId, it.ref.page, region, rs * 0.99);
  }

  /**
   * Draw an item with whatever bitmaps are cached for its page (blurry ones first, sharp on
   * top), clipped to its box and to `clip`. White underneath, like paper.
   */
  drawItem(ctx: CanvasRenderingContext2D, it: ManualItem, v: SheetView, clip: Box | null): void {
    const b = clip ? intersect(itemBox(it), clip) : itemBox(it);
    if (!b) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(v.ox + b.x0 * v.k, v.oy + b.y0 * v.k, (b.x1 - b.x0) * v.k, (b.y1 - b.y0) * v.k);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    // Sheet canvas transform for this item: page displayed coords -> canvas.
    const c = it.crop ?? { x0: 0, y0: 0, x1: it.ref.w, y1: it.ref.h };
    const cw = c.x1 - c.x0;
    const ch = c.y1 - c.y0;
    ctx.translate(v.ox + it.x * v.k, v.oy + it.y * v.k);
    ctx.scale(it.scale * v.k, it.scale * v.k);
    switch (it.rotation) {
      case 90:
        ctx.transform(0, 1, -1, 0, ch, 0);
        break;
      case 180:
        ctx.transform(-1, 0, 0, -1, cw, ch);
        break;
      case 270:
        ctx.transform(0, -1, 1, 0, 0, cw);
        break;
    }
    ctx.translate(-c.x0, -c.y0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const mine = this.cache.filter((e) => e.docId === it.ref.docId && e.page === it.ref.page).sort((a, b2) => a.rs - b2.rs);
    for (const e of mine) {
      if (!intersect(e.region, c)) continue;
      e.used = ++this.tick;
      ctx.drawImage(e.bmp, e.region.x0, e.region.y0, e.region.x1 - e.region.x0, e.region.y1 - e.region.y0);
    }
    ctx.restore();
  }
}

export function drawLines(ctx: CanvasRenderingContext2D, lines: JobLine[], v: SheetView): void {
  ctx.save();
  ctx.strokeStyle = "#000";
  ctx.lineCap = "butt";
  for (const l of lines) {
    ctx.lineWidth = Math.max(0.5, l.width * v.k);
    ctx.beginPath();
    ctx.moveTo(v.ox + l.x0 * v.k, v.oy + l.y0 * v.k);
    ctx.lineTo(v.ox + l.x1 * v.k, v.oy + l.y1 * v.k);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawTexts(ctx: CanvasRenderingContext2D, texts: JobText[], v: SheetView): void {
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  for (const t of texts) {
    ctx.font = `${t.size * v.k}px Helvetica, Arial, sans-serif`;
    ctx.fillText(t.text, v.ox + t.x * v.k, v.oy + t.y * v.k);
  }
  ctx.restore();
}

/** Show a colour mode on a canvas region the way printing will apply it to the raster. */
/**
 * The colour mode on a drawn preview, in place. Black lines needs `sensitivity` and the preview's
 * scale (`pxPerPt`, canvas px per sheet point) to size its neighbourhood as printing does.
 */
export function applyColourPreview(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, mode: ColourMode,
  sensitivity = BLACK_SENSITIVITY_DEFAULT, pxPerPt = 1, pages: PxRect[] = [{ x0: x, y0: y, x1: x + w, y1: y + h }],
): void {
  if (mode === "colour" || w <= 0 || h <= 0) return;
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  if (mode === "blackLines") {
    // Page by page (`pages` in canvas px), as printing does.
    const local = pages.map((p) => ({ x0: p.x0 - x, y0: p.y0 - y, x1: p.x1 - x, y1: p.y1 - y }));
    blackLinesIn(d, w, h, local, sensitivity, BLACK_RADIUS_PT * pxPerPt);
    ctx.putImageData(img, x, y);
    return;
  }
  for (let i = 0; i < d.length; i += 4) {
    if (mode === "greyscale") {
      const yv = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114 + 500) / 1000;
      d[i] = d[i + 1] = d[i + 2] = yv;
    }
  }
  ctx.putImageData(img, x, y);
}
