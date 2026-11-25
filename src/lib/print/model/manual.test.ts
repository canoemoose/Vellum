import { describe, expect, it } from "vitest";
import { boxH, boxW, centreX, centreY, mmToPt } from "./geom";
import {
  type ManualItem, type ManualLayout, addItem, addSheet, areaOfLayout, clearSheet, cropFromEdge, cropToSheetBox,
  defaultScale, duplicateSheet, emptyLayout, findItem, freeSpot, fullPageBox, itemBox, labelText, layoutFileCount, manualToJob,
  moveItem, pageToSheet, placedKeys, removeItem, removeSheet, resetCrop, scaleFromCorner, scaleLabel, setCrop,
  setRatio, setRotation, setScale, sheetCount, sheetJob, sheetToPage, showsName, labelParts, sourceDescription, updateItem,
  withDrawingScales,
} from "./manual";
import { A1, A3, A4, ref, uniform } from "./testkit";

const A3L = { w: A3.h, h: A3.w };

function layout(): ManualLayout {
  return emptyLayout(A3L, uniform(5));
}

function item(extra: Partial<ManualItem> = {}): ManualItem {
  return { id: 1, ref: ref(200, 100), crop: null, x: 10, y: 20, scale: 1, rotation: 0, border: false, showName: null, showPage: true, showScale: true, ...extra };
}

describe("placement maths", () => {
  it("item boxes follow scale, rotation and crop", () => {
    expect(itemBox(item())).toEqual({ x0: 10, y0: 20, x1: 210, y1: 120 });
    expect(itemBox(item({ rotation: 90, scale: 2 }))).toEqual({ x0: 10, y0: 20, x1: 210, y1: 420 });
    expect(itemBox(item({ crop: { x0: 50, y0: 10, x1: 150, y1: 60 } }))).toEqual({ x0: 10, y0: 20, x1: 110, y1: 70 });
  });

  it("page and sheet coordinates round-trip in every rotation, with crops", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const crop of [null, { x0: 30, y0: 10, x1: 120, y1: 80 }]) {
        const it = item({ rotation, crop, scale: 1.7, x: 33, y: 44 });
        for (const [px, py] of [[30, 10], [120, 80], [77, 31]]) {
          const [sx, sy] = pageToSheet(it, px, py);
          const [bx, by] = sheetToPage(it, sx, sy);
          expect(bx).toBeCloseTo(px, 9);
          expect(by).toBeCloseTo(py, 9);
        }
        // The crop's corners land on the item box's corners.
        const c = crop ?? { x0: 0, y0: 0, x1: 200, y1: 100 };
        const b = itemBox(it);
        const pts = [pageToSheet(it, c.x0, c.y0), pageToSheet(it, c.x1, c.y1)];
        const xs = pts.map((p) => p[0]).sort((a, b) => a - b);
        const ys = pts.map((p) => p[1]).sort((a, b) => a - b);
        expect(xs[0]).toBeCloseTo(b.x0, 9);
        expect(xs[1]).toBeCloseTo(b.x1, 9);
        expect(ys[0]).toBeCloseTo(b.y0, 9);
        expect(ys[1]).toBeCloseTo(b.y1, 9);
      }
    }
  });

  it("rotates clockwise like the composer (page top-left to box top-right at 90)", () => {
    const it = item({ rotation: 90 });
    const [sx, sy] = pageToSheet(it, 0, 0);
    expect([sx, sy]).toEqual([itemBox(it).x1, itemBox(it).y0]);
  });
});

describe("adding and editing", () => {
  it("chooses 100% when the page fits, else the largest standard scale that fits", () => {
    const area = areaOfLayout(layout());
    expect(defaultScale(ref(A4.h, A4.w), null, area)).toBe(1);
    const s = defaultScale(ref(A1.h, A1.w, { drawingScale: 100 }), null, area);
    expect(s).toBeCloseTo(100 / 250, 9); // fit would be about 1:206
    const raw = defaultScale(ref(A1.h, A1.w), null, area);
    expect(raw).toBeCloseTo(Math.min(boxW(area) / A1.h, boxH(area) / A1.w), 9);
  });

  it("adds into free space, then next to what's there", () => {
    let l = layout();
    const a = addItem(l, 0, ref(200, 200));
    l = a.layout;
    const b = addItem(l, 0, ref(200, 200, { page: 1 }));
    l = b.layout;
    const ia = findItem(l, 0, a.id)!;
    const ib = findItem(l, 0, b.id)!;
    const area = areaOfLayout(l);
    expect(ia.x).toBeCloseTo(area.x0);
    expect(ia.y).toBeCloseTo(area.y0);
    expect(itemBox(ib).x0).toBeGreaterThanOrEqual(itemBox(ia).x1 - 1e-6);
    expect(a.id).not.toBe(b.id);
    expect(placedKeys(l)).toEqual(new Set(["1:0", "1:1"]));
  });

  it("centres a dropped item on the drop point", () => {
    const r = addItem(layout(), 0, ref(100, 50), { at: { x: 300, y: 200 }, scale: 2 });
    const it = findItem(r.layout, 0, r.id)!;
    expect(centreX(itemBox(it))).toBeCloseTo(300);
    expect(centreY(itemBox(it))).toBeCloseTo(200);
  });

  it("finds no free spot on a full sheet", () => {
    const area = { x0: 0, y0: 0, x1: 100, y1: 100 };
    expect(freeSpot(area, [area], 10, 10)).toBeNull();
    expect(freeSpot(area, [], 200, 10)).toBeNull();
    const spot = freeSpot(area, [{ x0: 0, y0: 0, x1: 50, y1: 100 }], 40, 40)!;
    expect(spot.x).toBeCloseTo(56.68, 6);
    expect(spot.y).toBe(0);
  });

  it("moves, updates and removes", () => {
    let l = addItem(layout(), 0, ref(100, 100)).layout;
    l = moveItem(l, 0, 2, 50, 60); // id 2 is the first item (the sheet took id 1)
    expect(findItem(l, 0, 2)).toMatchObject({ x: 50, y: 60 });
    l = updateItem(l, 0, 2, { border: true });
    expect(findItem(l, 0, 2)!.border).toBe(true);
    l = removeItem(l, 0, 2);
    expect(l.sheets[0].items).toHaveLength(0);
  });

  it("scales and rotates about the centre", () => {
    let l = addItem(layout(), 0, ref(200, 100), { at: { x: 400, y: 300 }, scale: 1 }).layout;
    l = setScale(l, 0, 2, 0.5);
    let b = itemBox(findItem(l, 0, 2)!);
    expect([centreX(b), centreY(b), boxW(b)]).toEqual([400, 300, 100]);
    l = setRotation(l, 0, 2, 90);
    b = itemBox(findItem(l, 0, 2)!);
    expect(centreX(b)).toBeCloseTo(400);
    expect(boxW(b)).toBeCloseTo(50);
    expect(setScale(l, 0, 2, 0)).toBe(l);
    expect(setScale(l, 0, 2, NaN)).toBe(l);
  });

  it("sets a drawing-scale ratio", () => {
    let l = addItem(layout(), 0, ref(A1.h, A1.w, { drawingScale: 100 })).layout;
    l = setRatio(l, 0, 2, 200);
    expect(findItem(l, 0, 2)!.scale).toBeCloseTo(0.5);
    const noScale = addItem(layout(), 0, ref(100, 100)).layout;
    expect(setRatio(noScale, 0, 2, 200)).toBe(noScale);
  });

  it("scales from a corner keeping the opposite corner and the aspect ratio", () => {
    const it = item(); // 200 x 100 at (10, 20)
    const se = scaleFromCorner(it, "se", 410, 150);
    expect(se.scale).toBeCloseTo(2); // x moved further: 400 / 200
    expect(itemBox(se)).toMatchObject({ x0: 10, y0: 20 });
    const nw = scaleFromCorner(it, "nw", 110, 70);
    expect(nw.scale).toBeCloseTo(0.5);
    expect(itemBox(nw).x1).toBeCloseTo(210);
    expect(itemBox(nw).y1).toBeCloseTo(120);
    const tiny = scaleFromCorner(it, "se", 10, 20);
    expect(boxH(itemBox(tiny))).toBeCloseTo(7);
  });
});

describe("cropping", () => {
  it("crops from an edge without moving the content", () => {
    const it = item({ scale: 2 }); // page 200 x 100 at 2x: box 10..410, 20..220
    const c = cropFromEdge(it, "left", 110);
    expect(c.crop).toEqual({ x0: 50, y0: 0, x1: 200, y1: 100 });
    expect(c.x).toBe(110);
    // The same page point is at the same sheet point before and after.
    expect(pageToSheet(c, 120, 40)).toEqual(pageToSheet(it, 120, 40));
    const d = cropFromEdge(c, "bottom", 120);
    expect(d.crop).toEqual({ x0: 50, y0: 0, x1: 200, y1: 50 });
  });

  it("clamps edge crops to the page and a minimum size", () => {
    const it = item();
    expect(cropFromEdge(it, "left", -500)).toEqual({ ...it, crop: null });
    const c = cropFromEdge(it, "right", 0);
    expect(boxW(itemBox(c))).toBeCloseTo(7);
  });

  it("crops rotated items in page coordinates", () => {
    const it = item({ rotation: 90 }); // box 100 x 200 at (10, 20); page top edge is the box's right edge
    const c = cropFromEdge(it, "right", 60);
    expect(c.crop!.y0).toBeCloseTo(50);
    expect(c.crop!.y1).toBeCloseTo(100);
    expect(c.crop!.x0).toBeCloseTo(0);
    expect(c.crop!.x1).toBeCloseTo(200);
    expect(itemBox(c).x1).toBeCloseTo(60);
    expect(pageToSheet(c, 10, 70)[0]).toBeCloseTo(pageToSheet(it, 10, 70)[0]);
  });

  it("can grow a crop back out to the page, and reset it in place", () => {
    const it = cropToSheetBox(item(), { x0: 50, y0: 40, x1: 100, y1: 80 });
    expect(it.crop).toEqual({ x0: 40, y0: 20, x1: 90, y1: 60 });
    expect(fullPageBox(it)).toEqual({ x0: 10, y0: 20, x1: 210, y1: 120 });
    const back = cropFromEdge(it, "left", -100);
    expect(back.crop!.x0).toBe(0);
    const reset = resetCrop(it);
    expect(reset.crop).toBeNull();
    expect(itemBox(reset)).toEqual({ x0: 10, y0: 20, x1: 210, y1: 120 });
    expect(resetCrop(item())).toEqual(item());
  });

  it("sets a crop region keeping the centre", () => {
    const it = setCrop(item(), { x0: 0, y0: 0, x1: 100, y1: 50 });
    expect(it.crop).toEqual({ x0: 0, y0: 0, x1: 100, y1: 50 });
    expect(centreX(itemBox(it))).toBeCloseTo(110);
    const clamped = setCrop(item(), { x0: -50, y0: -50, x1: 50, y1: 50 });
    expect(clamped.crop).toEqual({ x0: 0, y0: 0, x1: 50, y1: 50 });
  });
});

describe("sheets", () => {
  it("adds, duplicates, clears and removes sheets with fresh ids", () => {
    let l = addItem(layout(), 0, ref(100, 100)).layout;
    l = duplicateSheet(l, 0);
    expect(l.sheets).toHaveLength(2);
    expect(l.sheets[1].items[0].id).not.toBe(l.sheets[0].items[0].id);
    expect(l.sheets[1].id).not.toBe(l.sheets[0].id);
    l = addSheet(l);
    expect(l.sheets).toHaveLength(3);
    expect(sheetCount(l)).toBe(2);
    l = clearSheet(l, 0);
    expect(sheetCount(l)).toBe(1);
    l = removeSheet(l, 2);
    expect(l.sheets).toHaveLength(2);
    const one = removeSheet(emptyLayout(A3L, uniform(5)), 0);
    expect(one.sheets).toHaveLength(1);
    expect(duplicateSheet(l, 9)).toBe(l);
  });
});

describe("drawing scales arriving late", () => {
  it("updates each placed page's scale and keeps its size on the sheet", () => {
    // Fieldwork page 4 (1:100) placed while Print still thought it was page 1's 1:5000.
    let l = addItem(layout(), 0, ref(A3L.w, A3L.h, { page: 3, drawingScale: 5000 }), { scale: 0.5 }).layout;
    l = addItem(l, 0, ref(100, 100, { page: 0, drawingScale: 5000 }), { scale: 1 }).layout;
    const before = l.sheets[0].items.map(itemBox);
    const known: Record<number, number | null> = { 0: 5000, 3: 100 };
    const next = withDrawingScales(l, (_d, p) => known[p]);
    expect(next.sheets[0].items.map((it) => it.ref.drawingScale)).toEqual([100, 5000]);
    expect(next.sheets[0].items.map(itemBox)).toEqual(before);
    expect(scaleLabel(next.sheets[0].items[0])).toBe("p4 · 1:200");
    expect(withDrawingScales(next, (_d, p) => known[p])).toBe(next); // nothing new: the same layout
  });

  it("leaves pages of documents it doesn't know, and images, alone", () => {
    let l = addItem(layout(), 0, ref(100, 100, { drawingScale: 50 })).layout;
    l = addItem(l, 0, ref(100, 100, { kind: "image", drawingScale: null })).layout;
    expect(withDrawingScales(l, () => undefined)).toBe(l);
    const n = withDrawingScales(l, () => 20);
    expect(n.sheets[0].items.map((it) => it.ref.drawingScale)).toEqual([20, null]);
  });

  it("clears a scale the page turns out not to have", () => {
    const l = addItem(layout(), 0, ref(100, 100, { drawingScale: 50 })).layout;
    expect(withDrawingScales(l, () => null).sheets[0].items[0].ref.drawingScale).toBeNull();
  });
});

describe("labels and output", () => {
  it("labels by drawing scale or percentage", () => {
    expect(scaleLabel(item({ ref: ref(100, 100, { page: 2, drawingScale: 100 }), scale: 0.5 }))).toBe("p3 · 1:200");
    expect(scaleLabel(item({ ref: ref(100, 100, { page: 6 }), scale: 0.48 }))).toBe("p7 · 48%");
    expect(scaleLabel(item({ ref: ref(100, 100, { page: 8, drawingScale: 20 }), crop: { x0: 0, y0: 0, x1: 10, y1: 10 } }))).toBe("p9 crop · 1:20");
    expect(scaleLabel(item({ ref: ref(100, 100, { kind: "image", title: "Truss.jpg" }), scale: 0.5 }))).toBe("Truss.jpg · 50%");
    expect(sourceDescription(ref(A1.h, A1.w, { title: "Stage plan.pdf", drawingScale: 100 }))).toBe("Stage plan.pdf · source A1, 1:100");
  });

  it("labels with any mix of file name, page number and scale", () => {
    const it = item({ ref: ref(100, 100, { page: 2, drawingScale: 100, title: "Site plan.pdf" }), scale: 0.5 });
    expect(scaleLabel(it, { name: true, page: true, scale: true })).toBe("Site plan p3 · 1:200");
    expect(scaleLabel(it, { name: true, page: false, scale: true })).toBe("Site plan · 1:200");
    expect(scaleLabel(it, { name: true, page: false, scale: false })).toBe("Site plan");
    expect(scaleLabel(it, { name: false, page: false, scale: true })).toBe("1:200");
    expect(scaleLabel(it, { name: false, page: false, scale: false })).toBe("");
    expect(scaleLabel({ ...it, crop: { x0: 0, y0: 0, x1: 10, y1: 10 } }, { name: true, page: false, scale: false })).toBe("Site plan crop");
    const img = item({ ref: ref(100, 100, { kind: "image", title: "Truss.jpg" }), scale: 0.5 });
    expect(scaleLabel(img, { name: true, page: true, scale: true })).toBe("Truss.jpg · 50%");
  });

  it("shortens a long file name in the middle to fit the item", () => {
    const it = item({ ref: ref(100, 100, { page: 10, title: "BayouTowersFullDrawingSet_dwgs_1_13.pdf" }), scale: 0.069 });
    const all = { name: true, page: true, scale: true };
    expect(scaleLabel(it, all)).toBe("BayouTowersFullDrawingSet_dwgs_1_13 p11 · 6.9%");
    const short = scaleLabel(it, all, 30);
    expect(short.length).toBeLessThanOrEqual(30);
    expect(short).toMatch(/^Bayou.*\.\.\..*_13 p11 · 6\.9%$/);
  });

  it("leaves the label out when every part is off", () => {
    let l = addItem(layout(), 0, ref(100, 100, { docId: 1, path: "C:/a/Plan.pdf", title: "Plan.pdf" })).layout;
    l = updateItem(l, 0, l.sheets[0].items[0].id, { showName: false, showPage: false, showScale: false });
    expect(sheetJob(l, 0, { enabled: false, date: "" }).texts).toEqual([]);
    const img = item({ ref: ref(100, 100, { kind: "image", title: "Truss.jpg" }) });
    expect(labelParts(layout(), img)).toEqual({ name: true, page: false, scale: true });
  });

  it("shows file names automatically once the layout mixes files, unless chosen", () => {
    let l = addItem(layout(), 0, ref(100, 100, { docId: 1, path: "C:/a/Plan.pdf", title: "Plan.pdf" })).layout;
    l = addItem(l, 0, ref(100, 100, { docId: 1, path: "c:\\A\\plan.PDF", title: "Plan.pdf", page: 1 })).layout;
    const first = l.sheets[0].items[0];
    expect(layoutFileCount(l)).toBe(1); // same file, however the path is written
    expect(showsName(l, first)).toBe(false);
    l = addItem(l, 0, ref(100, 100, { docId: 2, path: "C:/a/Section.pdf", title: "Section.pdf" })).layout;
    expect(showsName(l, first)).toBe(true);
    expect(showsName(l, { ...first, showName: false })).toBe(false);
    expect(showsName(layout(), { ...first, showName: true })).toBe(true);
    const job = sheetJob(l, 0, { enabled: false, date: "" });
    expect(job.texts[0].text).toBe("Plan p1 · 100%");
  });

  it("puts the label under the item when there's room, else inside", () => {
    const area = { x0: 0, y0: 0, x1: 1000, y1: 500 };
    const under = labelText(item(), area);
    expect(under.y).toBeGreaterThan(120);
    const inside = labelText(item({ y: 395 }), area);
    expect(inside.y).toBeLessThan(495);
    expect(under.x + under.text.length * 5 * 0.52).toBeCloseTo(210, 6);
  });

  it("builds the job: items, borders, labels, stamp; empty sheets left out", () => {
    let l = addItem(layout(), 0, ref(200, 100, { title: "Stage.pdf" })).layout;
    l = updateItem(l, 0, 2, { border: true });
    l = addSheet(l);
    l = addItem(l, 1, ref(50, 50)).layout;
    l = addSheet(l);
    const job = manualToJob(l, { enabled: true, date: "08/11/2026" });
    expect(job.sheets).toHaveLength(2);
    expect(job.sheets[0].w).toBe(A3L.w);
    expect(job.sheets[0].items[0]).toMatchObject({ docId: 1, srcW: 200, srcH: 100, scale: 1, rotation: 0 });
    expect(job.sheets[0].lines).toHaveLength(4);
    expect(job.sheets[0].texts.map((t) => t.text)).toEqual(["p1 · 100%", "Stage.pdf · sheet 1 · 08/11/2026"]);
    expect(job.sheets[1].texts[1].text).toContain("sheet 2");
    expect(manualToJob(l, { enabled: false, date: "" }).sheets[0].texts).toHaveLength(1);
    expect(mmToPt(1)).toBeCloseTo(2.8346, 4);
  });
});
