import { describe, expect, it } from "vitest";
import { centred, clampBox, moved, parseBox, resized, type Limits } from "./floatBox";

const lim: Limits = { vw: 1600, vh: 1000, minW: 600, minH: 400, margin: 12 };

describe("floating dialog boxes", () => {
  it("centres the default size, shrunk to fit a small window", () => {
    expect(centred(1000, 800, lim)).toEqual({ x: 300, y: 100, w: 1000, h: 800 });
    expect(centred(1000, 800, { ...lim, vw: 800, vh: 600 })).toEqual({ x: 12, y: 12, w: 776, h: 576 });
  });

  it("moves, but never out of the window", () => {
    const b = { x: 100, y: 100, w: 800, h: 600 };
    expect(moved(b, 50, -20, lim)).toEqual({ x: 150, y: 80, w: 800, h: 600 });
    expect(moved(b, -500, -500, lim)).toEqual({ x: 12, y: 12, w: 800, h: 600 });
    expect(moved(b, 5000, 5000, lim)).toEqual({ x: 1600 - 12 - 800, y: 1000 - 12 - 600, w: 800, h: 600 });
  });

  it("resizes from any edge, keeping the opposite side put", () => {
    const b = { x: 100, y: 100, w: 800, h: 600 };
    expect(resized(b, "se", 100, 50, lim)).toEqual({ x: 100, y: 100, w: 900, h: 650 });
    expect(resized(b, "nw", -50, -40, lim)).toEqual({ x: 50, y: 60, w: 850, h: 640 });
    expect(resized(b, "e", 0, 999, lim)).toEqual(b); // an edge only moves its own axis
  });

  it("stops at the minimum size and at the window's margin", () => {
    const b = { x: 100, y: 100, w: 800, h: 600 };
    expect(resized(b, "w", 700, 0, lim)).toEqual({ x: 300, y: 100, w: 600, h: 600 });
    expect(resized(b, "s", 0, -500, lim)).toEqual({ x: 100, y: 100, w: 800, h: 400 });
    expect(resized(b, "nw", -500, -500, lim)).toEqual({ x: 12, y: 12, w: 888, h: 688 });
    expect(resized(b, "se", 5000, 5000, lim)).toEqual({ x: 100, y: 100, w: 1600 - 12 - 100, h: 1000 - 12 - 100 });
  });

  it("pulls a remembered box back inside a smaller window", () => {
    const b = { x: 900, y: 500, w: 1200, h: 900 };
    expect(clampBox(b, { ...lim, vw: 1000, vh: 700 })).toEqual({ x: 12, y: 12, w: 976, h: 676 });
  });

  it("reads back only a usable saved box", () => {
    expect(parseBox({ x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(parseBox({ x: 1, y: 2, w: 0, h: 4 })).toBeNull();
    expect(parseBox({ x: "1", y: 2, w: 3, h: 4 })).toBeNull();
    expect(parseBox(null)).toBeNull();
  });
});
