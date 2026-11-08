// Align, distribute and auto-arrange for the manual layout. Pure.

import { type Box, boxH, boxW, centreX } from "./geom";
import { type ManualItem, type ManualLayout, itemBox, areaOfLayout } from "./manual";

export type AlignMode = "left" | "centre" | "top";

function withSheet(l: ManualLayout, si: number, items: ManualItem[]): ManualLayout {
  return { ...l, sheets: l.sheets.map((s, i) => (i === si ? { ...s, items } : s)) };
}

/**
 * Align the selected items: left edges, horizontal centres or tops. Several items align to
 * each other (to the leftmost, the selection's centre, the topmost); a single item aligns to
 * the printable area.
 */
export function align(l: ManualLayout, si: number, ids: number[], mode: AlignMode): ManualLayout {
  const sheet = l.sheets[si];
  if (!sheet) return l;
  const sel = sheet.items.filter((it) => ids.includes(it.id));
  if (sel.length === 0) return l;
  const boxes = sel.map(itemBox);
  const ref: Box =
    sel.length === 1
      ? areaOfLayout(l)
      : {
          x0: Math.min(...boxes.map((b) => b.x0)),
          y0: Math.min(...boxes.map((b) => b.y0)),
          x1: Math.max(...boxes.map((b) => b.x1)),
          y1: Math.max(...boxes.map((b) => b.y1)),
        };
  const items = sheet.items.map((it) => {
    if (!ids.includes(it.id)) return it;
    const b = itemBox(it);
    if (mode === "left") return { ...it, x: ref.x0 };
    if (mode === "top") return { ...it, y: ref.y0 };
    return { ...it, x: centreX(ref) - boxW(b) / 2 };
  });
  return withSheet(l, si, items);
}

/**
 * Distribute horizontally: equal gaps between the selected items, the outermost two staying
 * put. With fewer than three selected, spread across the printable area instead (two items
 * go to its edges, one is centred).
 */
export function distributeH(l: ManualLayout, si: number, ids: number[]): ManualLayout {
  const sheet = l.sheets[si];
  if (!sheet) return l;
  const sel = sheet.items.filter((it) => ids.includes(it.id)).sort((a, b) => itemBox(a).x0 - itemBox(b).x0);
  if (sel.length === 0) return l;
  let x0: number;
  let x1: number;
  if (sel.length >= 3) {
    x0 = itemBox(sel[0]).x0;
    x1 = itemBox(sel[sel.length - 1]).x1;
  } else {
    const a = areaOfLayout(l);
    x0 = a.x0;
    x1 = a.x1;
  }
  const widths = sel.map((it) => boxW(itemBox(it)));
  const total = widths.reduce((s, w) => s + w, 0);
  const gap = sel.length > 1 ? (x1 - x0 - total) / (sel.length - 1) : 0;
  const pos = new Map<number, number>();
  if (sel.length === 1) {
    pos.set(sel[0].id, (x0 + x1) / 2 - widths[0] / 2);
  } else {
    let x = x0;
    sel.forEach((it, i) => {
      pos.set(it.id, x);
      x += widths[i] + gap;
    });
  }
  return withSheet(l, si, sheet.items.map((it) => (pos.has(it.id) ? { ...it, x: pos.get(it.id)! } : it)));
}

export const ARRANGE_GAP = 8;

interface Packed {
  fits: boolean;
  pos: { x: number; y: number }[];
  width: number;
  height: number;
}

/** Shelf packing: boxes (w, h) in order, left to right, wrapping rows, within aw x ah. */
export function shelfPack(sizes: { w: number; h: number }[], aw: number, ah: number, gap: number): Packed {
  const pos: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let width = 0;
  let fits = true;
  for (const s of sizes) {
    if (x > 0 && x + s.w > aw + 1e-6) {
      y += rowH + gap;
      x = 0;
      rowH = 0;
    }
    if (s.w > aw + 1e-6) fits = false;
    pos.push({ x, y });
    x += s.w + gap;
    rowH = Math.max(rowH, s.h);
    width = Math.max(width, x - gap);
  }
  const height = sizes.length ? y + rowH : 0;
  if (height > ah + 1e-6) fits = false;
  return { fits, pos, width, height };
}

/**
 * Auto-arrange a sheet: tallest first, packed in rows inside the printable area. Items keep
 * their scale when they fit; otherwise every item shrinks by the same factor (so relative
 * scales survive) until they do. The arrangement is centred in the area.
 */
export function autoArrange(l: ManualLayout, si: number, gap = ARRANGE_GAP): ManualLayout {
  const sheet = l.sheets[si];
  if (!sheet || sheet.items.length === 0) return l;
  const area = areaOfLayout(l);
  const aw = boxW(area);
  const ah = boxH(area);
  const order = [...sheet.items].sort((a, b) => boxH(itemBox(b)) - boxH(itemBox(a)) || a.id - b.id);
  const sizes = (k: number) => order.map((it) => ({ w: boxW(itemBox(it)) * k, h: boxH(itemBox(it)) * k }));
  let k = 1;
  let packed = shelfPack(sizes(1), aw, ah, gap);
  if (!packed.fits) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (shelfPack(sizes(mid), aw, ah, gap).fits) lo = mid;
      else hi = mid;
    }
    k = lo;
    packed = shelfPack(sizes(k), aw, ah, gap);
  }
  const ox = area.x0 + (aw - packed.width) / 2;
  const oy = area.y0 + (ah - packed.height) / 2;
  const placed = new Map<number, ManualItem>();
  order.forEach((it, i) => {
    placed.set(it.id, { ...it, scale: it.scale * k, x: ox + packed.pos[i].x, y: oy + packed.pos[i].y });
  });
  return withSheet(l, si, sheet.items.map((it) => placed.get(it.id)!));
}
