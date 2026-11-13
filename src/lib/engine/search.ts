// Whole-document search in the background. Svelte-free. One session per document (kept while
// you switch tabs); pages are searched one at a time per request, starting from the current
// page, two in flight, so rendering is never held up for long.

import type { Viewer } from "./viewer";
import type { Renderer } from "../render/types";
import { HitList, type SearchHit, type SearchOptions, searchOrder, stepHit } from "../text/searchModel";

/** Pages searched at once. */
const CONCURRENCY = 2;
/** Hits collected before the search stops. */
export const HIT_LIMIT = 5000;

export class SearchSession {
  readonly list = new HitList(HIT_LIMIT);
  current = -1;
  running = false;
  /** A page failed to search (the message, for the results list). */
  error: string | null = null;
  private cancelled = false;

  constructor(
    private renderer: Renderer,
    readonly docId: number,
    readonly numPages: number,
    readonly query: string,
    readonly opts: SearchOptions,
    private onChange: () => void,
  ) {}

  /** Search every page, starting at `fromPage`. Resolves when done or cancelled. */
  async run(fromPage: number): Promise<void> {
    const r = this.renderer;
    if (!r.searchPage || !this.query) return;
    const order = searchOrder(this.numPages, fromPage);
    let next = 0;
    this.running = true;
    this.onChange();
    let pending = false;
    const notify = () => {
      // At most every 100 ms while results pour in.
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        if (!this.cancelled) this.onChange();
      }, 100);
    };
    const worker = async () => {
      while (!this.cancelled && !this.list.full && next < order.length) {
        const page = order[next++];
        try {
          const res = await r.searchPage!(this.docId, page, this.query, this.opts);
          if (this.cancelled) return;
          this.list.add(page, res);
          notify();
        } catch (e) {
          if (this.cancelled) return;
          this.error = String((e as Error)?.message ?? e);
          this.list.scanned++;
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (this.cancelled) return;
    this.running = false;
    this.onChange();
  }

  cancel(): void {
    this.cancelled = true;
    this.running = false;
  }

  get hit(): SearchHit | null {
    return this.list.hits[this.current] ?? null;
  }

  /** Move to the next or previous hit; the first step goes to the first hit from `fromPage`. */
  step(dir: 1 | -1, fromPage: number): SearchHit | null {
    const total = this.list.hits.length;
    if (!total) return null;
    if (this.current < 0) {
      const first = this.list.firstFrom(fromPage);
      this.current = dir > 0 ? first : stepHit(total, first, -1);
    } else {
      this.current = stepHit(total, this.current, dir);
    }
    return this.hit;
  }

  select(i: number): SearchHit | null {
    if (i < 0 || i >= this.list.hits.length) return null;
    this.current = i;
    return this.hit;
  }
}

/**
 * Runs searches for the shell: one session per document, highlights on the viewer, moving to
 * hits. The shell reads `session` (for the active document) after every onChange.
 */
export class SearchController {
  private sessions = new Map<number, SearchSession>();

  constructor(
    private viewer: Viewer,
    private onChange: () => void,
  ) {}

  /** The active document's session, if it has one. */
  get session(): SearchSession | null {
    const id = this.viewer.doc?.docId;
    return id === undefined ? null : (this.sessions.get(id) ?? null);
  }

  /** Start (or restart) a search in the active document. An empty query clears it. */
  search(query: string, opts: SearchOptions): void {
    const doc = this.viewer.doc;
    if (!doc) return;
    this.sessions.get(doc.docId)?.cancel();
    const q = query.trim() ? query : "";
    if (!q) {
      this.sessions.delete(doc.docId);
      this.paint();
      this.onChange();
      return;
    }
    const s = new SearchSession(this.viewer.renderer, doc.docId, doc.numPages, q, opts, () => {
      if (this.sessions.get(doc.docId) === s) {
        this.paint();
        this.onChange();
      }
    });
    this.sessions.set(doc.docId, s);
    void s.run(this.viewer.currentPageIndex);
  }

  /** Go to the next or previous hit. */
  step(dir: 1 | -1): void {
    const s = this.session;
    const h = s?.step(dir, this.viewer.currentPageIndex);
    if (!s || !h) return;
    this.reveal(s);
  }

  /** Go to hit i (from the results list). */
  select(i: number): void {
    const s = this.session;
    if (!s?.select(i)) return;
    this.reveal(s);
  }

  private reveal(s: SearchSession): void {
    const h = s.hit;
    if (!h || !h.rects.length) return;
    const b = h.rects.reduce<[number, number, number, number]>(
      (u, r) => [Math.min(u[0], r[0]), Math.min(u[1], r[1]), Math.max(u[2], r[2]), Math.max(u[3], r[3])],
      [...h.rects[0]],
    );
    this.viewer.revealRect(h.page, b);
    this.paint();
    this.onChange();
  }

  /** Forget a closed document's search. */
  forgetDoc(docId: number): void {
    this.sessions.get(docId)?.cancel();
    this.sessions.delete(docId);
  }

  /** Highlights for the active document: every hit pale, the current one strong. */
  paint(): void {
    const s = this.session;
    const id = this.viewer.doc?.docId;
    if (!s || id === undefined) {
      this.viewer.setHighlights("search", null);
      this.viewer.setHighlights("search-current", null);
      return;
    }
    const all = new Map<number, [number, number, number, number][]>();
    for (const h of s.list.hits) {
      let list = all.get(h.page);
      if (!list) all.set(h.page, (list = []));
      list.push(...h.rects);
    }
    this.viewer.setHighlights("search", { rects: all, fill: "rgba(255, 214, 0, 0.55)", order: 1, docId: id });
    const cur = s.hit;
    this.viewer.setHighlights(
      "search-current",
      cur ? { rects: new Map([[cur.page, cur.rects]]), fill: "rgba(255, 140, 0, 0.75)", stroke: "rgba(200, 80, 0, 1)", order: 2, docId: id } : null,
    );
  }
}
