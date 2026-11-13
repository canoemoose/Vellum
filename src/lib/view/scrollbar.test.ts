import { describe, expect, it } from "vitest";
import { canScroll, dragRatio, thumb } from "./scrollbar";

describe("canvas scrollbar maths", () => {
  // A 10,000-unit document, a 1,000-unit view, a 500 px track.
  it("thumb length is the view's share; position runs from top to bottom", () => {
    expect(thumb(0, 1000, 0, 10000, 500)).toEqual({ pos: 0, len: 50 });
    expect(thumb(9000, 1000, 0, 10000, 500).pos).toBeCloseTo(450, 9);
    expect(thumb(4500, 1000, 0, 10000, 500).pos).toBeCloseTo(225, 9);
  });

  it("a thumb never gets shorter than the minimum", () => {
    expect(thumb(0, 10, 0, 100000, 500).len).toBe(24);
  });

  it("margins round a fitted page count as scrollable range", () => {
    // View starts 16 units above the document.
    expect(thumb(-16, 1000, 0, 10000, 500).pos).toBe(0);
    expect(canScroll(-16, 1000, 0, 10000)).toBe(true);
  });

  it("nothing to scroll when the view shows the whole document", () => {
    expect(canScroll(-100, 1200, 0, 1000)).toBe(false);
  });

  it("dragging the thumb across its free track moves the view across its free range", () => {
    const r = dragRatio(0, 1000, 0, 10000, 500);
    expect(r * (500 - 50)).toBeCloseTo(9000, 6);
    expect(dragRatio(-100, 1200, 0, 1000, 500)).toBe(0);
  });
});
