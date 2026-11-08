import { describe, expect, it } from "vitest";
import { exportScale, MAX_PIXELS, MAX_SIDE } from "./exportPages";

const A4 = { w: 595.28, h: 841.89 };
const A1 = { w: 2383.94, h: 1683.78 };
const A0 = { w: 3370.39, h: 2383.94 };

describe("exportScale", () => {
  it("uses the requested DPI when it fits", () => {
    expect(exportScale(A4, 300)).toEqual({ rs: 300 / 72, dpi: 300, limited: false });
    expect(exportScale(A1, 150).limited).toBe(false);
  });
  it("reduces the DPI for pages past the canvas limits", () => {
    const r = exportScale(A0, 600);
    expect(r.limited).toBe(true);
    expect(r.dpi).toBeLessThan(600);
    const w = A0.w * r.rs;
    const h = A0.h * r.rs;
    expect(Math.ceil(w)).toBeLessThanOrEqual(MAX_SIDE);
    expect(Math.ceil(w) * Math.ceil(h)).toBeLessThanOrEqual(MAX_PIXELS);
  });
  it("keeps a long strip under the side limit", () => {
    const r = exportScale({ w: 20000, h: 200 }, 300);
    expect(r.limited).toBe(true);
    expect(Math.ceil(20000 * r.rs)).toBeLessThanOrEqual(MAX_SIDE);
  });
});
