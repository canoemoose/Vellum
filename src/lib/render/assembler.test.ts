import { describe, expect, it } from "vitest";
import { RegionAssembler } from "./assembler";
import { tileGrid, tileSpec, type TileSpec } from "./tiles";

/** A band of w x h pixels whose every pixel is RGBA (v, v, v, 255). */
function band(w: number, h: number, v: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) a.set([v, v, v, 255], i * 4);
  return a;
}

/** Tiles of a 1200 x 700 page bitmap at rs = 1, region = whole page. */
function wholePage(): { tiles: TileSpec[]; region: { x: number; y: number; w: number; h: number } } {
  const grid = tileGrid({ w: 1200, h: 700 }, 1);
  const tiles: TileSpec[] = [];
  for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) tiles.push(tileSpec(grid, i, j));
  return { tiles, region: { x: 0, y: 0, w: 1200, h: 700 } };
}

describe("RegionAssembler", () => {
  it("completes tiles only when every band covering them has landed", () => {
    const { tiles, region } = wholePage(); // tiles: 3 cols (512, 512, 176) x 2 rows (512, 188)
    const asm = new RegionAssembler(region, tiles);
    // Vertical bands of 300 px (as for a landscape page split along x), out of order.
    expect(asm.addBand(300, 0, 300, 700, band(300, 700, 2))).toEqual([]);
    // Band 0 (0..300) finishes nothing: tile column 0 spans 0..512.
    expect(asm.addBand(0, 0, 300, 700, band(300, 700, 1))).toEqual([0, 3]);
    // 600..900 completes column 1 (512..1024)? No: needs 900..1024 too.
    expect(asm.addBand(600, 0, 300, 700, band(300, 700, 3))).toEqual([]);
    expect(asm.addBand(900, 0, 300, 700, band(300, 700, 4))).toEqual([1, 2, 4, 5]);
    expect(asm.complete).toBe(true);
  });

  it("copies band pixels to the right place in the region", () => {
    const { tiles, region } = wholePage();
    const asm = new RegionAssembler(region, tiles);
    asm.addBand(0, 0, 600, 700, band(600, 700, 10));
    asm.addBand(600, 0, 600, 700, band(600, 700, 20));
    const px = (x: number, y: number) => asm.pixels[(y * 1200 + x) * 4];
    expect(px(0, 0)).toBe(10);
    expect(px(599, 699)).toBe(10);
    expect(px(600, 0)).toBe(20);
    expect(px(1199, 699)).toBe(20);
  });

  it("handles full-width horizontal bands (portrait pages) with one copy each", () => {
    const tiles = [{ i: 0, j: 0, x: 0, y: 0, w: 100, h: 60 }];
    const asm = new RegionAssembler({ x: 0, y: 0, w: 100, h: 60 }, tiles);
    expect(asm.addBand(0, 0, 100, 25, band(100, 25, 7))).toEqual([]);
    expect(asm.addBand(0, 25, 100, 35, band(100, 35, 9))).toEqual([0]);
    expect(asm.pixels[(24 * 100 + 50) * 4]).toBe(7);
    expect(asm.pixels[(25 * 100 + 50) * 4]).toBe(9);
  });

  it("works for a region that doesn't start at the page origin", () => {
    // Region covering tiles (2,1)..(3,1) at page offset (1024, 512).
    const tiles = [
      { i: 2, j: 1, x: 1024, y: 512, w: 512, h: 512 },
      { i: 3, j: 1, x: 1536, y: 512, w: 100, h: 512 },
    ];
    const asm = new RegionAssembler({ x: 1024, y: 512, w: 612, h: 512 }, tiles);
    expect(asm.addBand(0, 0, 512, 512, band(512, 512, 1))).toEqual([0]);
    expect(asm.addBand(512, 0, 100, 512, band(100, 512, 2))).toEqual([1]);
  });

  it("ignores the parts of a band outside the region", () => {
    const tiles = [{ i: 0, j: 0, x: 0, y: 0, w: 10, h: 10 }];
    const asm = new RegionAssembler({ x: 0, y: 0, w: 10, h: 10 }, tiles);
    expect(asm.addBand(5, 0, 20, 10, band(20, 10, 3))).toEqual([]);
    expect(asm.addBand(0, 0, 5, 10, band(5, 10, 4))).toEqual([0]);
    expect(asm.pixels[9 * 4]).toBe(3);
  });

  it("rejects a band with too few bytes", () => {
    const asm = new RegionAssembler({ x: 0, y: 0, w: 10, h: 10 }, []);
    expect(() => asm.addBand(0, 0, 10, 10, new Uint8ClampedArray(10))).toThrow();
  });

  it("starts white and is complete at once with no tiles", () => {
    const asm = new RegionAssembler({ x: 0, y: 0, w: 2, h: 2 }, []);
    expect(asm.complete).toBe(true);
    expect([...asm.pixels].every((v) => v === 255)).toBe(true);
  });
});
