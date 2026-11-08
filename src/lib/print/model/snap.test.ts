import { describe, expect, it } from "vitest";
import { GRID, snapMove, snapPoint } from "./snap";

const area = { x0: 10, y0: 10, x1: 410, y1: 290 };
const ALL = { margins: true, pages: true, grid: false };

describe("snapMove", () => {
  it("snaps a near edge to the margin and reports a guide", () => {
    const r = snapMove({ x0: 13, y0: 60, x1: 113, y1: 110 }, [], area, ALL, 5);
    expect(r.dx).toBeCloseTo(-3);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ axis: "x", at: 10 }]);
  });

  it("snaps the far edge and the centre too", () => {
    expect(snapMove({ x0: 300, y0: 100, x1: 408, y1: 150 }, [], area, ALL, 5).dx).toBeCloseTo(2);
    // Area centre x = 210; box centre 207 -> +3.
    expect(snapMove({ x0: 157, y0: 30, x1: 257, y1: 60 }, [], area, ALL, 5).dx).toBeCloseTo(3);
  });

  it("snaps to other items' edges, nearest wins", () => {
    const other = { x0: 200, y0: 50, x1: 300, y1: 120 };
    const r = snapMove({ x0: 302, y0: 118, x1: 352, y1: 168 }, [other], area, ALL, 5);
    expect(r.dx).toBeCloseTo(-2); // left edge to other's right edge
    expect(r.dy).toBeCloseTo(2); // top to other's bottom
    expect(r.guides).toHaveLength(2);
  });

  it("does nothing beyond the threshold or with snapping off", () => {
    expect(snapMove({ x0: 30, y0: 30, x1: 60, y1: 60 }, [], area, ALL, 5)).toEqual({ dx: 0, dy: 0, guides: [] });
    expect(snapMove({ x0: 12, y0: 12, x1: 60, y1: 60 }, [], area, { margins: false, pages: false, grid: false }, 5).dx).toBe(0);
    const other = { x0: 200, y0: 50, x1: 300, y1: 120 };
    expect(snapMove({ x0: 302, y0: 200, x1: 352, y1: 250 }, [other], area, { ...ALL, pages: false }, 5).dx).toBe(0);
  });

  it("snaps the leading edge to the 5 mm grid, without a guide", () => {
    const r = snapMove({ x0: GRID * 4 + 1, y0: GRID * 7 - 2, x1: GRID * 4 + 51, y1: GRID * 7 + 48 }, [], area, { margins: false, pages: false, grid: true }, 3);
    expect(r.dx).toBeCloseTo(-1);
    expect(r.dy).toBeCloseTo(2);
    expect(r.guides).toEqual([]);
  });

  it("prefers a margin or page over the grid when it's as close", () => {
    const r = snapMove({ x0: 11, y0: 100, x1: 61, y1: 140 }, [], area, { margins: true, pages: false, grid: true }, 5);
    expect(r.dx).toBeCloseTo(-1);
    expect(r.guides).toEqual([{ axis: "x", at: 10 }]);
  });
});

describe("snapPoint", () => {
  it("snaps a dragged corner", () => {
    const p = snapPoint(408, 292, [], area, ALL, 4);
    expect(p).toEqual({ x: 410, y: 290, guides: [{ axis: "x", at: 410 }, { axis: "y", at: 290 }] });
    expect(snapPoint(300, 200, [], area, ALL, 4)).toEqual({ x: 300, y: 200, guides: [] });
  });
});
