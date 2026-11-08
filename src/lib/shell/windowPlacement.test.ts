import { describe, expect, it } from "vitest";
import { placeOnScreen } from "./windowPlacement";

const primary = { x: 0, y: 0, w: 1920, h: 1040 }; // taskbar excluded
const right = { x: 1920, y: 0, w: 2560, h: 1400 };

describe("placeOnScreen", () => {
  it("keeps a window that is already on screen", () => {
    expect(placeOnScreen({ x: 100, y: 80, w: 1400, h: 900 }, [primary])).toEqual({ x: 100, y: 80, w: 1400, h: 900 });
  });
  it("keeps a window on the second monitor", () => {
    expect(placeOnScreen({ x: 2000, y: 100, w: 1400, h: 900 }, [primary, right])).toEqual({ x: 2000, y: 100, w: 1400, h: 900 });
  });
  it("centres a window from an unplugged monitor on the primary", () => {
    expect(placeOnScreen({ x: 2000, y: 100, w: 1400, h: 900 }, [primary])).toEqual({ x: 260, y: 70, w: 1400, h: 900 });
  });
  it("pulls a window hanging off the edge back inside", () => {
    expect(placeOnScreen({ x: 1500, y: -50, w: 1400, h: 900 }, [primary])).toEqual({ x: 520, y: 0, w: 1400, h: 900 });
  });
  it("moves a window to the monitor it mostly covers", () => {
    const r = placeOnScreen({ x: 1800, y: 100, w: 1400, h: 900 }, [primary, right])!;
    expect(r.x).toBe(1920);
  });
  it("shrinks a window bigger than the work area", () => {
    expect(placeOnScreen({ x: 0, y: 0, w: 3000, h: 2000 }, [primary])).toEqual({ x: 0, y: 0, w: 1920, h: 1040 });
  });
  it("keeps the minimum size unless the screen is smaller", () => {
    expect(placeOnScreen({ x: 10, y: 10, w: 100, h: 100 }, [primary])).toEqual({ x: 10, y: 10, w: 720, h: 480 });
    expect(placeOnScreen({ x: 0, y: 0, w: 100, h: 100 }, [{ x: 0, y: 0, w: 500, h: 300 }])).toEqual({ x: 0, y: 0, w: 500, h: 300 });
  });
  it("returns null with nothing to go on", () => {
    expect(placeOnScreen(null, [primary])).toBeNull();
    expect(placeOnScreen({ x: 0, y: 0, w: 10, h: 10 }, [])).toBeNull();
    expect(placeOnScreen({ x: NaN, y: 0, w: 10, h: 10 }, [primary])).toBeNull();
    expect(placeOnScreen({ x: 0, y: 0, w: 0, h: 10 }, [primary])).toBeNull();
  });
});
