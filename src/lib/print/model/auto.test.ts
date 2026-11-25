import { describe, expect, it } from "vitest";
import { autoLayout, cutMarks, layoutSummary, nUpCells, nUpGrid, sizingInfo, tileGrid, tileName } from "./auto";
import { boxH, boxW, contains, mmToPt, ptToMm } from "./geom";
import { STAMP_STRIP } from "./job";
import { A0, A1, A3, A4, close, input, ref, src, uniform } from "./testkit";

const A1L = { w: A1.h, h: A1.w };

describe("Fit", () => {
  it("fits an A1 landscape drawing on A3 landscape within the printer margins, centred", () => {
    const m = uniform(4.2);
    const r = autoLayout(input([src(ref(A1L.w, A1L.h, { drawingScale: 100 }))], {}, { printerMargins: { portrait: m, landscape: m } }));
    expect(r.job.sheets).toHaveLength(1);
    const sh = r.sheets[0];
    expect(close(sh.size.w, A3.h) && close(sh.size.h, A3.w)).toBe(true); // auto-rotated to landscape
    const p = sh.placed[0];
    // Height-limited: 288.6 / 594.
    expect(p.factor).toBeCloseTo((297 - 8.4) / 594, 6);
    expect(contains(sh.area, p.box)).toBe(true);
    expect(p.box.x0 - sh.area.x0).toBeCloseTo(sh.area.x1 - p.box.x1, 6); // centred
    // The mockup's info line.
    expect(sizingInfo(input([]).options, sh)).toEqual({ text: "A1 on A3 prints at 1:206. Choose “To scale” for exactly 1:200.", warn: false });
  });

  it("fits to the full paper when asked", () => {
    const r = autoLayout(input([src(ref(A4.w * 2, A4.h * 2))], { fitTo: "paper", autoRotate: false }));
    const p = r.sheets[0].placed[0];
    expect(close(boxW(p.box), A3.w, 1e-6) || close(boxH(p.box), A3.h, 1e-6)).toBe(true);
    expect(p.box.x0).toBeCloseTo(0, 1);
  });

  it("enlarges small pages unless shrink-oversized-only is on", () => {
    expect(autoLayout(input([src(ref(A4.w, A4.h))], { autoRotate: false })).sheets[0].placed[0].factor).toBeGreaterThan(1.3);
    expect(autoLayout(input([src(ref(A4.w, A4.h))], { shrinkOversized: true })).sheets[0].placed[0].factor).toBe(1);
    const big = autoLayout(input([src(ref(A1.w, A1.h))], { shrinkOversized: true })).sheets[0].placed[0].factor;
    expect(big).toBeLessThan(1);
  });

  it("keeps the chosen orientation when auto-rotate is off", () => {
    const r = autoLayout(input([src(ref(A1L.w, A1L.h))], { autoRotate: false, landscape: false }));
    expect(r.sheets[0].size.w).toBeLessThan(r.sheets[0].size.h);
  });

  it("puts the page at the top-left when not centring", () => {
    const r = autoLayout(input([src(ref(A1L.w, A1L.h))], { centre: false }));
    const sh = r.sheets[0];
    expect(sh.placed[0].box.x0).toBeCloseTo(sh.area.x0, 6);
    expect(sh.placed[0].box.y0).toBeCloseTo(sh.area.y0, 6);
  });

  it("emits a job item matching the placement", () => {
    const s = src(ref(200, 100, { docId: 7, page: 3, path: "x.pdf" }));
    const r = autoLayout(input([s], { autoRotate: false }));
    const it = r.job.sheets[0].items[0];
    const p = r.sheets[0].placed[0];
    expect(it).toMatchObject({ docId: 7, page: 3, path: "x.pdf", srcW: 200, srcH: 100, crop: null, rotation: 0 });
    expect(it.x).toBeCloseTo(p.box.x0);
    expect(it.y).toBeCloseTo(p.box.y0);
    expect(it.scale).toBeCloseTo(p.factor);
  });

  it("fits a crop (View / Marquee) rather than the page", () => {
    const crop = { x0: 100, y0: 100, x1: 200, y1: 150 };
    const r = autoLayout(input([src(ref(A1.w, A1.h), crop)], { autoRotate: true }));
    const p = r.sheets[0].placed[0];
    expect(r.sheets[0].size.w).toBeGreaterThan(r.sheets[0].size.h); // 2:1 crop goes landscape
    expect(boxW(p.box) / boxH(p.box)).toBeCloseTo(2, 6);
    expect(r.job.sheets[0].items[0].crop).toEqual(crop);
  });
});

describe("Actual and To scale", () => {
  it("prints at 100%, centred, even when it overflows", () => {
    const r = autoLayout(input([src(ref(A1.w, A1.h))], { sizing: "actual" }));
    const p = r.sheets[0].placed[0];
    expect(p.factor).toBe(1);
    expect(boxW(p.box)).toBeCloseTo(A1.w);
  });

  it("prints a 1:100 A1 drawing at exactly 1:200 on A3", () => {
    const r = autoLayout(input([src(ref(A1L.w, A1L.h, { drawingScale: 100 }))], { sizing: "scale", scaleRatio: 200 }));
    const sh = r.sheets[0];
    expect(sh.placed[0].factor).toBeCloseTo(0.5, 9);
    // A known dimension: 1 m at 1:200 is 5 mm on paper; the page is 841 mm wide at 1:100 so
    // 84.1 m real, 420.5 mm printed.
    expect(ptToMm(boxW(sh.placed[0].box))).toBeCloseTo(420.5, 6);
    expect(sizingInfo({ ...input([]).options, sizing: "scale", scaleRatio: 200 }, sh)).toEqual({ text: "At 1:200 the page is 11 mm bigger than the printable area, so its outer edge may not print.", warn: true });
  });

  it("says when To scale fits exactly", () => {
    const r = autoLayout(input([src(ref(A1L.w, A1L.h, { drawingScale: 100 }))], { sizing: "scale", scaleRatio: 250 }));
    expect(sizingInfo({ ...input([]).options, sizing: "scale", scaleRatio: 250 }, r.sheets[0])).toEqual({ text: "A1 on A3 prints at exactly 1:250.", warn: false });
  });

  it("prints at a percentage when the drawing scale is unknown", () => {
    const r = autoLayout(input([src(ref(500, 300))], { sizing: "scale", scaleRatio: 200, scalePercent: 50 }));
    expect(r.sheets[0].placed[0].factor).toBe(0.5);
    const info = sizingInfo({ ...input([]).options, sizing: "scale", scalePercent: 50 }, r.sheets[0]);
    expect(info).toMatchObject({ text: expect.stringMatching(/prints at 50%\. Set the drawing scale/), warn: false });
  });

  it("never shrinks in Actual, and says when a page won't fit", () => {
    // A remembered Shrink setting from Fit or To scale must not undo actual size.
    const o = { sizing: "actual" as const, shrinkOversized: true };
    const r = autoLayout(input([src(ref(A0.w, A0.h, { drawingScale: 100 })), src(ref(A4.w, A4.h, { drawingScale: 100 }))], o));
    expect(r.sheets[0].placed[0].factor).toBe(1);
    expect(r.sheets[1].placed[0].factor).toBe(1);
    const opts = { ...input([]).options, ...o };
    expect(sizingInfo(opts, r.sheets[0])).toEqual({ text: "A0 on A3 is bigger than the printable area at actual size, so part of it won't print. Choose Tile, Fit or a bigger paper.", warn: true });
    expect(sizingInfo(opts, r.sheets[1])).toEqual({ text: "A4 on A3 prints at 1:100, the drawing's own scale.", warn: false });
  });

  it("never shrinks in To scale, and says when a page won't fit", () => {
    const o = { sizing: "scale" as const, shrinkOversized: true, scaleRatio: 100 };
    const r = autoLayout(input([src(ref(A0.w, A0.h, { drawingScale: 100 })), src(ref(A4.w, A4.h, { drawingScale: 100 }))], o));
    expect(r.sheets[0].placed[0].factor).toBe(1);
    expect(r.sheets[1].placed[0].factor).toBe(1);
    expect(sizingInfo({ ...input([]).options, ...o }, r.sheets[0])).toEqual({ text: "At 1:100 the page is bigger than the printable area. Choose Tile, or a smaller scale.", warn: true });
  });

  it("describes Fit without a drawing scale as a percentage", () => {
    const r = autoLayout(input([src(ref(A1.w, A1.h))]));
    expect(sizingInfo(input([]).options, r.sheets[0])?.text).toMatch(/^A1 on A3 prints at \d+% of actual size\.$/);
  });
});

describe("Margins", () => {
  it("uses the printer's margins for the sheet's orientation", () => {
    const portrait = { left: 10, top: 20, right: 30, bottom: 40 };
    const landscape = { left: 1, top: 2, right: 3, bottom: 4 };
    const r = autoLayout(input([src(ref(800, 400))], {}, { printerMargins: { portrait, landscape } }));
    expect(r.sheets[0].area).toEqual({ x0: 1, y0: 2, x1: A3.h - 3, y1: A3.w - 4 });
  });

  it("supports none and custom", () => {
    const none = autoLayout(input([src(ref(800, 400))], { marginMode: "none" }));
    expect(none.sheets[0].area.x0).toBe(0);
    const custom = autoLayout(input([src(ref(800, 400))], { marginMode: "custom", customMarginMm: 15 }));
    expect(custom.sheets[0].area.x0).toBeCloseTo(mmToPt(15));
  });

  it("keeps a strip for the stamp and writes it there", () => {
    const r = autoLayout(input([src(ref(A1L.w, A1L.h, { title: "Stage.pdf", page: 2 }))], { stamp: true }));
    const sh = r.sheets[0];
    expect(sh.contentArea.y1).toBeCloseTo(sh.area.y1 - STAMP_STRIP);
    expect(sh.placed[0].box.y1).toBeLessThanOrEqual(sh.contentArea.y1 + 1e-6);
    const t = r.job.sheets[0].texts[0];
    expect(t.text).toBe("Stage.pdf · p3 · 08/11/2026 19:12");
    expect(t.y).toBeGreaterThan(sh.contentArea.y1);
    expect(t.y).toBeLessThan(sh.area.y1);
  });

  it("draws page borders", () => {
    const r = autoLayout(input([src(ref(300, 200))], { borders: true }));
    expect(r.job.sheets[0].lines).toHaveLength(4);
  });
});

describe("n-up", () => {
  it("grids along the long side", () => {
    expect(nUpGrid(2, true)).toEqual({ cols: 2, rows: 1 });
    expect(nUpGrid(2, false)).toEqual({ cols: 1, rows: 2 });
    expect(nUpGrid(6, true)).toEqual({ cols: 3, rows: 2 });
    expect(nUpGrid(16, false)).toEqual({ cols: 4, rows: 4 });
  });

  it("orders across then down, or down then across", () => {
    const area = { x0: 0, y0: 0, x1: 206, y1: 206 };
    const across = nUpCells(area, 4, true, "across", 6);
    expect(across.map((c) => [c.x0, c.y0])).toEqual([[0, 0], [106, 0], [0, 106], [106, 106]]);
    const down = nUpCells(area, 4, true, "down", 6);
    expect(down.map((c) => [c.x0, c.y0])).toEqual([[0, 0], [0, 106], [106, 0], [106, 106]]);
  });

  it("puts four pages per sheet, each inside its cell, and starts a new sheet after", () => {
    const pages = Array.from({ length: 5 }, (_, i) => src(ref(A4.w, A4.h, { page: i })));
    const r = autoLayout(input(pages, { nUp: 4, autoRotate: false, landscape: false, stamp: true }));
    expect(r.job.sheets.map((s) => s.items.length)).toEqual([4, 1]);
    const cells = nUpCells(r.sheets[0].contentArea, 4, false, "across");
    r.sheets[0].placed.forEach((p, i) => expect(contains(cells[i], p.box)).toBe(true));
    expect(r.job.sheets[0].texts[0].text).toContain("p1-4");
  });

  it("rotates pages within cells when that fits them larger", () => {
    const pages = [src(ref(A4.h, A4.w)), src(ref(A4.h, A4.w))]; // landscape pages
    const r = autoLayout(input(pages, { nUp: 2, autoRotate: false, landscape: false }));
    // Portrait sheet, two cells stacked: landscape pages fit without rotation.
    expect(r.sheets[0].placed.every((p) => p.rotation === 0)).toBe(true);
    const r2 = autoLayout(input([src(ref(A4.w, A4.h)), src(ref(A4.w, A4.h))], { nUp: 2, autoRotate: true, landscape: false }));
    // Auto-rotate may turn the sheet instead; either way each page ends up larger than unrotated.
    const plain = autoLayout(input([src(ref(A4.w, A4.h)), src(ref(A4.w, A4.h))], { nUp: 2, autoRotate: false, landscape: false }));
    expect(r2.sheets[0].placed[0].factor).toBeGreaterThan(plain.sheets[0].placed[0].factor - 1e-9);
  });

  it("shrinks but never enlarges in Actual", () => {
    const r = autoLayout(input([src(ref(100, 100)), src(ref(A1.w, A1.h))], { nUp: 2, sizing: "actual" }));
    expect(r.sheets[0].placed[0].factor).toBe(1);
    expect(r.sheets[0].placed[1].factor).toBeLessThan(1);
  });

  it("job items carry the rotation", () => {
    const r = autoLayout(input([src(ref(A4.w, A4.h))], { nUp: 2, autoRotate: true, landscape: true }));
    expect(r.job.sheets[0].items[0].rotation).toBe(r.sheets[0].placed[0].rotation);
  });
});

describe("Tile", () => {
  it("computes the grid with overlap", () => {
    // 1000 wide over 400-wide areas with 20 overlap: steps of 380; 3 tiles cover 1160.
    const g = tileGrid(1000, 300, 400, 400, 20, true);
    expect(g.cols).toBe(3);
    expect(g.rows).toBe(1);
    expect(g.stepX).toBe(380);
    expect(g.offX).toBeCloseTo((3 * 380 + 20 - 1000) / 2);
    expect(g.offY).toBeCloseTo((380 + 20 - 300) / 2);
    expect(tileGrid(400, 400, 400, 400, 20, true)).toMatchObject({ cols: 1, rows: 1 });
    expect(tileGrid(401, 400, 400, 400, 20, false)).toMatchObject({ cols: 2, rows: 1, offX: 0 });
  });

  it("names tiles by row letter and column number", () => {
    expect(tileName(0, 0)).toBe("A1");
    expect(tileName(2, 1)).toBe("B3");
    expect(tileName(0, 26)).toBe("AA1");
  });

  it("tiles an A0 drawing onto A3 at 100% with overlap, clip and cut marks", () => {
    const r = autoLayout(input([src(ref(A0.w, A0.h, { title: "aerial.pdf" }))], { sizing: "tile", tileOverlapMm: 10, stamp: true }));
    const n = r.sheets.length;
    expect(n).toBeGreaterThan(4);
    const first = r.sheets[0];
    const cw = boxW(first.contentArea);
    const ch = boxH(first.contentArea);
    const g = tileGrid(A0.w, A0.h, cw, ch, mmToPt(10), true);
    expect(n).toBe(g.cols * g.rows);
    // Auto-rotate picked the orientation with fewer tiles.
    const fixed = (landscape: boolean) =>
      autoLayout(input([src(ref(A0.w, A0.h))], { sizing: "tile", tileOverlapMm: 10, stamp: true, autoRotate: false, landscape })).sheets.length;
    expect(n).toBe(Math.min(fixed(true), fixed(false)));
    // Every sheet: one item at 100%, clipped to its tile area, with 8 cut mark lines.
    for (const [i, s] of r.job.sheets.entries()) {
      expect(s.items).toHaveLength(1);
      expect(s.items[0].scale).toBe(1);
      expect(s.clip).toEqual(r.sheets[i].contentArea);
      expect(s.lines).toHaveLength(8);
      expect(s.texts[0].text).toMatch(/^aerial\.pdf · p1 · tile [A-Z]\d+ of \d+×\d+ · /);
    }
    // Neighbouring tiles overlap by 10 mm of the drawing.
    const a = r.job.sheets[0].items[0];
    const b = r.job.sheets[1].items[0];
    expect(a.x - b.x).toBeCloseTo(cw - mmToPt(10), 6);
    // The tiles together cover the whole drawing.
    const last = r.job.sheets[n - 1];
    const cover = { x1: last.clip!.x1 - last.items[0].x, y1: last.clip!.y1 - last.items[0].y };
    expect(cover.x1).toBeGreaterThanOrEqual(A0.w - 1e-6);
    expect(cover.y1).toBeGreaterThanOrEqual(A0.h - 1e-6);
    expect(first.contentArea.x0 - a.x).toBeLessThanOrEqual(1e-6); // drawing starts within tile A1
  });

  it("puts cut marks outside the clip, within the printable area", () => {
    const b = { x0: 20, y0: 20, x1: 200, y1: 300 };
    const marks = cutMarks(b);
    expect(marks).toHaveLength(8);
    for (const l of marks) {
      const inside = (x: number, y: number) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;
      expect(inside(l.x0, l.y0) || inside(l.x1, l.y1)).toBe(false);
      expect(Math.min(l.x0, l.x1)).toBeGreaterThanOrEqual(b.x0 - 8);
      expect(Math.min(l.y0, l.y1)).toBeGreaterThanOrEqual(b.y0 - 8);
    }
  });

  it("a page that fits prints on one tile", () => {
    const r = autoLayout(input([src(ref(A4.w, A4.h))], { sizing: "tile" }));
    expect(r.job.sheets).toHaveLength(1);
  });
});

describe("Paper by page size", () => {
  it("picks the printer paper matching each page when tray-by-size is on", () => {
    const papers = [A4, A3, A1];
    const r = autoLayout(input([src(ref(A1.w, A1.h)), src(ref(A4.h, A4.w)), src(ref(300, 300))], { trayBySize: true }, { papers }));
    expect(close(Math.max(r.sheets[0].size.w, r.sheets[0].size.h), A1.h)).toBe(true);
    expect(close(r.sheets[1].size.w, A4.h) && close(r.sheets[1].size.h, A4.w)).toBe(true);
    expect(close(Math.max(r.sheets[2].size.w, r.sheets[2].size.h), A3.h)).toBe(true); // no match: chosen paper
  });
});

describe("Summary", () => {
  it("describes the layout section", () => {
    expect(layoutSummary(input([]).options)).toBe("1 per sheet · printer margins · centred");
    expect(layoutSummary({ ...input([]).options, nUp: 4, marginMode: "custom", customMarginMm: 12, centre: false, borders: true }))
      .toBe("4 per sheet · 12 mm margins · borders");
  });
});
