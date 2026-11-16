// Links on a page: which one is under the pointer, what to show for it, whether to follow it.
// Pure.

import type { TextLink } from "./layer";
import { distToBox } from "./hit";

/** The link under (x, y) in page points, within `tol` points; the closest if several. */
export function linkAt(links: TextLink[], x: number, y: number, tol = 0): TextLink | null {
  let best: TextLink | null = null;
  let bestD = Infinity;
  for (const l of links) {
    for (const r of l.rects) {
      const d = distToBox(x, y, r);
      if (d <= tol && d < bestD) {
        best = l;
        bestD = d;
      }
    }
  }
  return best;
}

/**
 * Mirrors safe_url in src-tauri/src/shell.rs: only http, https and mailto, nothing with spaces
 * or control characters, at most 2048 characters.
 */
export function followableUrl(url: string | null): string | null {
  if (!url) return null;
  const u = url.trim();
  if (!u || u.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(u)) return null;
  const lower = u.toLowerCase();
  const ok =
    (lower.startsWith("http://") && lower.length > 7) ||
    (lower.startsWith("https://") && lower.length > 8) ||
    (lower.startsWith("mailto:") && lower.length > 7);
  return ok ? u : null;
}

/** What the status bar says while the pointer is on a link. */
export function linkLabel(l: TextLink, numPages: number): string {
  if (l.page !== null && l.page < numPages) return `Go to page ${l.page + 1}`;
  const url = followableUrl(l.uri);
  if (url) return url.toLowerCase().startsWith("mailto:") ? `Email ${url.slice(7)}` : `Open ${url}`;
  return l.uri ? `Link not followed: ${l.uri.slice(0, 80)}` : "";
}
