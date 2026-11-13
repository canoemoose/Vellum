// Small formatting and parsing helpers for the toolbar, recent files and export dialog.

import { MAX_ZOOM, MIN_ZOOM } from "../view/viewMath";
import { pageSet } from "../print/model/pages";

/** Toolbar zoom text: "212%", "8.5%" below 10%. */
export function formatZoom(zoom: number): string {
  const pct = zoom * 100;
  if (pct < 10) return `${(Math.round(pct * 10) / 10).toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

/** Parse a typed zoom ("150", "150%", "1.5x"); clamped to the viewer's range. Null if unusable. */
export function parseZoom(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/\s+/g, "").replace(",", ".");
  let m = /^(\d+(?:\.\d+)?)%?$/.exec(t);
  let z: number;
  if (m) z = Number(m[1]) / 100;
  else if ((m = /^(\d+(?:\.\d+)?)x$/.exec(t))) z = Number(m[1]);
  else return null;
  if (!Number.isFinite(z) || z <= 0) return null;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Add a path to the front of the recent list (deduplicated, case-insensitive), capped. */
export function addRecent(list: string[], path: string, max = 10): string[] {
  const k = path.toLowerCase();
  return [path, ...list.filter((p) => p.toLowerCase() !== k)].slice(0, max);
}

export function removeRecent(list: string[], path: string): string[] {
  const k = path.toLowerCase();
  return list.filter((p) => p.toLowerCase() !== k);
}

/**
 * Parse a page range like "1-3, 7" against a document of `n` pages into zero-based page
 * indices, ascending and unique (export). An empty string means every page. Returns the
 * message for the UI when it doesn't parse. The one parser is print/model/pages.ts.
 */
export function parsePageRange(s: string, n: number): number[] | string {
  const r = pageSet(s, n);
  return r.ok ? r.pages : r.error;
}

/** "12.4 MB", "830 KB". */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}

/** File name for an exported page: "Plan p03.png" (zero-padded to the page count's width). */
export function exportFileName(docName: string, page: number, numPages: number, ext: "png" | "jpg"): string {
  const base = docName.replace(/\.[^.\\/]+$/, "");
  const width = String(numPages).length;
  return `${base} p${String(page + 1).padStart(width, "0")}.${ext}`;
}

/** Joins a folder and a file name with a Windows separator. */
export function joinPath(dir: string, name: string): string {
  return dir.replace(/[\\/]+$/, "") + "\\" + name;
}
