// Automatic layout for the print dialog: Fit, Actual, To scale, Tile and n-up, turned into
// sheets of placed items. Pure. The manual layout (manual.ts) is the other way to a Job.

import {
  type Box, type Margins, type Size, ZERO_MARGINS, areaOf, boxH, boxW, describeSize, effectiveRatio,
  factorForRatio, fmtPercent, fmtRatio, intersect, isLandscape, isoName, mmToPt, orient, ptToMm,
} from "./geom";
import { type Job, type JobLine, type JobSheet, type PageRef, boxLines, jobItem, stampText, stampedArea } from "./job";
import { type NUp, type PageOrder, type Sizing, nearestStandardRatio } from "./settings";

/** One thing to print: a page, or part of one (Pages > View / Marquee). */
export interface Source {
  ref: PageRef;
  crop: Box | null;
}

export interface AutoOptions {
  sizing: Exclude<Sizing, "manual">;
  fitTo: "printable" | "paper";
  scaleRatio: number;
  nUp: NUp;
  order: PageOrder;
  marginMode: "printer" | "none" | "custom";
  customMarginMm: number;
  centre: boolean;
  autoRotate: boolean;
  borders: boolean;
  tileOverlapMm: number;
  landscape: boolean;
  /** Print each page on the printer paper matching its own size, when there is one. */
  trayBySize: boolean;
  shrinkOversized: boolean;
  stamp: boolean;
}

export interface AutoInput {
  sources: Source[];
  /** The chosen paper, any orientation (it's re-oriented per sheet). Points. */
  paper: Size;
  /** The printer's unprintable margins for that paper, portrait and landscape. Points. */
  printerMargins: { portrait: Margins; landscape: Margins };
  /** Papers the printer has (points), for trayBySize. */
  papers?: Size[];
  /** For the stamp ("08/11/2026 19:12"). */
  date: string;
  options: AutoOptions;
}

export interface PlacedInfo {
  source: Source;
  /** Sheet points per page point. */
  factor: number;
  rotation: number;
  /** Where the placed item lands on the sheet (before clipping). */
  box: Box;
}

export interface SheetInfo {
  size: Size;
  /** The printable area (paper less margins). */
  area: Box;
  /** The area content was laid out in (less the stamp strip and cut mark bands). */
  contentArea: Box;
  placed: PlacedInfo[];
  /** Tiles: "A1" etc. */
  tile: string | null;
}

export interface AutoResult {
  job: Job;
  sheets: SheetInfo[];
}

/** Gap between cells in n-up. */
export const NUP_GAP = 6;
/** Band inside the printable area for tile cut marks. */
export const CUT_BAND = 8;
export const CUT_MARK_WIDTH = 0.3;

const contentSize = (s: Source): Size => (s.crop ? { w: boxW(s.crop), h: boxH(s.crop) } : { w: s.ref.w, h: s.ref.h });

export function marginsFor(input: AutoInput, landscape: boolean): Margins {
  const o = input.options;
  if (o.marginMode === "none") return ZERO_MARGINS;
  if (o.marginMode === "custom") {
    const m = mmToPt(o.customMarginMm);
    return { left: m, top: m, right: m, bottom: m };
  }
  return landscape ? input.printerMargins.landscape : input.printerMargins.portrait;
}

const fitFactor = (c: Size, b: Box): number => Math.min(boxW(b) / c.w, boxH(b) / c.h);

/** The paper a page goes on: its own size when tray-by-size finds a match, else the chosen one. */
export function paperFor(input: AutoInput, c: Size): Size {
  if (input.options.trayBySize && input.papers) {
    const match = input.papers.find((p) => {
      const a = [Math.min(p.w, p.h), Math.max(p.w, p.h)];
      const b = [Math.min(c.w, c.h), Math.max(c.w, c.h)];
      return Math.abs(ptToMm(a[0] - b[0])) <= 3 && Math.abs(ptToMm(a[1] - b[1])) <= 3;
    });
    if (match) return match;
  }
  return input.paper;
}

interface Frame {
  size: Size;
  area: Box;
  content: Box;
}

function frame(input: AutoInput, paper: Size, landscape: boolean): Frame {
  const size = orient(paper, landscape);
  const area = areaOf(size, marginsFor(input, landscape));
  return { size, area, content: stampedArea(area, input.options.stamp) };
}

/** The factor for one page under the chosen sizing (Fit / Actual / To scale). */
export function sizingFactor(o: AutoOptions, src: Source, fitBox: Box): number {
  const c = contentSize(src);
  const fit = fitFactor(c, fitBox);
  let f: number;
  switch (o.sizing) {
    case "fit":
      f = o.shrinkOversized ? Math.min(fit, 1) : fit;
      return f;
    case "scale":
      f = src.ref.drawingScale ? factorForRatio(src.ref.drawingScale, o.scaleRatio) : 1;
      break;
    default:
      f = 1;
  }
  return o.shrinkOversized ? Math.min(f, fit) : f;
}

function stampFor(input: AutoInput, src: Source[], extra = ""): string {
  const first = src[0]?.ref;
  if (!first) return "";
  const pages = src.map((s) => s.ref.page + 1);
  const sameDoc = src.every((s) => s.ref.docId === first.docId);
  const p = pages.length === 1 ? `p${pages[0]}` : sameDoc ? `p${pages[0]}-${pages[pages.length - 1]}` : `${pages.length} pages`;
  const title = sameDoc ? first.title : `${first.title} and others`;
  return [title, p, extra, input.date].filter((x) => x).join(" · ");
}

function finishSheet(input: AutoInput, fr: Frame, placed: PlacedInfo[], stamp: string, clip: Box | null, lines: JobLine[], tile: string | null): [JobSheet, SheetInfo] {
  const o = input.options;
  const items = placed.map((p) => jobItem(p.source.ref, p.source.crop, p.box.x0, p.box.y0, p.factor, p.rotation));
  const all = [...lines];
  if (o.borders) {
    for (const p of placed) {
      const b = intersect(p.box, clip ?? { x0: 0, y0: 0, x1: fr.size.w, y1: fr.size.h });
      if (b) all.push(...boxLines(b));
    }
  }
  const texts = o.stamp && stamp ? [stampText(stamp, fr.area)] : [];
  return [
    { w: fr.size.w, h: fr.size.h, items, clip, lines: all, texts },
    { size: fr.size, area: fr.area, contentArea: fr.content, placed, tile },
  ];
}

/** Place a box of size s in `b`: centred, or at its top-left. */
function position(s: Size, b: Box, centre: boolean): { x: number; y: number } {
  return centre ? { x: (b.x0 + b.x1 - s.w) / 2, y: (b.y0 + b.y1 - s.h) / 2 } : { x: b.x0, y: b.y0 };
}

function chooseLandscape(input: AutoInput, paper: Size, score: (landscape: boolean) => number): boolean {
  const o = input.options;
  if (!o.autoRotate || paper.w === paper.h) return o.landscape;
  const a = score(o.landscape);
  const b = score(!o.landscape);
  return b > a + 1e-9 ? !o.landscape : o.landscape;
}

function onePerSheet(input: AutoInput, src: Source): [JobSheet, SheetInfo] {
  const o = input.options;
  const c = contentSize(src);
  const paper = paperFor(input, c);
  const fitBoxOf = (fr: Frame): Box => (o.fitTo === "paper" ? stampedArea({ x0: 0, y0: 0, x1: fr.size.w, y1: fr.size.h }, o.stamp) : fr.content);
  // Auto-rotate: the orientation in which the page fits larger (what matters for Fit, and the
  // one that overflows least for Actual and To scale).
  const land = chooseLandscape(input, paper, (l) => fitFactor(c, fitBoxOf(frame(input, paper, l))));
  const fr = frame(input, paper, land);
  const fitBox = fitBoxOf(fr);
  const f = sizingFactor(o, src, fitBox);
  const s = { w: c.w * f, h: c.h * f };
  const { x, y } = position(s, fitBox, o.centre);
  const placed: PlacedInfo = { source: src, factor: f, rotation: 0, box: { x0: x, y0: y, x1: x + s.w, y1: y + s.h } };
  return finishSheet(input, fr, [placed], stampFor(input, [src]), null, [], null);
}

/** Columns and rows for n-up on a sheet of this orientation (more cells along the long side). */
export function nUpGrid(n: NUp, landscape: boolean): { cols: number; rows: number } {
  const g: Record<NUp, [number, number]> = { 1: [1, 1], 2: [2, 1], 4: [2, 2], 6: [3, 2], 9: [3, 3], 16: [4, 4] };
  const [a, b] = g[n];
  return landscape ? { cols: a, rows: b } : { cols: b, rows: a };
}

export function nUpCells(area: Box, n: NUp, landscape: boolean, order: PageOrder, gap = NUP_GAP): Box[] {
  const { cols, rows } = nUpGrid(n, landscape);
  const cw = (boxW(area) - gap * (cols - 1)) / cols;
  const ch = (boxH(area) - gap * (rows - 1)) / rows;
  const cells: Box[] = [];
  const cell = (c: number, r: number): Box => {
    const x0 = area.x0 + c * (cw + gap);
    const y0 = area.y0 + r * (ch + gap);
    return { x0, y0, x1: x0 + cw, y1: y0 + ch };
  };
  if (order === "across") {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(cell(c, r));
  } else {
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) cells.push(cell(c, r));
  }
  return cells;
}

function nUpSheet(input: AutoInput, group: Source[]): [JobSheet, SheetInfo] {
  const o = input.options;
  const paper = input.paper;
  const score = (l: boolean): number => {
    const fr = frame(input, paper, l);
    const cells = nUpCells(fr.content, o.nUp, l, o.order);
    return Math.min(...group.map((s, i) => bestInCell(contentSize(s), cells[i], o.autoRotate).f));
  };
  const land = chooseLandscape(input, paper, score);
  const fr = frame(input, paper, land);
  const cells = nUpCells(fr.content, o.nUp, land, o.order);
  const placed = group.map((src, i) => {
    const cell = cells[i];
    const c = contentSize(src);
    const best = bestInCell(c, cell, o.autoRotate);
    // In n-up every page fits its cell; Actual and To scale only shrink pages that don't.
    let f = best.f;
    if (o.sizing === "actual" || o.sizing === "scale" || o.shrinkOversized) {
      f = Math.min(sizingFactor({ ...o, shrinkOversized: false }, src, cell), best.f);
    }
    const rs = best.rotation % 180 === 90 ? { w: c.h * f, h: c.w * f } : { w: c.w * f, h: c.h * f };
    const { x, y } = position(rs, cell, o.centre);
    return { source: src, factor: f, rotation: best.rotation, box: { x0: x, y0: y, x1: x + rs.w, y1: y + rs.h } };
  });
  return finishSheet(input, fr, placed, stampFor(input, group), null, [], null);
}

function bestInCell(c: Size, cell: Box, autoRotate: boolean): { f: number; rotation: number } {
  const f0 = fitFactor(c, cell);
  if (!autoRotate) return { f: f0, rotation: 0 };
  const f90 = fitFactor({ w: c.h, h: c.w }, cell);
  return f90 > f0 + 1e-9 ? { f: f90, rotation: 90 } : { f: f0, rotation: 0 };
}

export interface TileGrid {
  cols: number;
  rows: number;
  /** Offset of the content's top-left from the first tile's top-left (centring). */
  offX: number;
  offY: number;
  stepX: number;
  stepY: number;
}

/** How a w x h picture tiles over areas of aw x ah with `overlap` shared between neighbours. */
export function tileGrid(w: number, h: number, aw: number, ah: number, overlap: number, centre: boolean): TileGrid {
  const ov = Math.max(0, Math.min(overlap, Math.min(aw, ah) / 2));
  const stepX = aw - ov;
  const stepY = ah - ov;
  const cols = w <= aw + 1e-6 ? 1 : Math.ceil((w - ov) / stepX - 1e-9);
  const rows = h <= ah + 1e-6 ? 1 : Math.ceil((h - ov) / stepY - 1e-9);
  const totalW = cols * stepX + ov;
  const totalH = rows * stepY + ov;
  return { cols, rows, stepX, stepY, offX: centre ? (totalW - w) / 2 : 0, offY: centre ? (totalH - h) / 2 : 0 };
}

/** Row letter(s) for tile labels: A..Z, AA... */
export function tileName(col: number, row: number): string {
  let r = row;
  let s = "";
  do {
    s = String.fromCharCode(65 + (r % 26)) + s;
    r = Math.floor(r / 26) - 1;
  } while (r >= 0);
  return `${s}${col + 1}`;
}

/** Crop marks at the corners of `b`, reaching `len` outwards with a small gap. */
export function cutMarks(b: Box, len = CUT_BAND - 1, gap = 1): JobLine[] {
  const w = CUT_MARK_WIDTH;
  const L: JobLine[] = [];
  for (const x of [b.x0, b.x1]) {
    for (const y of [b.y0, b.y1]) {
      const dx = x === b.x0 ? -1 : 1;
      const dy = y === b.y0 ? -1 : 1;
      L.push({ x0: x + dx * gap, y0: y, x1: x + dx * len, y1: y, width: w });
      L.push({ x0: x, y0: y + dy * gap, x1: x, y1: y + dy * len, width: w });
    }
  }
  return L;
}

function inset(b: Box, d: number): Box {
  return { x0: b.x0 + d, y0: b.y0 + d, x1: Math.max(b.x0 + d + 1, b.x1 - d), y1: Math.max(b.y0 + d + 1, b.y1 - d) };
}

function tileFrame(input: AutoInput, paper: Size, landscape: boolean): Frame {
  const size = orient(paper, landscape);
  const area = areaOf(size, marginsFor(input, landscape));
  return { size, area, content: stampedArea(inset(area, CUT_BAND), input.options.stamp) };
}

function tiles(input: AutoInput, src: Source): [JobSheet, SheetInfo][] {
  const o = input.options;
  const c = contentSize(src);
  const f = sizingFactor({ ...o, sizing: o.sizing === "tile" ? "actual" : o.sizing, shrinkOversized: false }, src, { x0: 0, y0: 0, x1: 1, y1: 1 });
  const W = c.w * f;
  const H = c.h * f;
  const ov = mmToPt(o.tileOverlapMm);
  const gridFor = (l: boolean) => {
    const fr = tileFrame(input, input.paper, l);
    return tileGrid(W, H, boxW(fr.content), boxH(fr.content), ov, o.centre);
  };
  const land = chooseLandscape(input, input.paper, (l) => {
    const g = gridFor(l);
    return -(g.cols * g.rows);
  });
  const fr = tileFrame(input, input.paper, land);
  const g = gridFor(land);
  const out: [JobSheet, SheetInfo][] = [];
  for (let r = 0; r < g.rows; r++) {
    for (let col = 0; col < g.cols; col++) {
      const x = fr.content.x0 + g.offX - col * g.stepX;
      const y = fr.content.y0 + g.offY - r * g.stepY;
      const placed: PlacedInfo = { source: src, factor: f, rotation: 0, box: { x0: x, y0: y, x1: x + W, y1: y + H } };
      const name = tileName(col, r);
      const label = g.cols * g.rows > 1 ? `tile ${name} of ${g.rows}×${g.cols}` : "";
      out.push(finishSheet(input, fr, [placed], stampFor(input, [src], label), fr.content, cutMarks(fr.content), name));
    }
  }
  return out;
}

/** Lay out every source onto sheets under the dialog's settings. */
export function autoLayout(input: AutoInput): AutoResult {
  const o = input.options;
  const pairs: [JobSheet, SheetInfo][] = [];
  if (o.sizing === "tile") {
    for (const s of input.sources) pairs.push(...tiles(input, s));
  } else if (o.nUp > 1) {
    for (let i = 0; i < input.sources.length; i += o.nUp) pairs.push(nUpSheet(input, input.sources.slice(i, i + o.nUp)));
  } else {
    for (const s of input.sources) pairs.push(onePerSheet(input, s));
  }
  return { job: { sheets: pairs.map((p) => p[0]) }, sheets: pairs.map((p) => p[1]) };
}

/**
 * The info line under Sizing: what Fit (or the chosen sizing) means in scale terms, e.g.
 * "A1 on A3 prints at 1:206. Choose "To scale" for exactly 1:200." Null when there's
 * nothing useful to say.
 */
export function sizingInfo(o: AutoOptions, sheet: SheetInfo | undefined): string | null {
  const p = sheet?.placed[0];
  if (!sheet || !p) return null;
  const ref = p.source.ref;
  const pageName = isoName({ w: ref.w, h: ref.h }) ?? "The page";
  const paperName = isoName(sheet.size) ?? describeSize(sheet.size);
  const on = `${pageName} on ${paperName}`;
  const n = ref.drawingScale;
  if (o.sizing === "tile") {
    return null;
  }
  if (o.sizing === "scale") {
    if (!n) return "The drawing scale isn't known, so To scale prints at 100%. Set it from Document > Drawing scale.";
    const ow = boxW(p.box) - boxW(sheet.contentArea);
    const oh = boxH(p.box) - boxH(sheet.contentArea);
    const over = Math.max(ow, oh);
    if (over > 0.5) {
      // A little over is normal for "A1 at 1:200 on A3": the drawing's own border margin goes.
      const rel = Math.max(ow / boxW(sheet.contentArea), oh / boxH(sheet.contentArea));
      if (rel < 0.08) {
        return `At ${fmtRatio(o.scaleRatio)} the page is ${Math.ceil(ptToMm(over))} mm bigger than the printable area, so its outer edge may not print.`;
      }
      return `At ${fmtRatio(o.scaleRatio)} the page is bigger than the printable area. Choose Tile, or a smaller scale.`;
    }
    return `${on} prints at exactly ${fmtRatio(effectiveRatio(n, p.factor))}.`;
  }
  if (n) {
    const eff = effectiveRatio(n, p.factor);
    if (Math.abs(eff - n) / n < 0.005) return `${on} prints at ${fmtRatio(eff)}, the drawing's own scale.`;
    const std = nearestStandardRatio(eff);
    const hint = fmtRatio(std) !== fmtRatio(eff) ? ` Choose “To scale” for exactly ${fmtRatio(std)}.` : "";
    return `${on} prints at ${fmtRatio(eff)}.${hint}`;
  }
  if (o.sizing === "fit") return `${on} prints at ${fmtPercent(p.factor)} of actual size.`;
  return null;
}

/** Short descriptions for the collapsed section headers. */
export function layoutSummary(o: AutoOptions): string {
  const per = `${o.nUp} per sheet`;
  const m = o.marginMode === "printer" ? "printer margins" : o.marginMode === "none" ? "no margins" : `${o.customMarginMm} mm margins`;
  const extras = [o.centre ? "centred" : null, o.borders ? "borders" : null, o.sizing === "tile" ? "tiled" : null].filter(Boolean);
  return [per, m, ...extras].join(" · ");
}

export { isLandscape };
