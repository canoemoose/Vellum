import { describe, expect, it } from "vitest";
import { type Pixels, type Rgb8, guessBackground, hardLimit, hasTransparency, knockOut, regionAt, regions } from "./knockout";

const WHITE: Rgb8 = [255, 255, 255];
const BLACK: Rgb8 = [0, 0, 0];

/** A picture from rows of characters: each character's colour from `key`. */
function pic(rows: string[], key: Record<string, [number, number, number, number]>): Pixels {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((r, y) => [...r].forEach((ch, x) => data.set(key[ch], (y * width + x) * 4)));
  return { data, width, height };
}

const alphaAt = (out: Uint8ClampedArray, p: Pixels, x: number, y: number) => out[(y * p.width + x) * 4 + 3];
const rgbAt = (out: Uint8ClampedArray, p: Pixels, x: number, y: number) => [...out.slice((y * p.width + x) * 4, (y * p.width + x) * 4 + 3)];

const KEY: Record<string, [number, number, number, number]> = {
  ".": [255, 255, 255, 255],
  "#": [0, 0, 0, 255],
  "r": [200, 30, 30, 255],
  " ": [0, 0, 0, 0],
};

// A black ring with white inside it, on white.
const RING = pic(["......", ".####.", ".#..#.", ".#..#.", ".####.", "......"], KEY);

describe("guessBackground", () => {
  it("takes the border's median colour", () => {
    expect(guessBackground(RING)).toEqual(WHITE);
    const mostlyRed = pic(["rrrr", "r..r", "rr#r"], KEY);
    expect(guessBackground(mostlyRed)).toEqual([200, 30, 30]);
  });

  it("ignores transparent border pixels, and falls back to white", () => {
    expect(guessBackground(pic(["  ", "  "], KEY))).toEqual(WHITE);
    expect(guessBackground(pic(["   ", " r ", "  r"], KEY))).toEqual([200, 30, 30]);
  });
});

describe("knockOut", () => {
  it("from the edges: clears the outside, keeps white inside a shape", () => {
    const out = knockOut(RING, { bg: WHITE, tolerance: 10, mode: "edges" });
    expect(alphaAt(out, RING, 0, 0)).toBe(0);
    expect(alphaAt(out, RING, 1, 1)).toBe(255);
    expect(alphaAt(out, RING, 2, 2)).toBe(255);
    expect(rgbAt(out, RING, 2, 2)).toEqual([255, 255, 255]);
  });

  it("everywhere: clears the inside too", () => {
    const out = knockOut(RING, { bg: WHITE, tolerance: 10, mode: "everywhere" });
    expect(alphaAt(out, RING, 0, 0)).toBe(0);
    expect(alphaAt(out, RING, 2, 2)).toBe(0);
    expect(alphaAt(out, RING, 1, 1)).toBe(255);
  });

  it("keeps colours that aren't the background", () => {
    const p = pic(["....", ".rr.", ".rr.", "...."], KEY);
    const out = knockOut(p, { bg: WHITE, tolerance: 30, mode: "edges" });
    expect(rgbAt(out, p, 1, 1)).toEqual([200, 30, 30]);
    expect(alphaAt(out, p, 1, 1)).toBe(255);
  });

  it("unmixes an anti-aliased edge: no pale fringe, alpha from how much ink it holds", () => {
    // White, then a pixel a quarter and one three quarters of the way to dark red, then dark red.
    const red: Rgb8 = [120, 0, 0];
    const mix = (f: number) => [255 + (red[0] - 255) * f, 255 * (1 - f), 255 * (1 - f), 255].map(Math.round) as [number, number, number, number];
    const p = pic(["..qtrrr", "..qtrrr"], { ...KEY, q: mix(0.25), t: mix(0.75), r: [...red, 255] });
    const out = knockOut(p, { bg: WHITE, tolerance: 20, mode: "edges" });
    expect(alphaAt(out, p, 1, 0)).toBe(0);
    expect(alphaAt(out, p, 2, 0)).toBeGreaterThan(55);
    expect(alphaAt(out, p, 2, 0)).toBeLessThan(75);
    expect(alphaAt(out, p, 3, 0)).toBeGreaterThan(180);
    expect(alphaAt(out, p, 3, 0)).toBeLessThan(200);
    // Both come out the logo's red, not pink.
    for (const x of [2, 3]) for (const [c, v] of rgbAt(out, p, x, 0).entries()) expect(Math.abs(v - red[c])).toBeLessThan(4);
    expect(alphaAt(out, p, 5, 0)).toBe(255);
  });

  it("doesn't flood through an outline", () => {
    // Inside the ring is near the background colour, but walled off by black.
    const out = knockOut(RING, { bg: WHITE, tolerance: 100, mode: "edges" });
    expect(alphaAt(out, RING, 2, 2)).toBe(255);
  });

  it("treats transparent pixels as background and leaves them clear", () => {
    const p = pic(["    ", " ## ", " ## ", "    "], KEY);
    const out = knockOut(p, { bg: WHITE, tolerance: 10, mode: "edges" });
    expect(alphaAt(out, p, 0, 0)).toBe(0);
    expect(alphaAt(out, p, 1, 1)).toBe(255);
  });

  it("at tolerance 0 only the exact colour goes", () => {
    const p = pic(["...", ".##", ".##"], { ...KEY, ".": [254, 255, 255, 255] });
    const out = knockOut(p, { bg: [254, 255, 255], tolerance: 0, mode: "everywhere" });
    expect(alphaAt(out, p, 0, 0)).toBe(0);
    expect(alphaAt(out, p, 1, 1)).toBe(255);
    const off = knockOut(p, { bg: WHITE, tolerance: 0, mode: "everywhere" });
    expect(alphaAt(off, p, 0, 0)).toBeGreaterThan(0);
  });

  it("leaves the source untouched", () => {
    const before = RING.data.slice();
    knockOut(RING, { bg: BLACK, tolerance: 50, mode: "everywhere" });
    expect(RING.data).toEqual(before);
  });
});

describe("tolerance", () => {
  it("is fine near zero, for a solid background with a little noise", () => {
    expect(hardLimit(0)).toBe(0);
    expect(hardLimit(10)).toBeLessThan(2);
    expect(hardLimit(20)).toBeCloseTo(5.12);
    expect(hardLimit(100)).toBe(128);
  });

  it("takes JPEG noise off a solid background at the default, and nothing of the logo", () => {
    // White paper with noise of up to 4, round a mid-grey mark.
    const p = pic(["ababa", "b##ab", "a##ba", "babab"], { ...KEY, a: [251, 253, 255, 255], b: [255, 252, 254, 255] });
    const out = knockOut(p, { bg: WHITE, tolerance: 20, mode: "edges" });
    expect(alphaAt(out, p, 0, 0)).toBe(0);
    expect(alphaAt(out, p, 1, 0)).toBe(0);
    expect(alphaAt(out, p, 1, 1)).toBe(255);
  });
});

describe("tidy", () => {
  it("overrules lone specks either way, but not a line a pixel wide", () => {
    // A speck of noise kept in the background, and a one-pixel line.
    const p = pic(["......", ".#....", "......", "######", "......"], KEY);
    const out = knockOut(p, { bg: WHITE, tolerance: 20, mode: "everywhere" });
    expect(alphaAt(out, p, 1, 1)).toBe(0);
    expect(alphaAt(out, p, 2, 3)).toBe(255);
  });
});

describe("hasTransparency", () => {
  it("is true for a picture on a transparent background, false for an opaque one", () => {
    expect(hasTransparency(pic(["   ", " # ", "   "], KEY))).toBe(true);
    expect(hasTransparency(RING)).toBe(false);
  });

  it("ignores a stray transparent pixel or two in a big picture", () => {
    const rows = Array.from({ length: 40 }, () => ".".repeat(40));
    rows[0] = " " + rows[0].slice(1);
    expect(hasTransparency(pic(rows, KEY))).toBe(false);
  });
});

// Two black rings on white: each has a white hole inside.
const TWO = pic([
  "...........",
  ".####.####.",
  ".#..#.#..#.",
  ".#..#.#..#.",
  ".####.####.",
  "...........",
], KEY);
/** A point at a pixel's centre, as fractions of the picture. */
const at = (p: Pixels, x: number, y: number): [number, number] => [(x + 0.5) / p.width, (y + 0.5) / p.height];

describe("holes", () => {
  it("removes only the holes chosen, outside only", () => {
    const out = knockOut(TWO, { bg: WHITE, tolerance: 10, mode: "edges", holes: [at(TWO, 2, 2)] });
    expect(alphaAt(out, TWO, 2, 2)).toBe(0);
    expect(alphaAt(out, TWO, 3, 3)).toBe(0);
    // The other ring's hole stays.
    expect(alphaAt(out, TWO, 7, 2)).toBe(255);
    expect(alphaAt(out, TWO, 1, 1)).toBe(255);
  });

  it("ignores a hole point that isn't the background's colour", () => {
    const out = knockOut(TWO, { bg: WHITE, tolerance: 10, mode: "edges", holes: [at(TWO, 1, 1)] });
    expect(alphaAt(out, TWO, 1, 1)).toBe(255);
    expect(alphaAt(out, TWO, 2, 2)).toBe(255);
  });
});

describe("regions", () => {
  it("numbers each background-coloured area, and knows which are outside", () => {
    const r = regions(TWO, { bg: WHITE, tolerance: 10 });
    const outside = regionAt(r, at(TWO, 0, 0));
    const holeA = regionAt(r, at(TWO, 2, 2));
    const holeB = regionAt(r, at(TWO, 7, 2));
    expect(r.outside.has(outside)).toBe(true);
    expect(holeA).toBeGreaterThan(0);
    expect(holeB).toBeGreaterThan(0);
    expect(holeA).not.toBe(holeB);
    expect(r.outside.has(holeA)).toBe(false);
    expect(regionAt(r, at(TWO, 3, 3))).toBe(holeA);
    // The ring itself isn't an area.
    expect(regionAt(r, at(TWO, 1, 1))).toBe(0);
  });
});
