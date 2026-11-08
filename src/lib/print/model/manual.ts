// The manual print layout: sheets with freely placed pages, crops, scales and rotations.
// Pure: every operation returns a new layout and leaves its input alone, so the editor can
// keep an undo-free, easily tested model and Svelte just reassigns.

import {
  type Box, type Margins, type Rotation, type Size, areaOf, box, boxH, boxW, centreX, centreY, describeSize,
  effectiveRatio, factorForRatio, fmtPercent, fmtRatio, intersect, isoName, overlaps, quarter, rotatedSize,
} from "./geom";
import { type Job, type JobLine, type JobText, type PageRef, boxLines, jobItem, stampText } from "./job";
import { nextStandardRatio } from "./settings";

export interface ManualItem {
  id: number;
  ref: PageRef;
  /** Part of the page shown, displayed page points (y down); null for the whole page. */
  crop: Box | null;
  /** Top-left of the placed box on the sheet. */
  x: number;
  y: number;
  /** Sheet points per page point. */
  scale: number;
  rotation: Rotation;
  border: boolean;
  /** Print the scale label ("p3 · 1:200") with the item. */
  label: boolean;
}

export interface ManualSheet {
  id: number;
  items: ManualItem[];
}

export interface ManualLayout {
  /** Sheet size in points, oriented. */
  paper: Size;
  /** The margins in force (resolved to points by the dialog). */
  margins: Margins;
  sheets: ManualSheet[];
  nextId: number;
}

export function emptyLayout(paper: Size, margins: Margins): ManualLayout {
  return { paper, margins, sheets: [{ id: 1, items: [] }], nextId: 2 };
}

export const areaOfLayout = (l: ManualLayout): Box => areaOf(l.paper, l.margins);

/** The displayed size of what an item shows (its crop or whole page), before scaling. */
export function shownSize(it: Pick<ManualItem, "ref" | "crop">): Size {
  return it.crop ? { w: boxW(it.crop), h: boxH(it.crop) } : { w: it.ref.w, h: it.ref.h };
}

export function itemBox(it: ManualItem): Box {
  const s = rotatedSize(shownSize(it), it.rotation);
  return { x0: it.x, y0: it.y, x1: it.x + s.w * it.scale, y1: it.y + s.h * it.scale };
}

/** A point on the displayed page (y down) to the sheet, through this item's placement. */
export function pageToSheet(it: ManualItem, px: number, py: number): [number, number] {
  const c = it.crop ?? { x0: 0, y0: 0, x1: it.ref.w, y1: it.ref.h };
  const cw = boxW(c);
  const ch = boxH(c);
  const u = px - c.x0;
  const v = py - c.y0;
  let rx: number;
  let ry: number;
  switch (it.rotation) {
    case 90:
      [rx, ry] = [ch - v, u];
      break;
    case 180:
      [rx, ry] = [cw - u, ch - v];
      break;
    case 270:
      [rx, ry] = [v, cw - u];
      break;
    default:
      [rx, ry] = [u, v];
  }
  return [it.x + rx * it.scale, it.y + ry * it.scale];
}

/** Inverse of pageToSheet. */
export function sheetToPage(it: ManualItem, sx: number, sy: number): [number, number] {
  const c = it.crop ?? { x0: 0, y0: 0, x1: it.ref.w, y1: it.ref.h };
  const cw = boxW(c);
  const ch = boxH(c);
  const rx = (sx - it.x) / it.scale;
  const ry = (sy - it.y) / it.scale;
  let u: number;
  let v: number;
  switch (it.rotation) {
    case 90:
      [u, v] = [ry, ch - rx];
      break;
    case 180:
      [u, v] = [cw - rx, ch - ry];
      break;
    case 270:
      [u, v] = [cw - ry, rx];
      break;
    default:
      [u, v] = [rx, ry];
  }
  return [c.x0 + u, c.y0 + v];
}

/** Where the whole page would be on the sheet with this item's placement (crop handles' limit). */
export function fullPageBox(it: ManualItem): Box {
  const a = pageToSheet(it, 0, 0);
  const b = pageToSheet(it, it.ref.w, it.ref.h);
  return box(a[0], a[1], b[0], b[1]);
}

const mapSheet = (l: ManualLayout, si: number, f: (s: ManualSheet) => ManualSheet): ManualLayout => ({
  ...l,
  sheets: l.sheets.map((s, i) => (i === si ? f(s) : s)),
});

const mapItem = (l: ManualLayout, si: number, id: number, f: (it: ManualItem) => ManualItem): ManualLayout =>
  mapSheet(l, si, (s) => ({ ...s, items: s.items.map((it) => (it.id === id ? f(it) : it)) }));

export function findItem(l: ManualLayout, si: number, id: number): ManualItem | undefined {
  return l.sheets[si]?.items.find((it) => it.id === id);
}

/**
 * A sensible first scale for a new item: 100% if it fits the printable area, else the
 * largest that fits, rounded down to a standard drawing scale when the page has one.
 */
export function defaultScale(ref: PageRef, crop: Box | null, area: Box): number {
  const s = crop ? { w: boxW(crop), h: boxH(crop) } : { w: ref.w, h: ref.h };
  const fit = Math.min(boxW(area) / s.w, boxH(area) / s.h);
  if (fit >= 1) return 1;
  if (ref.drawingScale) {
    const std = nextStandardRatio(effectiveRatio(ref.drawingScale, fit));
    if (std) return factorForRatio(ref.drawingScale, std);
  }
  return fit;
}

/** First free top-left for a w x h box in the area, scanning in 5 mm steps; null if none. */
export function freeSpot(area: Box, taken: Box[], w: number, h: number, step = 14.17): { x: number; y: number } | null {
  for (let y = area.y0; y + h <= area.y1 + 1e-6; y += step) {
    for (let x = area.x0; x + w <= area.x1 + 1e-6; x += step) {
      const b = { x0: x, y0: y, x1: x + w, y1: y + h };
      if (!taken.some((t) => overlaps(t, b))) return { x, y };
    }
  }
  return null;
}

/**
 * Add a page to a sheet. With `at`, the item is centred there (a drop); otherwise it goes in
 * the first free spot, or the area's top-left if the sheet is full. Returns the layout and
 * the new item's id.
 */
export function addItem(l: ManualLayout, si: number, ref: PageRef, opts: { crop?: Box | null; at?: { x: number; y: number }; scale?: number } = {}): { layout: ManualLayout; id: number } {
  const area = areaOfLayout(l);
  const crop = opts.crop ?? null;
  const scale = opts.scale ?? defaultScale(ref, crop, area);
  const s = shownSize({ ref, crop });
  const w = s.w * scale;
  const h = s.h * scale;
  let x: number;
  let y: number;
  if (opts.at) {
    x = opts.at.x - w / 2;
    y = opts.at.y - h / 2;
  } else {
    const spot = freeSpot(area, (l.sheets[si]?.items ?? []).map(itemBox), w, h);
    x = spot?.x ?? area.x0;
    y = spot?.y ?? area.y0;
  }
  const id = l.nextId;
  const item: ManualItem = { id, ref, crop, x, y, scale, rotation: 0, border: false, label: true };
  const out = mapSheet({ ...l, nextId: id + 1 }, si, (sh) => ({ ...sh, items: [...sh.items, item] }));
  return { layout: out, id };
}

export function removeItem(l: ManualLayout, si: number, id: number): ManualLayout {
  return mapSheet(l, si, (s) => ({ ...s, items: s.items.filter((it) => it.id !== id) }));
}

export function updateItem(l: ManualLayout, si: number, id: number, patch: Partial<Omit<ManualItem, "id" | "ref">>): ManualLayout {
  return mapItem(l, si, id, (it) => ({ ...it, ...patch }));
}

export function moveItem(l: ManualLayout, si: number, id: number, x: number, y: number): ManualLayout {
  return updateItem(l, si, id, { x, y });
}

/** Change an item's scale, keeping its centre where it is. */
export function setScale(l: ManualLayout, si: number, id: number, scale: number): ManualLayout {
  if (!(scale > 0) || !isFinite(scale)) return l;
  return mapItem(l, si, id, (it) => {
    const b = itemBox(it);
    const n = { ...it, scale };
    const nb = itemBox(n);
    return { ...n, x: centreX(b) - boxW(nb) / 2, y: centreY(b) - boxH(nb) / 2 };
  });
}

/** Scale an item so a 1:`drawing` page prints at 1:`target`; no-op without a drawing scale. */
export function setRatio(l: ManualLayout, si: number, id: number, target: number): ManualLayout {
  const it = findItem(l, si, id);
  if (!it?.ref.drawingScale || !(target > 0)) return l;
  return setScale(l, si, id, factorForRatio(it.ref.drawingScale, target));
}

/** Rotate to an absolute quarter turn, keeping the centre. */
export function setRotation(l: ManualLayout, si: number, id: number, rotation: number): ManualLayout {
  return mapItem(l, si, id, (it) => {
    const b = itemBox(it);
    const n = { ...it, rotation: quarter(rotation) };
    const nb = itemBox(n);
    return { ...n, x: centreX(b) - boxW(nb) / 2, y: centreY(b) - boxH(nb) / 2 };
  });
}

export type Corner = "nw" | "ne" | "sw" | "se";

/**
 * Drag a corner to scale: the opposite corner stays put and the aspect ratio is kept; the
 * scale follows whichever axis the pointer has moved further.
 */
export function scaleFromCorner(it: ManualItem, corner: Corner, px: number, py: number, minSize = 7): ManualItem {
  const b = itemBox(it);
  const ax = corner === "nw" || corner === "sw" ? b.x1 : b.x0;
  const ay = corner === "nw" || corner === "ne" ? b.y1 : b.y0;
  const base = rotatedSize(shownSize(it), it.rotation);
  const fx = Math.abs(px - ax) / base.w;
  const fy = Math.abs(py - ay) / base.h;
  const scale = Math.max(fx, fy, minSize / Math.min(base.w, base.h));
  const w = base.w * scale;
  const h = base.h * scale;
  const x = corner === "nw" || corner === "sw" ? ax - w : ax;
  const y = corner === "nw" || corner === "ne" ? ay - h : ay;
  return { ...it, scale, x, y };
}

export type Edge = "left" | "right" | "top" | "bottom";

/**
 * Crop by dragging an edge of the placed box to sheet coordinate `v`. The content doesn't
 * move: only what shows changes. The edge can't go past the page's own edge, nor closer
 * than `minSize` points (sheet) to the opposite edge.
 */
export function cropFromEdge(it: ManualItem, edge: Edge, v: number, minSize = 7): ManualItem {
  const b = itemBox(it);
  const full = fullPageBox(it);
  const nb = { ...b };
  if (edge === "left") nb.x0 = Math.min(Math.max(v, full.x0), b.x1 - minSize);
  if (edge === "right") nb.x1 = Math.max(Math.min(v, full.x1), b.x0 + minSize);
  if (edge === "top") nb.y0 = Math.min(Math.max(v, full.y0), b.y1 - minSize);
  if (edge === "bottom") nb.y1 = Math.max(Math.min(v, full.y1), b.y0 + minSize);
  return cropToSheetBox(it, nb);
}

/** Show exactly the part of the page under sheet box `sb` (clamped to the page), in place. */
export function cropToSheetBox(it: ManualItem, sb: Box): ManualItem {
  const clamped = intersect(sb, fullPageBox(it));
  if (!clamped) return it;
  const a = sheetToPage(it, clamped.x0, clamped.y0);
  const c = sheetToPage(it, clamped.x1, clamped.y1);
  const crop = box(a[0], a[1], c[0], c[1]);
  const whole = crop.x0 <= 1e-6 && crop.y0 <= 1e-6 && crop.x1 >= it.ref.w - 1e-6 && crop.y1 >= it.ref.h - 1e-6;
  return { ...it, crop: whole ? null : crop, x: clamped.x0, y: clamped.y0 };
}

/** Set a crop in page coordinates (Crop to a region...), keeping the item's centre. */
export function setCrop(it: ManualItem, crop: Box | null): ManualItem {
  const b = itemBox(it);
  const c = crop ? intersect(crop, { x0: 0, y0: 0, x1: it.ref.w, y1: it.ref.h }) : null;
  const n = { ...it, crop: c };
  const nb = itemBox(n);
  return { ...n, x: centreX(b) - boxW(nb) / 2, y: centreY(b) - boxH(nb) / 2 };
}

/** Reset the crop so the content stays where it was (the page grows around it). */
export function resetCrop(it: ManualItem): ManualItem {
  if (!it.crop) return it;
  const full = fullPageBox(it);
  return { ...it, crop: null, x: full.x0, y: full.y0 };
}

// ---- Sheets ----

export function addSheet(l: ManualLayout): ManualLayout {
  return { ...l, sheets: [...l.sheets, { id: l.nextId, items: [] }], nextId: l.nextId + 1 };
}

export function removeSheet(l: ManualLayout, si: number): ManualLayout {
  if (l.sheets.length <= 1) return clearSheet(l, 0);
  return { ...l, sheets: l.sheets.filter((_, i) => i !== si) };
}

export function clearSheet(l: ManualLayout, si: number): ManualLayout {
  return mapSheet(l, si, (s) => ({ ...s, items: [] }));
}

/** Copy a sheet (new ids) and insert it after the original. */
export function duplicateSheet(l: ManualLayout, si: number): ManualLayout {
  const src = l.sheets[si];
  if (!src) return l;
  let next = l.nextId;
  const copy: ManualSheet = { id: next++, items: src.items.map((it) => ({ ...it, id: next++ })) };
  const sheets = [...l.sheets];
  sheets.splice(si + 1, 0, copy);
  return { ...l, sheets, nextId: next };
}

/** Change the paper or margins; items stay where they are. */
export function setPaper(l: ManualLayout, paper: Size, margins: Margins): ManualLayout {
  return { ...l, paper, margins };
}

/** Pages already placed somewhere in the layout, as "docId:page" keys (the strip's dots). */
export function placedKeys(l: ManualLayout): Set<string> {
  const s = new Set<string>();
  for (const sh of l.sheets) for (const it of sh.items) s.add(`${it.ref.docId}:${it.ref.page}`);
  return s;
}

// ---- Labels ----

/** "p3 · 1:200", "p7 · 48%", "p9 crop · 1:20", "Truss.jpg · 48%". */
export function scaleLabel(it: ManualItem): string {
  const name = it.ref.kind === "image" ? it.ref.title : `p${it.ref.page + 1}`;
  const crop = it.crop ? " crop" : "";
  const sc = it.ref.drawingScale ? fmtRatio(effectiveRatio(it.ref.drawingScale, it.scale)) : fmtPercent(it.scale);
  return `${name}${crop} · ${sc}`;
}

/** "Stage plan.pdf · source A1, 1:100" */
export function sourceDescription(ref: PageRef): string {
  const size = isoName({ w: ref.w, h: ref.h }) ?? describeSize({ w: ref.w, h: ref.h });
  const sc = ref.drawingScale ? `, ${fmtRatio(ref.drawingScale)}` : "";
  return `${ref.title} · source ${size}${sc}`;
}

// ---- Output ----

export const LABEL_SIZE = 5;

/** Approximate Helvetica width (for right-aligning a label without font metrics). */
export const approxTextWidth = (text: string, size: number): number => text.length * size * 0.52;

export function labelText(it: ManualItem, area: Box): JobText {
  const b = itemBox(it);
  const text = scaleLabel(it);
  const w = approxTextWidth(text, LABEL_SIZE);
  const below = b.y1 + LABEL_SIZE + 1.5 <= area.y1;
  return { x: Math.max(b.x0, b.x1 - w), y: below ? b.y1 + LABEL_SIZE + 0.5 : b.y1 - 2, size: LABEL_SIZE, text };
}

export interface StampInfo {
  enabled: boolean;
  /** Document title for the stamp (the first item's file when omitted). */
  title?: string;
  date: string;
}

export function sheetStamp(l: ManualLayout, si: number, stamp: StampInfo): string {
  const first = l.sheets[si]?.items[0]?.ref.title;
  const title = stamp.title ?? first ?? "";
  return [title, `sheet ${si + 1}`, stamp.date].filter((x) => x).join(" · ");
}

/** The job for the composer. Empty sheets are left out. */
export function manualToJob(l: ManualLayout, stamp: StampInfo): Job {
  const area = areaOfLayout(l);
  const sheets = l.sheets
    .map((s, si) => ({ s, si }))
    .filter(({ s }) => s.items.length > 0)
    .map(({ s, si }) => {
      const lines: JobLine[] = [];
      const texts: JobText[] = [];
      for (const it of s.items) {
        if (it.border) lines.push(...boxLines(itemBox(it)));
        if (it.label) texts.push(labelText(it, area));
      }
      if (stamp.enabled) texts.push(stampText(sheetStamp(l, si, stamp), area));
      return {
        w: l.paper.w,
        h: l.paper.h,
        items: s.items.map((it) => jobItem(it.ref, it.crop, it.x, it.y, it.scale, it.rotation)),
        clip: null,
        lines,
        texts,
      };
    });
  return { sheets };
}

export const sheetCount = (l: ManualLayout): number => l.sheets.filter((s) => s.items.length > 0).length;
