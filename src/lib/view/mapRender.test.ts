import { describe, expect, it } from "vitest";
import { MAP_RENDER_MAX_AREA, MAP_RENDER_MAX_SIDE, MAP_RENDER_STEP, mapRenderSide, needsSharper } from "./mapRender";

describe("mapRenderSide", () => {
  it("takes the longer side, rounded up to the step", () => {
    expect(mapRenderSide(100, 300)).toBe(320);
    expect(mapRenderSide(300, 100)).toBe(320);
    expect(mapRenderSide(MAP_RENDER_STEP, 10)).toBe(MAP_RENDER_STEP);
    expect(mapRenderSide(MAP_RENDER_STEP + 1, 10)).toBe(2 * MAP_RENDER_STEP);
  });
  it("lets a long, thin page be as long as it's drawn (the aerial drawing, enlarged)", () => {
    // From the field: drawn 180 x 3475 device px; the old long-side cap of 2048 kept it blurry.
    expect(mapRenderSide(180, 3475)).toBe(3520);
  });
  it("caps a large square page by area", () => {
    const side = mapRenderSide(4000, 4000);
    expect(side * side).toBeLessThanOrEqual(MAP_RENDER_MAX_AREA);
    expect(side).toBe(2048);
  });
  it("never asks for more than the side limit, however thin", () => {
    expect(mapRenderSide(500, 20000)).toBe(MAP_RENDER_MAX_SIDE);
    expect(mapRenderSide(10, 50000)).toBe(MAP_RENDER_MAX_SIDE);
  });
  it("returns 0 for nothing visible or nonsense", () => {
    expect(mapRenderSide(0, 0)).toBe(0);
    expect(mapRenderSide(Number.NaN, 10)).toBe(0);
  });
  it("ignores the sign of a flipped rect", () => {
    expect(mapRenderSide(-100, -300)).toBe(320);
  });
});

describe("needsSharper", () => {
  it("asks again when the map is drawn noticeably bigger than the image", () => {
    expect(needsSharper(256, 640)).toBe(true);
    expect(needsSharper(0, 128)).toBe(true);
  });
  it("doesn't re-render for small growth, or to shrink", () => {
    expect(needsSharper(640, 704)).toBe(false);
    expect(needsSharper(640, 320)).toBe(false);
  });
  it("asks for nothing when nothing is wanted", () => {
    expect(needsSharper(0, 0)).toBe(false);
  });
});
