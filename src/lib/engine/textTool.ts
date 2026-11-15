// Text selection, copy and links on the canvas. Svelte-free: input.ts feeds it the left
// button; the shell reads `selection`, `hoverLink` and `cursor()` and calls copy().
//
// Text layers (every character's box, and the page's links) are fetched from the backend per
// page, lazily: when the pointer has rested on a page while the viewer is idle, or when a
// selection starts there. Opening a document costs nothing extra.

import type { Viewer } from "./viewer";
import { type TextLayer, type TextLink, textOf } from "../text/layer";
import { CharIndex, LineIndex, fitHighlight, lineRange, rangeRects, wordRange } from "../text/hit";
import { type Caret, type Selection, isEmpty, joinPages, ordered, rangeOnPage, selectedPages } from "../text/selection";
import { followableUrl, linkAt } from "../text/links";
import { type Quad, lineQuads } from "../text/quads"; // Text markups

interface Entry {
  layer: TextLayer;
  index: CharIndex | null;
  /** The page's lines, for fitting selection bands between them (built on first use). */
  lines: LineIndex | null;
}

export interface TextToolOptions {
  /** Hand a followable web or mail address to the browser. */
  openUrl(url: string): void;
  /** Selection or link hover changed (status bar, menus). */
  onChange?(): void;
  /** Selection fill, multiplied into the page. */
  selectionFill?: string;
  /** Text layers kept per document (least recently used dropped). */
  maxPages?: number;
  // Text markups
}

/** Pixels the pointer must move with the button down before a press becomes a drag. */
const DRAG_PX = 4;
/** How close (CSS px) the pointer must be to text for a press to start a selection. */
const NEAR_TEXT_PX = 6;
const NEAR_LINK_PX = 2;
/** The pointer must rest this long on a page before its text layer is fetched for hover. */
const HOVER_FETCH_MS = 250;

type Press = {
  sx: number;
  sy: number;
  page: number;
  x: number;
  y: number;
  link: TextLink | null;
  anchor: Caret | null;
  dragging: boolean;
};

export class TextTool {
  selection: Selection | null = null;
  hoverLink: TextLink | null = null;
  /** The cursor for the pointer's last position: "text" over text, "pointer" over a link. */
  private hoverCursor: string | null = null;
  private entries = new Map<string, Entry>();
  private loading = new Map<string, Promise<Entry | null>>();
  private press: Press | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPointer: { sx: number; sy: number } | null = null;
  private readonly maxPages: number;

  constructor(
    private viewer: Viewer,
    private opts: TextToolOptions,
  ) {
    this.maxPages = opts.maxPages ?? 12;
  }

  // ---------------------------------------------------------------- text layers

  private get docId(): number | null {
    return this.viewer.doc?.docId ?? null;
  }

  private key(docId: number, page: number): string {
    return `${docId}:${page}`;
  }

  /** The page's layer if it's loaded (and freshly used), else null. */
  private entry(page: number): Entry | null {
    const id = this.docId;
    if (id === null) return null;
    const k = this.key(id, page);
    const e = this.entries.get(k);
    if (!e) return null;
    this.entries.delete(k);
    this.entries.set(k, e); // most recently used last
    return e;
  }

  private indexOf(e: Entry): CharIndex {
    e.index ??= new CharIndex(e.layer);
    return e.index;
  }

  /** Load a page's layer (once); resolves null for images or on failure. */
  load(page: number): Promise<Entry | null> {
    const id = this.docId;
    const r = this.viewer.renderer;
    if (id === null || !r.textLayer || this.viewer.doc?.kind !== "pdf") return Promise.resolve(null);
    const k = this.key(id, page);
    const have = this.entries.get(k);
    if (have) return Promise.resolve(have);
    let p = this.loading.get(k);
    if (!p) {
      p = r
        .textLayer(id, page)
        .then((layer) => {
          const e: Entry = { layer, index: null, lines: null };
          this.entries.set(k, e);
          this.trim(id);
          return e;
        })
        .catch((err) => {
          console.warn("text layer failed:", String(err));
          return null;
        })
        .finally(() => this.loading.delete(k));
      this.loading.set(k, p);
    }
    return p;
  }

  private trim(docId: number): void {
    const mine = [...this.entries.keys()].filter((k) => k.startsWith(`${docId}:`));
    for (const k of mine.slice(0, Math.max(0, mine.length - this.maxPages))) this.entries.delete(k);
  }

  /** Forget a closed document's layers. */
  forgetDoc(docId: number): void {
    for (const k of [...this.entries.keys()]) if (k.startsWith(`${docId}:`)) this.entries.delete(k);
  }

  /** The attached document changed (tab switch, close): drop the selection and hover. */
  reset(): void {
    this.press = null;
    this.selection = null;
    this.hoverLink = null;
    this.hoverCursor = null;
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
    this.paint();
    this.opts.onChange?.();
  }

  // ---------------------------------------------------------------- pointer

  private tolPt(px: number): number {
    return px / this.viewer.view.scale;
  }

  /** Left button down. Returns true if the text tool takes the gesture. */
  pointerDown(sx: number, sy: number, clicks: number): boolean {
    const pp = this.viewer.pagePointAt(sx, sy);
    this.press = null;
    if (!pp) {
      this.clear();
      return false;
    }
    const e = this.entry(pp.page);
    if (!e) {
      // Not loaded yet: fetch it, and treat the press as a possible selection start.
      void this.load(pp.page).then(() => this.resolvePress());
      this.press = { sx, sy, page: pp.page, x: pp.x, y: pp.y, link: null, anchor: null, dragging: false };
      return true;
    }
    const idx = this.indexOf(e);
    const link = linkAt(e.layer.links, pp.x, pp.y, this.tolPt(NEAR_LINK_PX));
    const near = idx.nearest(pp.x, pp.y, this.tolPt(NEAR_TEXT_PX));
    if (near !== null && (clicks === 2 || clicks === 3)) {
      const [a, b] = clicks === 2 ? wordRange(e.layer, near) : lineRange(e.layer, near);
      this.setSelection({ anchor: { page: pp.page, index: a }, focus: { page: pp.page, index: b } });
      return true;
    }
    if (near === null && !link) {
      this.clear();
      return false;
    }
    const anchor = near !== null ? this.caretOn(e, pp.page, pp.x, pp.y) : null;
    this.press = { sx, sy, page: pp.page, x: pp.x, y: pp.y, link, anchor, dragging: false };
    return true;
  }

  /** A press made before its page's layer arrived: work out what it was now. */
  private resolvePress(): void {
    const p = this.press;
    if (!p || p.anchor) return;
    const e = this.entry(p.page);
    if (!e) return;
    const idx = this.indexOf(e);
    p.link = linkAt(e.layer.links, p.x, p.y, this.tolPt(NEAR_LINK_PX));
    if (idx.nearest(p.x, p.y, this.tolPt(NEAR_TEXT_PX)) !== null) p.anchor = this.caretOn(e, p.page, p.x, p.y);
    if (p.dragging && this.lastPointer) this.dragTo(this.lastPointer.sx, this.lastPointer.sy);
  }

  private caretOn(e: Entry, page: number, x: number, y: number): Caret | null {
    const c = this.indexOf(e).caret(x, y);
    return c === null ? null : { page, index: c };
  }

  /** Pointer moved (with or without the button). */
  pointerMove(sx: number, sy: number): void {
    this.lastPointer = { sx, sy };
    const p = this.press;
    if (p) {
      if (!p.dragging && Math.hypot(sx - p.sx, sy - p.sy) >= DRAG_PX) p.dragging = true;
      if (p.dragging) this.dragTo(sx, sy);
      return;
    }
    this.hover(sx, sy);
  }

  private dragTo(sx: number, sy: number): void {
    const p = this.press;
    if (!p?.anchor) return;
    const pp = this.viewer.pagePointAt(sx, sy);
    if (!pp) return; // between pages: keep the last focus
    const e = this.entry(pp.page);
    if (!e) {
      void this.load(pp.page).then(() => this.press?.dragging && this.lastPointer && this.dragTo(this.lastPointer.sx, this.lastPointer.sy));
      return;
    }
    const focus = this.caretOn(e, pp.page, pp.x, pp.y);
    if (focus) this.setSelection({ anchor: p.anchor, focus });
  }

  /** Left button up. Follows a link on a click (not a drag). */
  pointerUp(): void {
    const p = this.press;
    this.press = null;
    if (!p || p.dragging) return;
    if (p.link) {
      this.follow(p.link);
      return;
    }
    this.clear(); // a click on text collapses the selection
  }

  private follow(l: TextLink): void {
    const n = this.viewer.doc?.numPages ?? 0;
    if (l.page !== null && l.page < n) {
      this.viewer.gotoPagePoint(l.page, l.y);
      return;
    }
    const url = followableUrl(l.uri);
    if (url) this.opts.openUrl(url);
  }

  private hover(sx: number, sy: number): void {
    const pp = this.viewer.pagePointAt(sx, sy);
    let link: TextLink | null = null;
    let cursor: string | null = null;
    if (pp) {
      const e = this.entry(pp.page);
      if (e) {
        link = linkAt(e.layer.links, pp.x, pp.y, this.tolPt(NEAR_LINK_PX));
        if (link) cursor = "pointer";
        else if (this.indexOf(e).nearest(pp.x, pp.y, this.tolPt(NEAR_TEXT_PX)) !== null) cursor = "text";
      } else {
        this.scheduleFetch(pp.page);
      }
    }
    if (link !== this.hoverLink || cursor !== this.hoverCursor) {
      this.hoverLink = link;
      this.hoverCursor = cursor;
      this.opts.onChange?.();
    }
  }

  /** Fetch the hovered page's layer once the pointer rests and the viewer is idle. */
  private scheduleFetch(page: number): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    const attempt = () => {
      this.hoverTimer = null;
      const lp = this.lastPointer;
      const pp = lp ? this.viewer.pagePointAt(lp.sx, lp.sy) : null;
      if (pp?.page !== page) return;
      if (!this.viewer.idleForBackground) {
        this.hoverTimer = setTimeout(attempt, HOVER_FETCH_MS);
        return;
      }
      void this.load(page).then(() => lp && !this.press && this.hover(lp.sx, lp.sy));
    };
    this.hoverTimer = setTimeout(attempt, HOVER_FETCH_MS);
  }

  /** The pointer left the canvas. */
  pointerLeave(): void {
    this.lastPointer = null;
    if (this.hoverLink || this.hoverCursor) {
      this.hoverLink = null;
      this.hoverCursor = null;
      this.opts.onChange?.();
    }
  }

  /** CSS cursor for the canvas, or null for the default. */
  cursor(): string | null {
    if (this.press?.dragging && this.press.anchor) return "text";
    return this.hoverCursor;
  }

  /** A press is in progress (the canvas should keep pointer capture). */
  get active(): boolean {
    return this.press !== null;
  }

  // ---------------------------------------------------------------- selection

  get hasSelection(): boolean {
    return !isEmpty(this.selection);
  }

  private setSelection(s: Selection | null): void {
    this.selection = s && !isEmpty(s) ? s : null;
    this.paint();
    this.opts.onChange?.();
  }

  clear(): void {
    if (this.selection) this.setSelection(null);
  }

  /** Select every character on a page. */
  async selectPage(page: number): Promise<void> {
    const e = await this.load(page);
    if (!e || !e.layer.n) return;
    this.setSelection({ anchor: { page, index: 0 }, focus: { page, index: e.layer.n } });
  }

  /** Redraw the selection: rectangles on every selected page whose layer is loaded. */
  private paint(): void {
    const s = this.selection;
    const id = this.docId;
    if (!s || id === null) {
      this.viewer.setHighlights("selection", null);
      return;
    }
    const rects = new Map<number, [number, number, number, number][]>();
    const visible = new Set(this.viewer.uiState().visiblePages);
    for (const page of selectedPages(s)) {
      const e = this.entry(page);
      if (!e) {
        if (visible.has(page)) void this.load(page).then(() => this.paint());
        continue;
      }
      const r = rangeOnPage(s, page, e.layer.n);
      if (!r) continue;
      e.lines ??= new LineIndex(e.layer);
      const lines = e.lines;
      rects.set(page, rangeRects(e.layer, r[0], r[1]).map((b) => fitHighlight(b, lines)));
    }
    this.viewer.setHighlights("selection", {
      rects,
      fill: this.opts.selectionFill ?? "rgba(64, 140, 255, 0.45)",
      order: 10,
      docId: id,
    });
  }

  /** The selected text, in reading order, across pages. */
  async selectedText(): Promise<string> {
    const s = this.selection;
    if (!s || isEmpty(s)) return "";
    const [a, b] = ordered(s);
    const parts: string[] = [];
    for (let page = a.page; page <= b.page; page++) {
      const whole = page !== a.page && page !== b.page;
      if (whole && this.viewer.renderer.pageText && this.docId !== null) {
        // A page in the middle: all of it, without loading its boxes.
        const t = await this.viewer.renderer.pageText(this.docId, page).catch(() => "");
        parts.push(t.replace(/\r\n?/g, "\n"));
        continue;
      }
      const e = await this.load(page);
      if (!e) continue;
      const r = rangeOnPage(s, page, e.layer.n);
      if (r) parts.push(textOf(e.layer, r[0], r[1]));
    }
    return joinPages(parts);
  }
}

// Text markups

/** One page's part of a text selection, as text markups take it (markup/kinds/textmark.ts). */
export interface SelectionLines {
  page: number;
  /** One per selected line, along the text (text/quads.ts). */
  quads: Quad[];
  text: string;
}

/**
 * The selection's lines, page by page, for marking up: each page's quads and text. Pages whose
 * text can't be read are left out. Empty with no selection.
 */
export async function selectionLines(tool: TextTool): Promise<SelectionLines[]> {
  const s = tool.selection;
  if (!s || isEmpty(s)) return [];
  const [a, b] = ordered(s);
  const out: SelectionLines[] = [];
  for (let page = a.page; page <= b.page; page++) {
    const e = await tool.load(page);
    if (!e) continue;
    const r = rangeOnPage(s, page, e.layer.n);
    if (!r) continue;
    const quads = lineQuads(e.layer, r[0], r[1]);
    if (quads.length) out.push({ page, quads, text: textOf(e.layer, r[0], r[1]).trim() });
  }
  return out;
}

/**
 * Where the selection ends on the page, for placing the bar beside it: the last selected
 * line's quad on the last page whose text is loaded (fetching it if need be). Null with none.
 */
export async function selectionEnd(tool: TextTool): Promise<{ page: number; quad: Quad } | null> {
  const s = tool.selection;
  if (!s || isEmpty(s)) return null;
  const [a, b] = ordered(s);
  for (let page = b.page; page >= a.page; page--) {
    const e = await tool.load(page);
    if (!e) continue;
    const r = rangeOnPage(s, page, e.layer.n);
    const quads = r ? lineQuads(e.layer, r[0], r[1]) : [];
    if (quads.length) return { page, quad: quads[quads.length - 1] };
  }
  return null;
}
