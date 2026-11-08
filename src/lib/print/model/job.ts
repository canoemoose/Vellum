// The print job as the Rust composer takes it (src-tauri/src/print/job.rs). Every layout,
// automatic or manual, ends up as one of these. Points, y down.

import type { Box } from "./geom";

/** A page (or image) that can be placed: what the model needs to know about its source. */
export interface PageRef {
  docId: number;
  /** Zero-based page; 0 for images. */
  page: number;
  /** File on disk (the composer reopens PDFs privately and reads images from here). */
  path: string;
  kind: "pdf" | "image";
  /** File name, for labels and the stamp. */
  title: string;
  /** Displayed page size in points (after the page's own /Rotate). */
  w: number;
  h: number;
  /** Drawing scale N of 1:N, or null when unknown. */
  drawingScale: number | null;
}

export interface JobItem {
  docId: number;
  page: number;
  path: string;
  srcW: number;
  srcH: number;
  crop: Box | null;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface JobLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
}

export interface JobText {
  x: number;
  y: number;
  size: number;
  text: string;
}

export interface JobSheet {
  w: number;
  h: number;
  items: JobItem[];
  clip: Box | null;
  lines: JobLine[];
  texts: JobText[];
}

export interface Job {
  sheets: JobSheet[];
}

export function jobItem(ref: PageRef, crop: Box | null, x: number, y: number, scale: number, rotation: number): JobItem {
  return { docId: ref.docId, page: ref.page, path: ref.path, srcW: ref.w, srcH: ref.h, crop, x, y, scale, rotation };
}

/** Four lines tracing a box (page borders). */
export function boxLines(b: Box, width = 0.5): JobLine[] {
  return [
    { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y0, width },
    { x0: b.x1, y0: b.y0, x1: b.x1, y1: b.y1, width },
    { x0: b.x1, y0: b.y1, x1: b.x0, y1: b.y1, width },
    { x0: b.x0, y0: b.y1, x1: b.x0, y1: b.y0, width },
  ];
}

export const STAMP_SIZE = 6;
/**
 * Height of the strip kept clear for the margin stamp at the bottom of the printable area.
 * The stamp lives inside the printable area (a printer's own margin can't be printed on), so
 * layouts shrink their content area by this much when the stamp is on.
 */
export const STAMP_STRIP = 10;

/** The content area once the stamp's strip is taken off the bottom. */
export function stampedArea(area: Box, stamp: boolean): Box {
  return stamp ? { ...area, y1: Math.max(area.y0 + 1, area.y1 - STAMP_STRIP) } : area;
}

/** The margin stamp: bottom-left of the printable area, baseline in the reserved strip. */
export function stampText(text: string, area: Box): JobText {
  return { x: area.x0 + 2, y: area.y1 - 2.5, size: STAMP_SIZE, text };
}

export function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
