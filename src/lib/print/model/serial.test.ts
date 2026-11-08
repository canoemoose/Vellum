import { describe, expect, it } from "vitest";
import { addItem, addSheet, emptyLayout, updateItem } from "./manual";
import { layoutPaths, parseLayout, restore, serialise } from "./serial";
import { A3, ref, uniform } from "./testkit";

const A3L = { w: A3.h, h: A3.w };

function sample() {
  let l = emptyLayout(A3L, uniform(5));
  l = addItem(l, 0, ref(500, 300, { docId: 4, path: "C:/a b/plan (1).pdf", page: 2, drawingScale: 100, title: "plan (1).pdf" })).layout;
  l = updateItem(l, 0, 2, { crop: { x0: 1, y0: 2, x1: 300, y1: 200 }, rotation: 90, border: true, label: false });
  l = addSheet(l);
  l = addItem(l, 1, ref(100, 80, { docId: 9, path: "C:/img/truss.jpg", kind: "image", title: "truss.jpg" })).layout;
  return l;
}

describe("save and load", () => {
  it("round-trips through JSON, remapping document ids", () => {
    const l = sample();
    const text = serialise(l);
    const parsed = parseLayout(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(layoutPaths(parsed.layout)).toEqual(["C:/a b/plan (1).pdf", "C:/img/truss.jpg"]);
    const ids: Record<string, number> = { "C:/a b/plan (1).pdf": 40, "C:/img/truss.jpg": 90 };
    const { layout, missing } = restore(parsed.layout, (p) => ({ docId: ids[p], numPages: 5 }));
    expect(missing).toEqual([]);
    expect(layout.paper).toEqual(l.paper);
    expect(layout.margins).toEqual(l.margins);
    expect(layout.sheets).toHaveLength(2);
    const a = layout.sheets[0].items[0];
    const orig = l.sheets[0].items[0];
    expect(a.ref).toEqual({ ...orig.ref, docId: 40 });
    expect({ ...a, id: 0, ref: null }).toEqual({ ...orig, id: 0, ref: null });
    expect(layout.sheets[1].items[0].ref).toMatchObject({ docId: 90, kind: "image" });
    // Ids are unique and nextId is past them.
    const allIds = [...layout.sheets.map((s) => s.id), ...layout.sheets.flatMap((s) => s.items.map((i) => i.id))];
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(Math.max(...allIds)).toBeLessThan(layout.nextId);
  });

  it("drops items whose file or page is missing, and says which", () => {
    const parsed = parseLayout(serialise(sample()));
    if (!parsed.ok) throw new Error();
    const r = restore(parsed.layout, (p) => (p.endsWith(".jpg") ? null : { docId: 1, numPages: 2 }));
    expect(r.layout.sheets[0].items).toHaveLength(0); // page 3 of a 2-page file
    expect(r.layout.sheets[1].items).toHaveLength(0);
    expect(r.missing.sort()).toEqual(["C:/a b/plan (1).pdf", "C:/img/truss.jpg"]);
  });

  it("uses the file's current page size", () => {
    const parsed = parseLayout(serialise(sample()));
    if (!parsed.ok) throw new Error();
    const sizes = [{ w: 1, h: 1 }, { w: 1, h: 1 }, { w: 600, h: 400 }];
    const r = restore(parsed.layout, () => ({ docId: 1, numPages: 3, sizes }));
    expect(r.layout.sheets[0].items[0].ref).toMatchObject({ w: 600, h: 400 });
  });

  it("rejects what isn't a layout", () => {
    expect(parseLayout("not json")).toEqual({ ok: false, error: "This isn't a Vellum layout file" });
    expect(parseLayout("{}")).toEqual({ ok: false, error: "This isn't a Vellum layout file" });
    expect(parseLayout('{"vellumLayout": 99}')).toEqual({ ok: false, error: "This layout was saved by a newer Vellum" });
    expect(parseLayout('{"vellumLayout": 1, "sheets": []}')).toEqual({ ok: false, error: "The layout file is damaged" });
  });

  it("skips damaged items and fills in defaults", () => {
    const text = JSON.stringify({
      vellumLayout: 1,
      paper: { w: 100, h: 100 },
      sheets: [{ items: [{ source: { path: "x.pdf", page: 0, w: 10, h: 10 }, x: 1, y: 2, scale: 1, rotation: 45 }, { junk: true }, null] }, {}],
    });
    const p = parseLayout(text);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.layout.margins).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    const r = restore(p.layout, () => ({ docId: 3, numPages: 1 }));
    const it = r.layout.sheets[0].items[0];
    expect(it).toMatchObject({ rotation: 90, border: false, label: true, crop: null });
    expect(it.ref).toMatchObject({ kind: "pdf", drawingScale: null });
    expect(r.layout.sheets[1].items).toEqual([]);
  });
});
