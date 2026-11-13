// The text tool (selection, copy, links) and whole-document search, against a stub renderer
// whose pages carry known text.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Viewer } from "./viewer";
import { StubRenderer, doc, flush, installFakes, stubCanvas } from "./testkit";
import { TextTool } from "./textTool";
import { SearchController } from "./search";
import type { TextLayer, TextLink } from "../text/layer";
import type { PageHits, SearchOptions } from "../text/searchModel";

beforeEach(installFakes);
afterEach(() => {
  vi.useRealTimers();
});

/** One line of text per page at (100, 100), 6 x 10 pt per character. */
function lineLayer(text: string, links: TextLink[] = []): TextLayer {
  const n = text.length;
  const boxes = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) boxes.set([100 + 6 * i, 100, 106 + 6 * i, 110], i * 4);
  return { n, codes: Uint32Array.from([...text].map((c) => c.codePointAt(0)!)), boxes, flags: new Uint8Array(n).fill(2), links };
}

class TextRenderer extends StubRenderer {
  layerCalls: number[] = [];
  searchCalls: number[] = [];
  constructor(
    private pages: string[],
    private links: Record<number, TextLink[]> = {},
  ) {
    super(doc(pages.map(() => ({ w: 600, h: 400 }))));
    this.auto = true;
  }
  async textLayer(_docId: number, page: number): Promise<TextLayer> {
    this.layerCalls.push(page);
    return lineLayer(this.pages[page], this.links[page]);
  }
  async pageText(_docId: number, page: number): Promise<string> {
    return this.pages[page];
  }
  async searchPage(_docId: number, page: number, query: string, o: SearchOptions): Promise<PageHits> {
    this.searchCalls.push(page);
    const t = this.pages[page];
    const hits = [];
    const hay = o.matchCase ? t : t.toLowerCase();
    const q = o.matchCase ? query : query.toLowerCase();
    for (let i = hay.indexOf(q); i >= 0; i = hay.indexOf(q, i + 1)) {
      hits.push({ index: i, count: q.length, rects: [[100 + 6 * i, 100, 100 + 6 * (i + q.length), 110] as [number, number, number, number]], before: "", text: t.slice(i, i + q.length), after: "" });
    }
    return { chars: t.length, hits, truncated: false };
  }
}

async function setup(pages: string[], links: Record<number, TextLink[]> = {}) {
  const r = new TextRenderer(pages, links);
  const v = new Viewer(stubCanvas(), {}, r);
  v.resize(800, 600, 1);
  await v.open("C:/x/doc.pdf", undefined, r);
  v.setZoom(1);
  const opened: string[] = [];
  const tt = new TextTool(v, { openUrl: (u) => opened.push(u) });
  return { r, v, tt, opened };
}

/** A page point on screen (no view rotation). */
function toScreen(v: Viewer, page: number, x: number, y: number): [number, number] {
  const r = v.layout.rects[page]!;
  return [(r.x + x) * v.view.scale + v.view.tx, (r.y + y) * v.view.scale + v.view.ty];
}

const highlight = (v: Viewer, name: string) => (v as unknown as { highlights: Map<string, { rects: Map<number, number[][]> }> }).highlights.get(name);

describe("TextTool", () => {
  it("selects text by dragging and copies it", async () => {
    const { v, tt } = await setup(["Stage left rigging"]);
    v.centreOn(0, 150, 105);
    const [x0, y] = toScreen(v, 0, 101, 105); // start of "Stage"
    const [x1] = toScreen(v, 0, 129, 105); // end of "Stage"
    expect(tt.pointerDown(x0, y, 1)).toBe(true);
    await flush();
    tt.pointerMove(x0 + 10, y);
    tt.pointerMove(x1, y);
    tt.pointerUp();
    expect(tt.hasSelection).toBe(true);
    expect(await tt.selectedText()).toBe("Stage");
    expect(highlight(v, "selection")!.rects.get(0)).toEqual([[100, 100, 130, 110]]);
  });

  it("selects a word on double-click and a line on triple-click", async () => {
    const { v, tt } = await setup(["Stage left rigging"]);
    v.centreOn(0, 150, 105);
    const [x, y] = toScreen(v, 0, 140, 105); // in "left"
    await tt.load(0);
    tt.pointerDown(x, y, 2);
    tt.pointerUp();
    expect(await tt.selectedText()).toBe("left");
    tt.pointerDown(x, y, 3);
    tt.pointerUp();
    expect(await tt.selectedText()).toBe("Stage left rigging");
  });

  it("ignores presses away from text and clears the selection", async () => {
    const { v, tt } = await setup(["Stage"]);
    v.centreOn(0, 150, 105);
    await tt.selectPage(0);
    expect(tt.hasSelection).toBe(true);
    const [x, y] = toScreen(v, 0, 400, 300);
    expect(tt.pointerDown(x, y, 1)).toBe(false);
    expect(tt.hasSelection).toBe(false);
    expect(highlight(v, "selection")).toBeUndefined();
  });

  it("follows a link on click, but not when dragging over it", async () => {
    const web: TextLink = { rects: [[100, 100, 160, 110]], uri: "https://example.com", page: null, y: null };
    const jump: TextLink = { rects: [[100, 100, 160, 110]], uri: null, page: 1, y: 50 };
    const { v, tt, opened } = await setup(["see example", "page two"], { 0: [web], 1: [jump] });
    v.centreOn(0, 150, 105);
    await tt.load(0);
    const [x, y] = toScreen(v, 0, 110, 105);
    tt.pointerDown(x, y, 1);
    tt.pointerUp();
    expect(opened).toEqual(["https://example.com"]);
    tt.pointerDown(x, y, 1);
    tt.pointerMove(x + 30, y);
    tt.pointerUp();
    expect(opened.length).toBe(1);
    expect(tt.hasSelection).toBe(true);
    // An internal link jumps to its page.
    v.centreOn(1, 150, 105);
    await tt.load(1);
    const go = vi.spyOn(v, "gotoPagePoint");
    const [x2, y2] = toScreen(v, 1, 110, 105);
    tt.pointerDown(x2, y2, 1);
    tt.pointerUp();
    expect(go).toHaveBeenCalledWith(1, 50);
  });

  it("shows a text cursor over text once the pointer has rested there", async () => {
    const { v, r, tt } = await setup(["Stage left"]);
    v.centreOn(0, 150, 105);
    const [x, y] = toScreen(v, 0, 110, 105);
    (v as unknown as { lastInput: number }).lastInput = -Infinity; // idle
    tt.pointerMove(x, y);
    expect(tt.cursor()).toBeNull();
    expect(r.layerCalls).toEqual([]); // nothing fetched on the first move
    await flush(600);
    expect(r.layerCalls).toEqual([0]);
    expect(tt.cursor()).toBe("text");
  });

  it("copies across pages, taking whole middle pages without loading their boxes", async () => {
    const { v, r, tt } = await setup(["first page", "middle page", "last page"]);
    v.setLayoutMode("continuous");
    await tt.load(0);
    await tt.load(2);
    (tt as unknown as { selection: unknown }).selection = { anchor: { page: 0, index: 6 }, focus: { page: 2, index: 4 } };
    expect(await tt.selectedText()).toBe("page\n\nmiddle page\n\nlast");
    expect(r.layerCalls).not.toContain(1);
  });

  it("forgets the selection when the document changes", async () => {
    const { tt } = await setup(["Stage"]);
    await tt.selectPage(0);
    tt.reset();
    expect(tt.hasSelection).toBe(false);
  });
});

describe("SearchController", () => {
  it("searches every page from the current one and keeps hits in document order", async () => {
    const { v, r } = await setup(["no", "stage one", "nothing", "stage two stage"]);
    v.gotoPage(2);
    const changes: number[] = [];
    const sc = new SearchController(v, () => changes.push(1));
    sc.search("stage", { matchCase: false, wholeWord: false });
    await flush(500);
    expect(r.searchCalls.slice(0, 2)).toEqual([2, 3]); // current page first
    const s = sc.session!;
    expect(s.running).toBe(false);
    expect(s.list.hits.map((h) => [h.page, h.index])).toEqual([[1, 0], [3, 0], [3, 10]]);
    expect(changes.length).toBeGreaterThan(0);
    expect(highlight(v, "search")!.rects.get(3)!.length).toBe(2);
  });

  it("steps through hits from the current page and brings each into view", async () => {
    const { v } = await setup(["stage", "x", "stage"]);
    v.gotoPage(1);
    const sc = new SearchController(v, () => {});
    sc.search("stage", { matchCase: false, wholeWord: false });
    await flush(500);
    const reveal = vi.spyOn(v, "revealRect");
    sc.step(1);
    expect(sc.session!.current).toBe(1); // the first hit on or after page 2 (index 1)
    expect(reveal).toHaveBeenLastCalledWith(2, [100, 100, 130, 110]);
    sc.step(1);
    expect(sc.session!.current).toBe(0); // wraps
    expect(highlight(v, "search-current")!.rects.get(0)).toEqual([[100, 100, 130, 110]]);
  });

  it("clears on an empty query and when its document closes", async () => {
    const { v } = await setup(["stage"]);
    const sc = new SearchController(v, () => {});
    sc.search("stage", { matchCase: false, wholeWord: false });
    await flush(200);
    sc.search("  ", { matchCase: false, wholeWord: false });
    expect(sc.session).toBeNull();
    expect(highlight(v, "search")).toBeUndefined();
    sc.search("Stage", { matchCase: true, wholeWord: false });
    await flush(200);
    expect(sc.session!.list.hits.length).toBe(0); // case matters
    sc.forgetDoc(v.doc!.docId);
    expect(sc.session).toBeNull();
  });

  it("a new query cancels the old one", async () => {
    const { v } = await setup(["alpha beta", "alpha", "beta"]);
    const sc = new SearchController(v, () => {});
    sc.search("alpha", { matchCase: false, wholeWord: false });
    sc.search("beta", { matchCase: false, wholeWord: false });
    await flush(500);
    expect(sc.session!.query).toBe("beta");
    expect(sc.session!.list.hits.map((h) => h.text)).toEqual(["beta", "beta"]);
  });
});
