// Tile grid maths and the LRU tile cache.
//
// A page rendered at render scale `rs` (device pixels per point) is a devW x devH
// bitmap, cut into TILE x TILE squares (edge tiles are smaller). Tiles are keyed by
// (page, rs, column, row). rs is rounded to 6 significant figures so the same zoom
// always produces the same key.

import type { PageSize } from "../view/layout";
import type { Rect, View } from "../view/viewMath";

export const TILE = 512;

export interface TileGrid {
  devW: number;
  devH: number;
  cols: number;
  rows: number;
}

export interface TileIndexRange {
  i0: number;
  i1: number; // inclusive
  j0: number;
  j1: number; // inclusive
}

export interface TileSpec {
  i: number;
  j: number;
  /** Device-pixel rect within the page bitmap at this rs. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export function scaleKey(rs: number): number {
  return Number(rs.toPrecision(6));
}

/**
 * Which other cached scales to draw under the target scale's tiles while it renders, in
 * draw order (later on top). Up to two scales below the target, the farther first, then
 * the nearest scale above it (within MAX_FALLBACK_UP) last, because a downscaled sharper
 * copy looks right and an upscaled blurrier one doesn't: after zooming out, the earlier
 * zoomed-in tiles cover what they can and the soft ones fill the gaps underneath. Scales
 * far above the target are skipped: they cover little of the view and walking their tile
 * ranges every frame isn't free.
 */
export const MAX_FALLBACK_UP = 4;
export function fallbackScales(cached: number[], target: number): number[] {
  const below = cached.filter((s) => s < target).sort((a, b) => a - b).slice(-2);
  const above = cached.filter((s) => s > target && s <= target * MAX_FALLBACK_UP).sort((a, b) => a - b);
  return above.length ? [...below, above[0]] : below;
}

/**
 * Render scales are quantised to steps of RS_STEP, so zooming back and forth lands on scales
 * already in the cache, and they run ahead of the display: zooming in renders RS_AHEAD past
 * the new zoom, so the next wheel notch in is still sharp without a render. A render scale
 * is kept while the display scale stays within [rs / RS_MAX_DOWN, rs]: zooming out reuses
 * the sharper tiles, downscaled, until they'd be too fine to draw well.
 */
export const RS_STEP = 2 ** 0.25;
export const RS_AHEAD = 1.25;
export const RS_MAX_DOWN = 1.6;
export function chooseRenderScale(current: number | null, display: number): number {
  if (current !== null && current >= display && current <= display * RS_MAX_DOWN) return current;
  const want = current !== null && display > current ? display * RS_AHEAD : display;
  const k = Math.ceil(Math.log(want) / Math.log(RS_STEP) - 1e-9);
  return scaleKey(RS_STEP ** k);
}

export function tileGrid(size: PageSize, rs: number): TileGrid {
  const devW = Math.max(1, Math.ceil(size.w * rs));
  const devH = Math.max(1, Math.ceil(size.h * rs));
  return { devW, devH, cols: Math.ceil(devW / TILE), rows: Math.ceil(devH / TILE) };
}

export function tileSpec(grid: TileGrid, i: number, j: number): TileSpec {
  const x = i * TILE;
  const y = j * TILE;
  return { i, j, x, y, w: Math.min(TILE, grid.devW - x), h: Math.min(TILE, grid.devH - y) };
}

/**
 * Tile index range of a page (world rect `page`) that intersects the viewport, grown by
 * `margin` tiles on each side. Returns null when the page is not visible at all.
 */
export function visibleTileRange(
  page: Rect,
  grid: TileGrid,
  view: View,
  vw: number,
  vh: number,
  rs: number,
  margin = 0,
): TileIndexRange | null {
  // Viewport in page-local world coordinates.
  const lx0 = (0 - view.tx) / view.scale - page.x;
  const ly0 = (0 - view.ty) / view.scale - page.y;
  const lx1 = (vw - view.tx) / view.scale - page.x;
  const ly1 = (vh - view.ty) / view.scale - page.y;
  return tileRangeForRect(lx0, ly0, lx1, ly1, page.w, page.h, grid, rs, margin);
}

/**
 * Tile index range covering the page-local rect (lx0, ly0)-(lx1, ly1) in points (unrotated
 * page coordinates), grown by `margin` tiles on each side. Null when the rect misses the
 * page (pw x ph points).
 */
export function tileRangeForRect(
  lx0: number,
  ly0: number,
  lx1: number,
  ly1: number,
  pw: number,
  ph: number,
  grid: TileGrid,
  rs: number,
  margin = 0,
): TileIndexRange | null {
  if (lx1 <= 0 || ly1 <= 0 || lx0 >= pw || ly0 >= ph) return null;
  const i0 = Math.max(0, Math.floor((lx0 * rs) / TILE) - margin);
  const j0 = Math.max(0, Math.floor((ly0 * rs) / TILE) - margin);
  const i1 = Math.min(grid.cols - 1, Math.floor((lx1 * rs - 1e-6) / TILE) + margin);
  const j1 = Math.min(grid.rows - 1, Math.floor((ly1 * rs - 1e-6) / TILE) + margin);
  if (i1 < i0 || j1 < j0) return null;
  return { i0, i1, j0, j1 };
}

/**
 * Group missing tiles into rectangular render regions of at most maxSide x maxSide
 * tiles. pdf.js walks a page's whole operator list on every render call, whatever the
 * clip, so one pass per region (sliced into tiles afterwards) is far cheaper than one
 * pass per tile. Regions are the bounding boxes of missing tiles within each chunk.
 */
export function groupIntoRegions(
  missing: { i: number; j: number }[],
  maxSide: number,
): TileIndexRange[] {
  if (missing.length === 0) return [];
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const t of missing) {
    i0 = Math.min(i0, t.i); i1 = Math.max(i1, t.i);
    j0 = Math.min(j0, t.j); j1 = Math.max(j1, t.j);
  }
  const set = new Set(missing.map((t) => t.i * 100003 + t.j));
  const out: TileIndexRange[] = [];
  for (let cj = j0; cj <= j1; cj += maxSide) {
    for (let ci = i0; ci <= i1; ci += maxSide) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let j = cj; j <= Math.min(j1, cj + maxSide - 1); j++) {
        for (let i = ci; i <= Math.min(i1, ci + maxSide - 1); i++) {
          if (set.has(i * 100003 + j)) {
            a0 = Math.min(a0, i); a1 = Math.max(a1, i);
            b0 = Math.min(b0, j); b1 = Math.max(b1, j);
          }
        }
      }
      if (a0 !== Infinity) out.push({ i0: a0, i1: a1, j0: b0, j1: b1 });
    }
  }
  return out;
}

export interface Tile {
  key: string;
  page: number;
  rs: number;
  i: number;
  j: number;
  w: number;
  h: number;
  bitmap: ImageBitmap;
  bytes: number;
}

export function tileKey(page: number, rs: number, i: number, j: number): string {
  return `${page}|${rs}|${i}|${j}`;
}

/** Releasable bitmap: ImageBitmap in the app, a stub in tests. */
interface Closable {
  close(): void;
}

/**
 * LRU cache of tiles with a byte ceiling (bytes = w * h * 4, the decoded RGBA size;
 * the actual GPU-side cost is similar). Map iteration order is insertion order, so
 * re-inserting on access gives LRU for free. A per-page, per-scale index lets the
 * compositor find drawable layers without scanning the whole cache.
 */
export class TileCache {
  private map = new Map<string, Tile>();
  private index = new Map<number, Map<number, Map<number, Tile>>>();
  bytes = 0;
  evictions = 0;

  constructor(public maxBytes: number) {}

  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** Lookup without changing recency. */
  peek(page: number, rs: number, i: number, j: number): Tile | undefined {
    return this.index.get(page)?.get(rs)?.get(i * 100003 + j);
  }

  touch(t: Tile): void {
    if (this.map.delete(t.key)) this.map.set(t.key, t);
  }

  put(t: Tile): void {
    const old = this.map.get(t.key);
    if (old) this.remove(old);
    this.map.set(t.key, t);
    this.bytes += t.bytes;
    let byScale = this.index.get(t.page);
    if (!byScale) this.index.set(t.page, (byScale = new Map()));
    let byIJ = byScale.get(t.rs);
    if (!byIJ) byScale.set(t.rs, (byIJ = new Map()));
    byIJ.set(t.i * 100003 + t.j, t);
    this.evict();
  }

  /** Render scales that have at least one tile for this page. */
  scalesFor(page: number): number[] {
    const m = this.index.get(page);
    return m ? [...m.keys()] : [];
  }

  private remove(t: Tile): void {
    this.map.delete(t.key);
    this.bytes -= t.bytes;
    const byScale = this.index.get(t.page);
    const byIJ = byScale?.get(t.rs);
    byIJ?.delete(t.i * 100003 + t.j);
    if (byIJ && byIJ.size === 0) byScale!.delete(t.rs);
    if (byScale && byScale.size === 0) this.index.delete(t.page);
    (t.bitmap as unknown as Closable).close();
  }

  private evict(): void {
    while (this.bytes > this.maxBytes && this.map.size > 0) {
      const oldest = this.map.values().next().value as Tile;
      this.remove(oldest);
      this.evictions++;
    }
  }

  /** Drop every tile for a page at scales other than `keep` (e.g. after a zoom). */
  dropOtherScales(page: number, keep: number[]): void {
    const byScale = this.index.get(page);
    if (!byScale) return;
    for (const [rs, byIJ] of [...byScale]) {
      if (keep.includes(rs)) continue;
      for (const t of [...byIJ.values()]) this.remove(t);
    }
  }

  clear(): void {
    for (const t of [...this.map.values()]) this.remove(t);
    this.evictions = 0;
  }
}
