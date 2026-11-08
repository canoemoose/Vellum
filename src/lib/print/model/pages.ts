// Which pages to print: page range parsing. Pure.

export type RangeResult = { ok: true; pages: number[] } | { ok: false; error: string };

/**
 * Parse "1-3, 7" (one-based, as typed) into zero-based page indices in the order given.
 * Accepts spaces, en dashes, open ends ("5-" to the last page, "-3" from the first) and
 * descending ranges ("5-3"). Duplicates are kept: printing a page twice is a choice.
 */
export function parseRange(text: string, numPages: number): RangeResult {
  const parts = text
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return { ok: false, error: "Enter pages, e.g. 1-3, 7" };
  const pages: number[] = [];
  for (const part of parts) {
    const m = /^(\d*)\s*[-–—]\s*(\d*)$/.exec(part);
    if (m) {
      if (!m[1] && !m[2]) return { ok: false, error: `"${part}" isn't a page range` };
      const a = m[1] ? parseInt(m[1], 10) : 1;
      const b = m[2] ? parseInt(m[2], 10) : numPages;
      if (a < 1 || b < 1 || a > numPages || b > numPages) {
        return { ok: false, error: `Pages run from 1 to ${numPages}` };
      }
      const step = a <= b ? 1 : -1;
      for (let p = a; step > 0 ? p <= b : p >= b; p += step) pages.push(p - 1);
    } else if (/^\d+$/.test(part)) {
      const p = parseInt(part, 10);
      if (p < 1 || p > numPages) return { ok: false, error: `Pages run from 1 to ${numPages}` };
      pages.push(p - 1);
    } else {
      return { ok: false, error: `"${part}" isn't a page number` };
    }
  }
  return { ok: true, pages };
}
