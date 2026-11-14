import { describe, expect, it } from "vitest";
import { DOCK_MARGIN, dockAt, dockPosition, sanitiseDock } from "./dock";
import { fromHex, hsvToRgb, rgbToHsv, sameColour, toHex } from "../markup/colour";

const W = 1000, H = 600;
const size = (e: string) => (e === "left" || e === "right" ? { w: 180, h: 300 } : { w: 600, h: 40 });

describe("docking the properties bar", () => {
  it("goes to the nearest edge", () => {
    expect(dockAt(500, 20, W, H, size).edge).toBe("top");
    expect(dockAt(500, 590, W, H, size).edge).toBe("bottom");
    expect(dockAt(15, 300, W, H, size).edge).toBe("left");
    expect(dockAt(990, 250, W, H, size).edge).toBe("right");
  });

  it("snaps to the middle of an edge when close, and stays where it's put otherwise", () => {
    expect(dockAt(515, 10, W, H, size).t).toBe(0.5);
    const off = dockAt(650, 10, W, H, size);
    expect(off.t).toBeCloseTo(0.65);
    expect(dockAt(10, 290, W, H, size)).toEqual({ edge: "left", t: 0.5 });
  });

  it("keeps the grip under the pointer rather than centring the bar there", () => {
    // Held 12 px from its start: dropped at x 400, the 600 px bar's centre is at 400 - 12 + 300.
    expect(dockAt(400, 10, W, H, size, () => 12).t).toBeCloseTo(688 / W);
    // Near the middle it still snaps there.
    expect(dockAt(500 - 300 + 12 + 10, 10, W, H, size, () => 12).t).toBe(0.5);
  });

  it("keeps the whole bar on its edge", () => {
    // A 600 px bar's centre can't go nearer than 310 px to either end of a 1000 px edge.
    expect(dockAt(20, 2, W, H, size).t).toBeCloseTo((300 + DOCK_MARGIN) / W);
    expect(dockAt(980, 2, W, H, size).t).toBeCloseTo((W - 300 - DOCK_MARGIN) / W);
  });

  it("places the bar for its dock, inside the area", () => {
    expect(dockPosition({ edge: "top", t: 0.5 }, W, H, 600, 40)).toEqual({ left: 200, top: DOCK_MARGIN });
    expect(dockPosition({ edge: "bottom", t: 0.5 }, W, H, 600, 40)).toEqual({ left: 200, top: H - 40 - DOCK_MARGIN });
    expect(dockPosition({ edge: "right", t: 0.5 }, W, H, 180, 300)).toEqual({ left: W - 180 - DOCK_MARGIN, top: 150 });
    // A bar wider than the area sticks to its start.
    expect(dockPosition({ edge: "top", t: 0.5 }, 300, H, 600, 40).left).toBe(DOCK_MARGIN);
  });

  it("reads a stored dock safely", () => {
    expect(sanitiseDock({ edge: "left", t: 0.2 })).toEqual({ edge: "left", t: 0.2 });
    expect(sanitiseDock({ edge: "middle", t: 9 })).toEqual({ edge: "top", t: 1 });
    expect(sanitiseDock(null)).toEqual({ edge: "top", t: 0.5 });
  });
});

describe("colours", () => {
  it("converts between RGB, HSV and hex", () => {
    for (const c of [[0.85, 0.1, 0.1], [0, 0, 0], [1, 1, 1], [0.05, 0.35, 0.8], [0.5, 0.5, 0.2]] as [number, number, number][]) {
      expect(sameColour(hsvToRgb(rgbToHsv(c)), c)).toBe(true);
      expect(sameColour(fromHex(toHex(c)), c)).toBe(true);
    }
    expect(rgbToHsv([1, 0, 0])).toEqual({ h: 0, s: 1, v: 1 });
    expect(toHex([1, 0.5, 0])).toBe("#FF8000");
    expect(fromHex("#f80")).toEqual([1, 136 / 255, 0]);
    expect(fromHex("nope")).toBeNull();
  });
});
