import { describe, expect, it } from "vitest";
import { blackLines, blackLinesIn, blackMargin, isDarkSheet } from "./blackLines";

/** A `w` x `h` grey RGBA picture from a function of x, y. */
function picture(w: number, h: number, f: (x: number, y: number) => number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = f(x, y);
      d[i + 3] = 255;
    }
  }
  return d;
}
const black = (d: Uint8ClampedArray, w: number, x: number, y: number) => d[(y * w + x) * 4] === 0;

// The same cases as the Rust tests (tests/print_geometry.rs), so preview and print agree.
describe("black lines (preview)", () => {
  it("maps sensitivity to a margin as the printed output does", () => {
    expect(blackMargin(0)).toBe(100);
    expect(blackMargin(60)).toBe(20);
    expect(blackMargin(100)).toBe(5);
  });

  it("drops everything at the far end, solid black included", () => {
    const d = picture(30, 30, (x, y) => (x === 15 ? 0 : y > 20 ? 5 : 255));
    blackLines(d, 30, 0, 3, false);
    for (let i = 0; i < d.length; i += 4) expect(d[i]).toBe(255);
  });

  it("drops paper texture and uneven tone, keeps a faint line", () => {
    const w = 40;
    const h = 20;
    const d = picture(w, h, (x, y) => {
      const paper = 220 - x * 2 + ((x + y) % 3 === 0 ? 6 : 0);
      return x === 20 ? paper - 50 : paper;
    });
    blackLines(d, w, 60, 3, false);
    for (let y = 0; y < h; y++) {
      expect(black(d, w, 20, y)).toBe(true);
      for (const x of [2, 10, 30, 38]) expect(black(d, w, x, y)).toBe(false);
    }
  });

  it("lets sensitivity decide how faint a line counts", () => {
    const make = () => picture(30, 10, (x) => (x === 15 ? 190 : 230));
    const strict = make();
    blackLines(strict, 30, 0, 3, false);
    expect(black(strict, 30, 15, 5)).toBe(false);
    const keen = make();
    blackLines(keen, 30, 100, 3, false);
    expect(black(keen, 30, 15, 5)).toBe(true);
  });

  it("keeps solid black and drops pale fills", () => {
    const d = picture(40, 40, (x, y) => (x >= 5 && x < 18 && y >= 5 && y < 35 ? 215 : x >= 25 && y >= 5 && y < 35 ? 10 : 255));
    blackLines(d, 40, 60, 3, false);
    expect(black(d, 40, 11, 20)).toBe(false);
    expect(black(d, 40, 32, 20)).toBe(true);
  });

  it("works page by page, so the sheet's white margin doesn't blacken a page's edges", () => {
    const w = 40;
    const h = 20;
    const make = () => picture(w, h, (x) => (x >= 10 && x < 30 ? 150 : 255));
    const whole = make();
    blackLines(whole, w, 60, 3, false);
    expect(black(whole, w, 10, 10)).toBe(true);
    const paged = make();
    blackLinesIn(paged, w, h, [{ x0: 10, y0: 0, x1: 30, y1: h }], 60, 3);
    for (let x = 10; x < 30; x++) expect(black(paged, w, x, 10)).toBe(false);
  });

  it("checks each page for a blueprint on its own", () => {
    const w = 40;
    const h = 10;
    // Left page: dark blue blueprint with a white line at x 5; right page: white paper with a black line at x 30.
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = x < 20 ? (x === 5 ? [250, 250, 250] : [30, 70, 160]) : x === 30 ? [0, 0, 0] : [255, 255, 255];
        d.set([...c, 255], (y * w + x) * 4);
      }
    }
    blackLinesIn(d, w, h, [{ x0: 0, y0: 0, x1: 20, y1: h }, { x0: 20, y0: 0, x1: 40, y1: h }], 60, 3);
    expect(black(d, w, 5, 5)).toBe(true);
    expect(black(d, w, 12, 5)).toBe(false);
    expect(black(d, w, 30, 5)).toBe(true);
    expect(black(d, w, 25, 5)).toBe(false);
  });

  it("reads a blueprint inverted, by itself", () => {
    const w = 30;
    const d = new Uint8ClampedArray(w * 10 * 4);
    for (let i = 0; i < w * 10; i++) {
      const line = i % w === 12;
      d.set(line ? [250, 250, 250, 255] : [30, 70, 160, 255], i * 4); // RGBA: dark blue paper
    }
    expect(isDarkSheet(d)).toBe(true);
    blackLines(d, w, 60, 3);
    expect(black(d, w, 12, 5)).toBe(true);
    expect(black(d, w, 3, 5)).toBe(false);
  });
});
