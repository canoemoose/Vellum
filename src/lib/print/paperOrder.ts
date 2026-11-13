// The order printer papers are offered in. Drivers list dozens of sizes in their own order
// (US, Japanese, envelopes, photo); Vellum's users print on A sizes, so those come first, largest
// first, and everything else follows under "Other sizes" in the driver's order.

import { isoName, mmToPt } from "./model/geom";

/** The A size a paper is (A0 to A6, either way round, within 2 mm), or null. */
export function aSize(p: { w: number; h: number }): number | null {
  const n = isoName({ w: mmToPt(p.w), h: mmToPt(p.h) });
  const m = n ? /^A(\d)$/.exec(n) : null;
  return m ? Number(m[1]) : null;
}

/** Papers split into A sizes (A0 first; the driver's order within a size) and the rest. */
export function groupPapers<T extends { w: number; h: number }>(papers: T[]): { a: T[]; other: T[] } {
  const a: { p: T; n: number; i: number }[] = [];
  const other: T[] = [];
  papers.forEach((p, i) => {
    const n = aSize(p);
    if (n === null) other.push(p);
    else a.push({ p, n, i });
  });
  a.sort((x, y) => x.n - y.n || x.i - y.i);
  return { a: a.map((x) => x.p), other };
}
