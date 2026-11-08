// Edge cases of tile-region grouping and page-local tile ranges.

import { describe, expect, it } from "vitest";
import { groupIntoRegions, tileGrid, tileRangeForRect, TILE, type TileIndexRange } from "./tiles";
import { nextZoomPreset, ZOOM_PRESETS } from "../view/viewMath";

const cells = (r: TileIndexRange) => (r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1);
const contains = (r: TileIndexRange, i: number, j: number) => i >= r.i0 && i <= r.i1 && j >= r.j0 && j <= r.j1;

describe("groupIntoRegions edge cases", () => {
  it("every missing tile lands in exactly one region, and regions never exceed maxSide", () => {
    const missing: { i: number; j: number }[] = [];
    for (let j = 0; j < 19; j++) for (let i = 0; i < 23; i++) if ((i * 7 + j * 3) % 5 !== 0) missing.push({ i, j });
    for (const maxSide of [1, 2, 3, 8]) {
      const regs = groupIntoRegions(missing, maxSide);
      for (const r of regs) {
        expect(r.i1 - r.i0 + 1).toBeLessThanOrEqual(maxSide);
        expect(r.j1 - r.j0 + 1).toBeLessThanOrEqual(maxSide);
      }
      for (const t of missing) expect(regs.filter((r) => contains(r, t.i, t.j)).length).toBe(1);
    }
  });

  it("maxSide 1 gives one region per tile", () => {
    const missing = [{ i: 0, j: 0 }, { i: 5, j: 2 }, { i: 1, j: 1 }];
    const regs = groupIntoRegions(missing, 1);
    expect(regs.length).toBe(3);
    expect(regs.every((r) => cells(r) === 1)).toBe(true);
  });

  it("two far-apart tiles in different chunks stay separate", () => {
    const regs = groupIntoRegions([{ i: 0, j: 0 }, { i: 20, j: 20 }], 8);
    expect(regs).toEqual([{ i0: 0, i1: 0, j0: 0, j1: 0 }, { i0: 20, i1: 20, j0: 20, j1: 20 }]);
  });

  it("a ring of missing tiles (hole already cached) is still covered", () => {
    const missing: { i: number; j: number }[] = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (i === 0 || j === 0 || i === 3 || j === 3) missing.push({ i, j });
    const regs = groupIntoRegions(missing, 8);
    // One bounding box; the cached hole is re-covered by the region but not requested as tiles.
    expect(regs).toEqual([{ i0: 0, i1: 3, j0: 0, j1: 3 }]);
  });

  it("duplicates in the input don't produce duplicate regions", () => {
    const regs = groupIntoRegions([{ i: 2, j: 2 }, { i: 2, j: 2 }], 8);
    expect(regs.length).toBe(1);
  });

  it("chunk boundaries follow the missing set's minimum, not zero", () => {
    // Tiles 5..12 in one row with maxSide 8 fit one chunk starting at 5.
    const missing = Array.from({ length: 8 }, (_, k) => ({ i: 5 + k, j: 3 }));
    expect(groupIntoRegions(missing, 8)).toEqual([{ i0: 5, i1: 12, j0: 3, j1: 3 }]);
  });
});

describe("tileRangeForRect", () => {
  const size = { w: 1000, h: 600 };
  const rs = 2; // 2000 x 1200 device px: 4 x 3 tiles
  const grid = tileGrid(size, rs);

  it("whole page gives every tile", () => {
    expect(tileRangeForRect(0, 0, 1000, 600, 1000, 600, grid, rs)).toEqual({ i0: 0, i1: 3, j0: 0, j1: 2 });
  });

  it("a rect ending exactly on a tile edge doesn't include the next tile", () => {
    const edge = TILE / rs; // 256 pt
    expect(tileRangeForRect(0, 0, edge, edge, 1000, 600, grid, rs)).toEqual({ i0: 0, i1: 0, j0: 0, j1: 0 });
  });

  it("margin grows the range but stays on the page", () => {
    expect(tileRangeForRect(300, 300, 310, 310, 1000, 600, grid, rs, 1)).toEqual({ i0: 0, i1: 2, j0: 0, j1: 2 });
    expect(tileRangeForRect(0, 0, 10, 10, 1000, 600, grid, rs, 5)).toEqual({ i0: 0, i1: 3, j0: 0, j1: 2 });
  });

  it("rects off the page give null; rects partly off are clipped", () => {
    expect(tileRangeForRect(-50, -50, 0, 0, 1000, 600, grid, rs)).toBeNull();
    expect(tileRangeForRect(1000, 0, 1200, 600, 1000, 600, grid, rs)).toBeNull();
    expect(tileRangeForRect(-100, -100, 100, 100, 1000, 600, grid, rs)).toEqual({ i0: 0, i1: 0, j0: 0, j1: 0 });
    expect(tileRangeForRect(900, 550, 5000, 5000, 1000, 600, grid, rs)).toEqual({ i0: 3, i1: 3, j0: 2, j1: 2 });
  });
});

describe("zoom presets", () => {
  it("steps to the next preset in each direction", () => {
    expect(nextZoomPreset(1, 1)).toBe(1.5);
    expect(nextZoomPreset(1, -1)).toBe(0.75);
    expect(nextZoomPreset(0.6, 1)).toBe(0.75);
    expect(nextZoomPreset(0.6, -1)).toBe(0.5);
  });

  it("ignores a preset within 1% of the current zoom", () => {
    expect(nextZoomPreset(0.999, 1)).toBe(1.5);
    expect(nextZoomPreset(1.005, -1)).toBe(0.75);
  });

  it("returns null past the ends", () => {
    expect(nextZoomPreset(ZOOM_PRESETS[ZOOM_PRESETS.length - 1], 1)).toBeNull();
    expect(nextZoomPreset(0.05, -1)).toBeNull();
  });
});
