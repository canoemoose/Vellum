import { describe, expect, it } from "vitest";
import { framedGeometry } from "./framed";
import { FULL } from "../signature/frame";

describe("framedGeometry", () => {
  it("is the whole picture when nothing is framed", () => {
    expect(framedGeometry(400, 300, { turns: 0, angle: 0, crop: { ...FULL } }, 2000)).toEqual({ w: 400, h: 300, cx: 200, cy: 150, scale: 1 });
  });

  it("swaps the sides on a quarter turn", () => {
    const g = framedGeometry(400, 300, { turns: 1, angle: 0, crop: { ...FULL } }, 2000);
    expect([g.w, g.h, g.cx, g.cy]).toEqual([300, 400, 150, 200]);
  });

  it("crops in fractions of the frame", () => {
    const g = framedGeometry(400, 200, { turns: 0, angle: 0, crop: { x: 0.25, y: 0.5, w: 0.5, h: 0.5 } }, 2000);
    expect([g.w, g.h, g.cx, g.cy]).toEqual([200, 100, 200, 150]);
  });

  it("scales a big picture down to the longest side allowed", () => {
    const g = framedGeometry(6000, 3000, { turns: 0, angle: 30, crop: { ...FULL } }, 2000);
    expect([g.w, g.h]).toEqual([2000, 1000]);
    expect(g.scale).toBeCloseTo(1 / 3);
  });
});
