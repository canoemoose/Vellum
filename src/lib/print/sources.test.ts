import { describe, expect, it } from "vitest";
import type { PrintDoc } from "./context";
import { activeDoc, pickSources, stem } from "./sources";

function doc(docId: number, n: number, extra: Partial<PrintDoc> = {}): PrintDoc {
  return {
    docId,
    path: `C:/plans/d${docId}.pdf`,
    title: `d${docId}.pdf`,
    scaleOf: () => 100,
    info: {
      docId,
      kind: "pdf",
      numPages: n,
      sizes: Array.from({ length: n }, (_, i) => ({ w: 100 + i, h: 200 })),
      meta: { fileSize: 1, pdfVersion: "1.7", title: null, author: null, subject: null, producer: null, creator: null, note: null },
      workers: 1,
    },
    ...extra,
  };
}

const ctx = { docs: [doc(1, 3), doc(2, 5)], activeDocId: 2, currentPage: 3, viewRect: { page: 3, x0: 10, y0: 20, x1: 50, y1: 60 } };

describe("pickSources", () => {
  it("uses the active document", () => {
    expect(activeDoc(ctx)!.docId).toBe(2);
    expect(activeDoc({ docs: ctx.docs, activeDocId: 99 })!.docId).toBe(1);
    expect(activeDoc({ docs: [], activeDocId: null })).toBeNull();
  });

  it("all, current and range", () => {
    const all = pickSources(ctx, "all", "", null);
    expect(all.ok && all.sources.map((s) => s.ref.page)).toEqual([0, 1, 2, 3, 4]);
    const cur = pickSources(ctx, "current", "", null);
    expect(cur.ok && cur.sources[0].ref).toMatchObject({ docId: 2, page: 3, w: 103, h: 200, drawingScale: 100, path: "C:/plans/d2.pdf" });
    const r = pickSources(ctx, "range", "1-2, 5", null);
    expect(r.ok && r.sources.map((s) => s.ref.page)).toEqual([0, 1, 4]);
    expect(pickSources(ctx, "range", "9", null)).toEqual({ ok: false, error: "Pages run from 1 to 5." });
  });

  it("gives each page its own drawing scale", () => {
    // The Fieldwork set: a 1:5000 site plan, then sheets at 1:2500, 1:500 and 1:100.
    const set = doc(3, 5, { scaleOf: (p) => [5000, 2500, 500, 100, null][p] ?? null });
    const c = { docs: [set], activeDocId: 3, currentPage: 3, viewRect: { page: 4, x0: 0, y0: 0, x1: 9, y1: 9 } };
    const all = pickSources(c, "all", "", null);
    expect(all.ok && all.sources.map((s) => s.ref.drawingScale)).toEqual([5000, 2500, 500, 100, null]);
    const cur = pickSources(c, "current", "", null);
    expect(cur.ok && cur.sources[0].ref.drawingScale).toBe(100);
    const v = pickSources(c, "view", "", null);
    expect(v.ok && v.sources[0].ref.drawingScale).toBeNull();
  });

  it("view and marquee crop the page", () => {
    const v = pickSources(ctx, "view", "", null);
    expect(v.ok && v.sources[0].crop).toEqual({ x0: 10, y0: 20, x1: 50, y1: 60 });
    expect(pickSources({ ...ctx, viewRect: null }, "view", "", null).ok).toBe(false);
    expect(pickSources(ctx, "marquee", "", null).ok).toBe(false);
    const m = pickSources(ctx, "marquee", "", { page: 1, x0: 0, y0: 0, x1: 5, y1: 5 });
    expect(m.ok && m.sources[0].ref.page).toBe(1);
  });

  it("copes with no document and a stale page number", () => {
    expect(pickSources({ docs: [], activeDocId: null, currentPage: 0, viewRect: null }, "all", "", null).ok).toBe(false);
    const c = pickSources({ ...ctx, currentPage: 50 }, "current", "", null);
    expect(c.ok && c.sources[0].ref.page).toBe(4);
  });

  it("strips extensions", () => {
    expect(stem("Hall 3.pdf")).toBe("Hall 3");
    expect(stem("noext")).toBe("noext");
  });
});
