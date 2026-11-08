import { describe, expect, it } from "vitest";
import { align, autoArrange, distributeH, shelfPack } from "./arrange";
import { boxH, boxW, centreX, contains, overlaps } from "./geom";
import { type ManualLayout, addItem, areaOfLayout, emptyLayout, findItem, itemBox } from "./manual";
import { A3, ref, uniform } from "./testkit";

const A3L = { w: A3.h, h: A3.w };

function withItems(sizes: [number, number, number][]): { l: ManualLayout; ids: number[] } {
  let l = emptyLayout(A3L, uniform(5));
  const ids: number[] = [];
  for (const [w, h, x] of sizes) {
    const r = addItem(l, 0, ref(w, h), { scale: 1, at: { x: x + w / 2, y: 200 + h / 2 } });
    l = r.layout;
    ids.push(r.id);
  }
  return { l, ids };
}

const boxes = (l: ManualLayout) => l.sheets[0].items.map(itemBox);

describe("align", () => {
  it("aligns several items to each other", () => {
    const { l, ids } = withItems([[100, 50, 50], [80, 30, 300], [60, 60, 500]]);
    const left = align(l, 0, ids, "left");
    expect(boxes(left).map((b) => b.x0)).toEqual([50, 50, 50]);
    const top = align(l, 0, ids.slice(0, 2), "top");
    expect(boxes(top)[0].y0).toBe(boxes(top)[1].y0);
    expect(boxes(top)[2]).toEqual(boxes(l)[2]); // not selected
    const mid = align(l, 0, ids, "centre");
    const cx = (50 + 560) / 2;
    expect(boxes(mid).map(centreX).every((c) => Math.abs(c - cx) < 1e-9)).toBe(true);
  });

  it("aligns a single item to the printable area", () => {
    const { l, ids } = withItems([[100, 50, 200]]);
    const a = areaOfLayout(l);
    expect(boxes(align(l, 0, ids, "left"))[0].x0).toBeCloseTo(a.x0);
    expect(boxes(align(l, 0, ids, "top"))[0].y0).toBeCloseTo(a.y0);
    expect(centreX(boxes(align(l, 0, ids, "centre"))[0])).toBeCloseTo(centreX(a));
    expect(align(l, 0, [], "left")).toBe(l);
    expect(align(l, 5, ids, "left")).toBe(l);
  });
});

describe("distribute", () => {
  it("evens the gaps between three or more, keeping the outer two", () => {
    const { l, ids } = withItems([[100, 50, 0], [50, 50, 120], [100, 50, 400]]);
    const d = distributeH(l, 0, ids);
    const b = boxes(d).sort((p, q) => p.x0 - q.x0);
    expect(b[0].x0).toBe(0);
    expect(b[2].x1).toBe(500);
    expect(b[1].x0 - b[0].x1).toBeCloseTo(b[2].x0 - b[1].x1);
  });

  it("spreads one or two across the printable area", () => {
    const { l, ids } = withItems([[100, 50, 300], [100, 50, 100]]);
    const a = areaOfLayout(l);
    const b = boxes(distributeH(l, 0, ids)).sort((p, q) => p.x0 - q.x0);
    expect(b[0].x0).toBeCloseTo(a.x0);
    expect(b[1].x1).toBeCloseTo(a.x1);
    const one = withItems([[100, 50, 30]]);
    expect(centreX(boxes(distributeH(one.l, 0, one.ids))[0])).toBeCloseTo(centreX(a));
  });
});

describe("auto-arrange", () => {
  it("packs rows without overlaps, inside the area, keeping scales when they fit", () => {
    const { l } = withItems([[200, 150, 0], [300, 100, 0], [150, 150, 0], [100, 50, 0]]);
    const r = autoArrange(l, 0);
    const a = areaOfLayout(r);
    const b = boxes(r);
    for (let i = 0; i < b.length; i++) {
      expect(contains(a, b[i])).toBe(true);
      for (let j = i + 1; j < b.length; j++) expect(overlaps(b[i], b[j])).toBe(false);
    }
    expect(r.sheets[0].items.every((it) => it.scale === 1)).toBe(true);
    expect(r.sheets[0].items.map((it) => it.id)).toEqual(l.sheets[0].items.map((it) => it.id)); // order kept
  });

  it("shrinks everything by one factor when it doesn't fit", () => {
    const { l } = withItems([[900, 600, 0], [900, 600, 0], [300, 300, 0]]);
    const r = autoArrange(l, 0);
    const k = r.sheets[0].items[0].scale;
    expect(k).toBeLessThan(1);
    expect(r.sheets[0].items.every((it) => Math.abs(it.scale - k) < 1e-12)).toBe(true);
    const a = areaOfLayout(r);
    const b = boxes(r);
    b.forEach((x) => expect(contains(a, x)).toBe(true));
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) expect(overlaps(b[i], b[j])).toBe(false);
    // Tight: a little bigger wouldn't fit.
    const w = boxW(b[0]) / k;
    expect(w).toBeCloseTo(900);
    expect(findItem(r, 0, r.sheets[0].items[2].id)!.scale).toBeCloseTo(k);
    expect(boxH(b[2])).toBeCloseTo(300 * k);
  });

  it("leaves an empty sheet alone", () => {
    const l = emptyLayout(A3L, uniform(5));
    expect(autoArrange(l, 0)).toBe(l);
  });

  it("shelf packing wraps rows and reports overflow", () => {
    const p = shelfPack([{ w: 60, h: 10 }, { w: 60, h: 20 }, { w: 30, h: 5 }], 100, 100, 5);
    expect(p.pos).toEqual([{ x: 0, y: 0 }, { x: 0, y: 15 }, { x: 65, y: 15 }]);
    expect(p.fits).toBe(true);
    expect(p.height).toBe(35);
    expect(shelfPack([{ w: 101, h: 1 }], 100, 100, 5).fits).toBe(false);
    expect(shelfPack([{ w: 10, h: 101 }], 100, 100, 5).fits).toBe(false);
  });
});
