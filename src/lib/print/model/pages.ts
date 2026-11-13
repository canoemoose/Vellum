// Which pages: page range parsing, the one parser for print and export. Pure.

export type RangeResult = { ok: true; pages: number[] } | { ok: false; error: string };

/** The one message for a range that can't be read. */
export const RANGE_HELP = "Use page numbers and ranges, such as 1-3, 7.";

/**
 * Parse "1-3, 7" (one-based, as typed) into zero-based page indices in the order given.
 * Empty means every page. Accepts spaces, en dashes, open ends ("5-" to the last page, "-3"
 * from the first) and descending ranges ("5-3"). Duplicates are kept: printing a page twice
 * is a choice (export takes each page once: pageSet).
 */
export function parseRange(text: string, numPages: number): RangeResult {
  const parts = text
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return { ok: true, pages: Array.from({ length: numPages }, (_, i) => i) };
  const outOfRange: RangeResult = { ok: false, error: `Pages run from 1 to ${numPages}.` };
  const pages: number[] = [];
  for (const part of parts) {
    const m = /^(\d*)\s*[-–—]\s*(\d*)$/.exec(part);
    if (m) {
      if (!m[1] && !m[2]) return { ok: false, error: RANGE_HELP };
      const a = m[1] ? parseInt(m[1], 10) : 1;
      const b = m[2] ? parseInt(m[2], 10) : numPages;
      if (a < 1 || b < 1 || a > numPages || b > numPages) return outOfRange;
      const step = a <= b ? 1 : -1;
      for (let p = a; step > 0 ? p <= b : p >= b; p += step) pages.push(p - 1);
    } else if (/^\d+$/.test(part)) {
      const p = parseInt(part, 10);
      if (p < 1 || p > numPages) return outOfRange;
      pages.push(p - 1);
    } else {
      return { ok: false, error: RANGE_HELP };
    }
  }
  return { ok: true, pages };
}

/** The pages a range names, each once, in page order (export). */
export function pageSet(text: string, numPages: number): RangeResult {
  const r = parseRange(text, numPages);
  return r.ok ? { ok: true, pages: [...new Set(r.pages)].sort((a, b) => a - b) } : r;
}
