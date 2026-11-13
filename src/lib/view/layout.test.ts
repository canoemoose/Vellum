import { describe, expect, it } from "vitest";
import { PAGE_GAP, computeLayout, currentPage, pagesInRect } from "./layout";

const sizes = Array.from({ length: 300 }, () => ({ w: 595, h: 842 }));

describe("columns layout", () => {
  it("fills rows left to right in equal cells, centred on x = 0", () => {
    const l = computeLayout([{ w: 100, h: 140 }, { w: 80, h: 100 }, { w: 100, h: 140 }], "columns", 0, 2);
    const [a, b, c] = l.rects as { x: number; y: number; w: number; h: number }[];
    expect(l.bounds).toEqual({ x: -(200 + PAGE_GAP) / 2, y: 0, w: 200 + PAGE_GAP, h: 140 + PAGE_GAP + 140 });
    expect(a).toEqual({ x: l.bounds.x, y: 0, w: 100, h: 140 });
    expect(b.x).toBeCloseTo(l.bounds.x + 100 + PAGE_GAP + 10, 9); // centred in its cell
    expect(b.y).toBe(0);
    expect(c).toEqual({ x: l.bounds.x, y: 140 + PAGE_GAP, w: 100, h: 140 }); // next row
  });

  it("clamps the column count and copes with fewer pages than columns", () => {
    const one = computeLayout([{ w: 100, h: 100 }], "columns", 0, 4);
    expect(one.bounds).toEqual({ x: -50, y: 0, w: 100, h: 100 });
    const many = computeLayout(Array(20).fill({ w: 10, h: 10 }), "columns", 0, 99);
    expect(many.rects[6]!.y).toBe(10 + PAGE_GAP); // MAX_COLUMNS (6) per row
  });

  it("finds pages in a rect and the current page across columns", () => {
    const l = computeLayout(Array(6).fill({ w: 100, h: 100 }), "columns", 0, 3);
    const right = l.rects[5]!; // second row, third column
    expect(pagesInRect(l, { x: right.x + 10, y: right.y + 10, w: 10, h: 10 })).toEqual([5]);
    expect(currentPage(l, { x: right.x, y: right.y, w: 100, h: 100 })).toBe(5);
  });
});

describe("layout", () => {
  it("stacks pages with gaps, centred on x = 0", () => {
    const l = computeLayout(sizes, "continuous");
    expect(l.rects[0]).toEqual({ x: -297.5, y: 0, w: 595, h: 842 });
    expect(l.rects[1]!.y).toBe(842 + PAGE_GAP);
    expect(l.bounds.h).toBe(300 * 842 + 299 * PAGE_GAP);
  });

  it("single mode lays out only the current page", () => {
    const l = computeLayout(sizes, "single", 41);
    expect(l.rects.filter(Boolean).length).toBe(1);
    expect(l.rects[41]).toEqual({ x: -297.5, y: 0, w: 595, h: 842 });
  });

  it("finds pages in a rect by binary search", () => {
    const l = computeLayout(sizes, "continuous");
    const y = l.rects[150]!.y + 10;
    expect(pagesInRect(l, { x: -100, y, w: 200, h: 100 })).toEqual([150]);
    expect(pagesInRect(l, { x: -100, y: l.rects[10]!.y + 800, w: 200, h: 100 })).toEqual([10, 11]);
    expect(pagesInRect(l, { x: 5000, y, w: 10, h: 10 })).toEqual([]);
  });

  it("current page is the one with most visible area", () => {
    const l = computeLayout(sizes, "continuous");
    const r = l.rects[20]!;
    expect(currentPage(l, { x: -300, y: r.y + 600, w: 600, h: 400 })).toBe(20);
    expect(currentPage(l, { x: -300, y: r.y + 700, w: 600, h: 400 })).toBe(21);
  });
});
