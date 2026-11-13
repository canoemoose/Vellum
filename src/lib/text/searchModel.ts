// Search results across a document, in document order, as pages report in. Pure.

import type { Box } from "./layer";

export interface SearchHit {
  page: number;
  /** First character (PDFium index) and length. */
  index: number;
  count: number;
  rects: Box[];
  /** Context for the results list, on one line. */
  before: string;
  text: string;
  after: string;
}

/** One page's answer from the backend (doc_search_page). */
export interface PageHits {
  chars: number;
  hits: Omit<SearchHit, "page">[];
  truncated: boolean;
}

export interface SearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

/** The order to search pages in: the current page, on to the end, then from the start. */
export function searchOrder(numPages: number, start: number): number[] {
  const s = Math.max(0, Math.min(numPages - 1, start));
  const out: number[] = [];
  for (let i = 0; i < numPages; i++) out.push((s + i) % numPages);
  return out;
}

/** Results collected so far, sorted by page then position. */
export class HitList {
  hits: SearchHit[] = [];
  /** Pages searched, and how many of them had any text. */
  scanned = 0;
  withText = 0;
  truncated = false;

  constructor(readonly limit = 5000) {}

  /** Add a page's hits. Returns how many were kept (the list stops at `limit`). */
  add(page: number, r: PageHits): number {
    this.scanned++;
    if (r.chars > 0) this.withText++;
    if (r.truncated) this.truncated = true;
    const room = this.limit - this.hits.length;
    const take = r.hits.slice(0, Math.max(0, room)).map((h) => ({ ...h, page }));
    if (take.length < r.hits.length) this.truncated = true;
    if (!take.length) return 0;
    // Pages arrive out of order: insert the run where it belongs.
    let at = this.hits.length;
    while (at > 0 && this.hits[at - 1].page > page) at--;
    this.hits.splice(at, 0, ...take);
    return take.length;
  }

  get full(): boolean {
    return this.hits.length >= this.limit;
  }

  /** Hits on one page. */
  onPage(page: number): SearchHit[] {
    return this.hits.filter((h) => h.page === page);
  }

  /** The first hit on or after `page` (wrapping to the first), or -1 if there are none. */
  firstFrom(page: number): number {
    if (!this.hits.length) return -1;
    const i = this.hits.findIndex((h) => h.page >= page);
    return i === -1 ? 0 : i;
  }

  indexOf(h: SearchHit | null): number {
    if (!h) return -1;
    return this.hits.findIndex((x) => x.page === h.page && x.index === h.index);
  }
}

/** The next hit index from `current` in direction `dir`, wrapping; -1 with no hits. */
export function stepHit(total: number, current: number, dir: 1 | -1): number {
  if (total <= 0) return -1;
  if (current < 0) return dir > 0 ? 0 : total - 1;
  return (current + dir + total) % total;
}

/** "3 of 27", "27 found so far", "No results". */
export function countLabel(current: number, total: number, running: boolean, truncated: boolean): string {
  if (!total) return running ? "Searching…" : "No results";
  const more = truncated ? "+" : "";
  if (current < 0) return running ? `${total}${more} found…` : `${total}${more} found`;
  return `${current + 1} of ${total}${more}${running ? "…" : ""}`;
}
