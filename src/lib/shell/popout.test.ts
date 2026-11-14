import { describe, expect, it } from "vitest";
import { POPOUT_GAP, outFrom, popoutPosition } from "./popout";

const a = { left: 100, top: 20, right: 150, bottom: 44 };

describe("pop-outs from the properties bar", () => {
  it("opens away from the bar's edge, centred on the control", () => {
    expect(popoutPosition(a, 40, 160, outFrom("top"), 1000, 800)).toEqual({ left: 105, top: 44 + POPOUT_GAP });
    expect(popoutPosition({ left: 100, top: 700, right: 150, bottom: 724 }, 40, 160, outFrom("bottom"), 1000, 800)).toEqual({ left: 105, top: 700 - POPOUT_GAP - 160 });
    expect(popoutPosition(a, 200, 30, outFrom("left"), 1000, 800).left).toBe(150 + POPOUT_GAP);
    expect(popoutPosition({ left: 900, top: 300, right: 940, bottom: 324 }, 200, 30, outFrom("right"), 1000, 800).left).toBe(900 - POPOUT_GAP - 200);
  });

  it("stays inside the window", () => {
    const p = popoutPosition({ left: 2, top: 10, right: 30, bottom: 34 }, 120, 160, "down", 1000, 120);
    expect(p.left).toBe(4);
    expect(p.top).toBe(120 - 160 - 4 < 4 ? 4 : 120 - 160 - 4);
  });
});
