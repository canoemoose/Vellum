// Small formatting and parsing helpers for the toolbar, recent files and export dialog.

import { MAX_ZOOM, MIN_ZOOM } from "../view/viewMath";

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
 * indices, ascending and unique. An empty string means every page. Returns an error message
 * for the UI when it doesn't parse or is out of range.
 */
export function parsePageRange(s: string, n: number): number[] | string {
  const t = s.trim();
  if (!t) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>();
  for (const part of t.split(/[,;]+/)) {
    const p = part.trim();
    if (!p) continue;
    const m = /^(\d+)\s*(?:[-–]\s*(\d+)?)?$/.exec(p);
    if (!m) return `"${p}" isn't a page or a range`;
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : p.includes("-") || p.includes("–") ? n : a;
    if (a < 1 || b < 1 || a > n || b > n) return `Pages run from 1 to ${n}`;
    if (b < a) return `"${p}" runs backwards`;
    for (let i = a; i <= b; i++) out.add(i - 1);
  }
  if (!out.size) return "No pages chosen";
  return [...out].sort((x, y) => x - y);
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
