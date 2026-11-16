import { describe, expect, it } from "vitest";
import { revealView } from "./reveal";
import { MAX_SCALE } from "./viewMath";

describe("revealView", () => {
  const vw = 1000, vh = 600;

  it("leaves a view alone when the target is in view and readable", () => {
    expect(revealView({ scale: 2, tx: 0, ty: 0 }, { x: 200, y: 100, w: 50, h: 10 }, vw, vh)).toBeNull();
  });

  it("centres a target that is off screen, keeping the zoom", () => {
    const v = revealView({ scale: 2, tx: 0, ty: 0 }, { x: 2000, y: 1000, w: 50, h: 10 }, vw, vh)!;
    expect(v.scale).toBe(2);
    expect(2025 * v.scale + v.tx).toBe(vw / 2);
    expect(1005 * v.scale + v.ty).toBe(vh / 2);
  });

  it("zooms in on a target too small to read and centres it", () => {
    // 2 pt tall text at 0.25 CSS px per point is half a pixel high: zoom until it's 20 px.
    const v = revealView({ scale: 0.25, tx: 0, ty: 0 }, { x: 100, y: 100, w: 20, h: 2 }, vw, vh)!;
    expect(v.scale).toBeCloseTo(10);
    expect(110 * v.scale + v.tx).toBeCloseTo(vw / 2);
  });

  it("never zooms so far that a long target no longer fits, nor zooms out", () => {
    const wide = revealView({ scale: 0.1, tx: 0, ty: 0 }, { x: 0, y: 0, w: 2000, h: 4 }, vw, vh)!;
    expect(wide.scale).toBeCloseTo((vw * 0.8) / 2000);
    const tiny = revealView({ scale: 0.1, tx: 0, ty: 0 }, { x: 0, y: 0, w: 0.001, h: 0.0001 }, vw, vh)!;
    expect(tiny.scale).toBe(MAX_SCALE);
    const big = revealView({ scale: 3, tx: -5000, ty: 0 }, { x: 0, y: 0, w: 5000, h: 4 }, vw, vh)!;
    expect(big.scale).toBe(3);
  });
});
