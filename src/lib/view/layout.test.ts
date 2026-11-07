import { describe, expect, it } from "vitest";
import { PAGE_GAP, computeLayout, currentPage, pagesInRect } from "./layout";

const sizes = Array.from({ length: 300 }, () => ({ w: 595, h: 842 }));

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
