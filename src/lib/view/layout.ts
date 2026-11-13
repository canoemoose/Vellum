// Document layout: where each page sits in world space (PDF points).

import type { Rect } from "./viewMath";

export interface PageSize {
  /** Width and height in points, after /Rotate is applied. */
  w: number;
  h: number;
}

export type LayoutMode = "continuous" | "single" | "columns";

/** Columns a user can choose for the columns layout. */
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 6;

export interface Layout {
  mode: LayoutMode;
  /** World rect per page index; null for pages not laid out (single-page mode). */
  rects: (Rect | null)[];
  bounds: Rect;
}

/** Gap between pages in continuous mode, in points (about 6 mm). */
export const PAGE_GAP = 18;

/**
 * Continuous: pages stacked top to bottom, each centred on x = 0, with PAGE_GAP between.
 * Single: only `current` is laid out, at the origin.
 * Columns: pages fill rows of `columns`, left to right, in equal cells as wide as the widest
 * page (each page centred in its cell, at the top of its row), the grid centred on x = 0.
 */
export function computeLayout(sizes: PageSize[], mode: LayoutMode, current = 0, columns = MIN_COLUMNS): Layout {
  const rects: (Rect | null)[] = new Array(sizes.length).fill(null);
  if (sizes.length === 0) {
    return { mode, rects, bounds: { x: 0, y: 0, w: 1, h: 1 } };
  }
  if (mode === "single") {
    const i = Math.min(Math.max(0, current), sizes.length - 1);
    const s = sizes[i];
    const r = { x: -s.w / 2, y: 0, w: s.w, h: s.h };
    rects[i] = r;
    return { mode, rects, bounds: { ...r } };
  }
  if (mode === "columns") {
    const n = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.round(columns)));
    const cellW = Math.max(...sizes.map((s) => s.w));
    const cols = Math.min(n, sizes.length);
    const gridW = cols * cellW + (cols - 1) * PAGE_GAP;
    const x0 = -gridW / 2;
    let y = 0;
    for (let row = 0; row * n < sizes.length; row++) {
      let rowH = 0;
      for (let c = 0; c < n && row * n + c < sizes.length; c++) {
        const i = row * n + c;
        const s = sizes[i];
        rects[i] = { x: x0 + c * (cellW + PAGE_GAP) + (cellW - s.w) / 2, y, w: s.w, h: s.h };
        rowH = Math.max(rowH, s.h);
      }
      y += rowH + PAGE_GAP;
    }
    return { mode, rects, bounds: { x: x0, y: 0, w: gridW, h: y - PAGE_GAP } };
  }
  let y = 0;
  let maxW = 0;
  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i];
    rects[i] = { x: -s.w / 2, y, w: s.w, h: s.h };
    y += s.h + PAGE_GAP;
    maxW = Math.max(maxW, s.w);
  }
  return { mode, rects, bounds: { x: -maxW / 2, y: 0, w: maxW, h: y - PAGE_GAP } };
}

/**
 * Indices of laid-out pages intersecting the world rect `r`, in order. Pages are sorted
 * by y in continuous mode, so a binary search finds the first candidate; this keeps a
 * 300-page document cheap to query every frame.
 */
export function pagesInRect(layout: Layout, r: Rect): number[] {
  const out: number[] = [];
  const rects = layout.rects;
  if (layout.mode !== "continuous") {
    // Single page has one rect; columns has several per row, so the one-page-per-row binary
    // search below doesn't apply. A scan is cheap enough either way.
    rects.forEach((p, i) => {
      if (p && p.x < r.x + r.w && r.x < p.x + p.w && p.y < r.y + r.h && r.y < p.y + p.h) out.push(i);
    });
    return out;
  }
  // Binary search for the first page whose bottom is below r.y.
  let lo = 0;
  let hi = rects.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const p = rects[mid]!;
    if (p.y + p.h < r.y) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < rects.length; i++) {
    const p = rects[i]!;
    if (p.y > r.y + r.h) break;
    if (p.x < r.x + r.w && r.x < p.x + p.w && p.y + p.h >= r.y) out.push(i);
  }
  return out;
}

/** The page that owns the most of the visible rect (falls back to nearest by centre). */
export function currentPage(layout: Layout, visible: Rect): number {
  const candidates = pagesInRect(layout, visible);
  let best = -1;
  let bestArea = -1;
  for (const i of candidates) {
    const p = layout.rects[i]!;
    const w = Math.min(p.x + p.w, visible.x + visible.w) - Math.max(p.x, visible.x);
    const h = Math.min(p.y + p.h, visible.y + visible.h) - Math.max(p.y, visible.y);
    const a = Math.max(0, w) * Math.max(0, h);
    if (a > bestArea) {
      bestArea = a;
      best = i;
    }
  }
  if (best >= 0) return best;
  // Nothing visible: pick the page whose centre is nearest the viewport centre.
  const cy = visible.y + visible.h / 2;
  let nearest = 0;
  let d = Infinity;
  layout.rects.forEach((p, i) => {
    if (!p) return;
    const dd = Math.abs(p.y + p.h / 2 - cy);
    if (dd < d) {
      d = dd;
      nearest = i;
    }
  });
  return nearest;
}
