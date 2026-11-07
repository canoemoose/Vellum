import { describe, expect, it } from "vitest";
import { TILE, TileCache, groupIntoRegions, scaleKey, tileGrid, tileKey, tileSpec, visibleTileRange, type Tile } from "./tiles";

function fakeTile(page: number, rs: number, i: number, j: number, bytes = 1000): Tile & { closed: boolean } {
  const t = {
    key: tileKey(page, rs, i, j), page, rs, i, j, w: 10, h: 10, bytes, closed: false,
    bitmap: { close: () => { t.closed = true; } } as unknown as ImageBitmap,
  };
  return t;
}

describe("tile grid", () => {
  it("covers the page exactly with smaller edge tiles", () => {
    const g = tileGrid({ w: 2384, h: 1684 }, 1.5); // A1 landscape at 1.5 device px/pt
    expect(g.devW).toBe(3576);
    expect(g.cols).toBe(Math.ceil(3576 / TILE));
    const last = tileSpec(g, g.cols - 1, g.rows - 1);
    expect(last.x + last.w).toBe(g.devW);
    expect(last.y + last.h).toBe(g.devH);
    expect(last.w).toBeLessThanOrEqual(TILE);
  });

  it("scale keys are stable for float noise", () => {
    expect(scaleKey(2.0000000001)).toBe(scaleKey(1.9999999999));
  });
});

describe("visible tile range", () => {
  const page = { x: 0, y: 0, w: 1000, h: 1000 };
  const rs = 2;
  const grid = tileGrid(page, rs); // 2000 x 2000 device px -> 4 x 4 tiles

  it("whole page visible gives all tiles", () => {
    const r = visibleTileRange(page, grid, { scale: 0.5, tx: 0, ty: 0 }, 1000, 1000, rs);
    expect(r).toEqual({ i0: 0, i1: 3, j0: 0, j1: 3 });
  });

  it("a zoomed-in viewport picks the right tiles", () => {
    // scale 2 CSS px/pt; viewport shows world x 300..400, y 0..50
    const view = { scale: 2, tx: -600, ty: 0 };
    const r = visibleTileRange(page, grid, view, 200, 100, rs)!;
    // device x 600..800 -> tile 1; device y 0..100 -> tile 0
    expect(r).toEqual({ i0: 1, i1: 1, j0: 0, j1: 0 });
    const m = visibleTileRange(page, grid, view, 200, 100, rs, 1)!;
    expect(m).toEqual({ i0: 0, i1: 2, j0: 0, j1: 1 });
  });

  it("off-screen page gives null", () => {
    expect(visibleTileRange(page, grid, { scale: 1, tx: 5000, ty: 0 }, 800, 600, rs)).toBeNull();
  });
});

describe("region grouping", () => {
  it("merges missing tiles into bounding boxes no bigger than maxSide", () => {
    const missing = [];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 10; i++) missing.push({ i, j });
    const regs = groupIntoRegions(missing, 8);
    expect(regs).toEqual([
      { i0: 0, i1: 7, j0: 0, j1: 4 },
      { i0: 8, i1: 9, j0: 0, j1: 4 },
    ]);
  });

  it("a single missing tile is a single region", () => {
    expect(groupIntoRegions([{ i: 3, j: 7 }], 8)).toEqual([{ i0: 3, i1: 3, j0: 7, j1: 7 }]);
  });

  it("empty in, empty out", () => {
    expect(groupIntoRegions([], 8)).toEqual([]);
  });
});

describe("LRU tile cache", () => {
  it("evicts least recently used first and closes bitmaps", () => {
    const c = new TileCache(3000);
    const a = fakeTile(0, 1, 0, 0);
    const b = fakeTile(0, 1, 1, 0);
    const d = fakeTile(0, 1, 2, 0);
    c.put(a);
    c.put(b);
    c.put(d);
    c.touch(a); // a is now most recent; b is oldest
    c.put(fakeTile(0, 1, 3, 0));
    expect(b.closed).toBe(true);
    expect(c.peek(0, 1, 1, 0)).toBeUndefined();
    expect(c.peek(0, 1, 0, 0)).toBe(a);
    expect(c.bytes).toBe(3000);
    expect(c.evictions).toBe(1);
  });

  it("indexes by page and scale", () => {
    const c = new TileCache(1e9);
    c.put(fakeTile(2, 1.5, 0, 0));
    c.put(fakeTile(2, 3, 0, 0));
    c.put(fakeTile(4, 3, 0, 0));
    expect(c.scalesFor(2).sort()).toEqual([1.5, 3]);
    c.dropOtherScales(2, [3]);
    expect(c.scalesFor(2)).toEqual([3]);
    expect(c.size).toBe(2);
  });

  it("replacing a key does not double count bytes", () => {
    const c = new TileCache(1e9);
    c.put(fakeTile(0, 1, 0, 0, 500));
    c.put(fakeTile(0, 1, 0, 0, 700));
    expect(c.bytes).toBe(700);
    expect(c.size).toBe(1);
  });
});
