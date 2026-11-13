import { describe, expect, it } from "vitest";
import {
  MAX_SCALE,
  MIN_SCALE,
  PT_TO_CSS,
  WHEEL_NOTCH_FACTOR,
  approachScale,
  constrainView,
  fitRect,
  isNotchedWheel,
  SMOOTH_GESTURE_GAP_MS,
  WheelClassifier,
  screenToWorld,
  wheelZoomFactor,
  worldToScreen,
  zoomAt,
  zoomBy,
  type View,
} from "./viewMath";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("zoom at cursor", () => {
  const v: View = { scale: 1.5, tx: 120, ty: -40 };

  it("keeps the world point under the cursor fixed", () => {
    for (const [sx, sy] of [[0, 0], [300, 200], [1599, 999], [-50, 1200]]) {
      for (const f of [1.12, 1 / 1.12, 4, 0.1]) {
        const before = screenToWorld(v, sx, sy);
        const after = zoomBy(v, sx, sy, f);
        const [x, y] = worldToScreen(after, before[0], before[1]);
        close(x, sx, 1e-6);
        close(y, sy, 1e-6);
      }
    }
  });

  it("keeps the anchor fixed even when the scale is clamped", () => {
    const anchor = screenToWorld(v, 400, 300);
    const z = zoomAt(v, 400, 300, 1e9);
    expect(z.scale).toBe(MAX_SCALE);
    const [x, y] = worldToScreen(z, anchor[0], anchor[1]);
    close(x, 400, 1e-6);
    close(y, 300, 1e-6);
  });

  it("clamps to 5%..6400%", () => {
    expect(zoomAt(v, 0, 0, 1e-9).scale).toBe(MIN_SCALE);
    close(MIN_SCALE / PT_TO_CSS, 0.05);
    close(MAX_SCALE / PT_TO_CSS, 64);
  });

  it("zooming in then out by the same factor returns to the original view", () => {
    const a = zoomBy(zoomBy(v, 333, 222, 1.12), 333, 222, 1 / 1.12);
    close(a.scale, v.scale);
    close(a.tx, v.tx, 1e-9);
    close(a.ty, v.ty, 1e-9);
  });

  it("screen/world round-trips", () => {
    const [wx, wy] = screenToWorld(v, 512, 384);
    const [sx, sy] = worldToScreen(v, wx, wy);
    close(sx, 512);
    close(sy, 384);
  });
});

describe("wheel", () => {
  it("one notch (100 px) is one notch factor, sign-correct", () => {
    close(wheelZoomFactor(-100, 0), WHEEL_NOTCH_FACTOR);
    close(wheelZoomFactor(100, 0), 1 / WHEEL_NOTCH_FACTOR);
  });

  it("notch factor is within the brief's 10-15%", () => {
    expect(WHEEL_NOTCH_FACTOR).toBeGreaterThanOrEqual(1.1);
    expect(WHEEL_NOTCH_FACTOR).toBeLessThanOrEqual(1.15);
  });

  it("is continuous: two half-notches equal one notch", () => {
    close(wheelZoomFactor(-50, 0) ** 2, wheelZoomFactor(-100, 0));
  });

  it("line mode counts 3 lines as about one notch or more", () => {
    expect(wheelZoomFactor(-3, 1)).toBeGreaterThan(WHEEL_NOTCH_FACTOR);
  });

  it("classifies notched wheels and touchpads", () => {
    expect(isNotchedWheel(0, 100, 0)).toBe(true);
    expect(isNotchedWheel(0, -200, 0)).toBe(true);
    expect(isNotchedWheel(0, 3, 1)).toBe(true);
    expect(isNotchedWheel(0, 4.5, 0)).toBe(false); // touchpad
    expect(isNotchedWheel(12, 30, 0)).toBe(false); // two-axis touchpad scroll
    expect(isNotchedWheel(0, 133.33, 0)).toBe(false);
    // System wheel setting of 4 lines: Chromium reports 4 * 100/3 px per notch.
    expect(isNotchedWheel(0, 133.33333333333334, 0)).toBe(true);
    expect(isNotchedWheel(0, -33.333333333333336, 0)).toBe(false); // under 50 px: treated as smooth
  });

  it("a touchpad flick stays smooth once it crosses the per-event threshold", () => {
    const c = new WheelClassifier();
    // Precision touchpad: whole-pixel deltas ramping up, about 8 ms apart.
    const stream = [4, 9, 18, 31, 47, 66, 88, 104, 97, 70, 42, 20, 8];
    const kinds = stream.map((dy, i) => c.classify(0, dy, 0, i * 8));
    expect(kinds.every((k) => k === "smooth")).toBe(true);
  });

  it("mouse notches are still notches, before and after a touchpad gesture", () => {
    const c = new WheelClassifier();
    expect(c.classify(0, 100, 0, 0)).toBe("notch");
    expect(c.classify(0, 100, 0, 60)).toBe("notch");
    expect(c.classify(0, 12, 0, 500)).toBe("smooth");
    expect(c.classify(0, 80, 0, 508)).toBe("smooth"); // inside the gesture
    expect(c.classify(0, 100, 0, 508 + SMOOTH_GESTURE_GAP_MS + 1)).toBe("notch"); // after the gap
  });

  it("line and page mode are always notches", () => {
    const c = new WheelClassifier();
    expect(c.classify(0, 5, 0, 0)).toBe("smooth");
    expect(c.classify(0, 3, 1, 4)).toBe("notch");
  });
});

describe("fit", () => {
  const page = { x: -421, y: 0, w: 842, h: 595 }; // A4 landscape, centred on x = 0

  it("fit page centres the whole page inside the padding", () => {
    const v = fitRect(page, 1600, 1000, 16, "page");
    const [x0, y0] = worldToScreen(v, page.x, page.y);
    const [x1, y1] = worldToScreen(v, page.x + page.w, page.y + page.h);
    expect(x0).toBeGreaterThanOrEqual(16 - 1e-9);
    expect(y0).toBeGreaterThanOrEqual(16 - 1e-9);
    expect(x1).toBeLessThanOrEqual(1584 + 1e-9);
    expect(y1).toBeLessThanOrEqual(984 + 1e-9);
    close((x0 + x1) / 2, 800, 1e-6);
    close((y0 + y1) / 2, 500, 1e-6);
    // One axis is tight.
    expect(Math.min(Math.abs(x0 - 16), Math.abs(y0 - 16))).toBeLessThan(1e-6);
  });

  it("fit width spans the width and pins the top", () => {
    const v = fitRect(page, 1000, 400, 16, "width");
    const [x0, y0] = worldToScreen(v, page.x, page.y);
    const [x1] = worldToScreen(v, page.x + page.w, 0);
    close(x0, 16, 1e-6);
    close(x1, 984, 1e-6);
    close(y0, 16, 1e-6);
  });

  it("handles the 14400 pt wide real-world page", () => {
    const wide = { x: -7200, y: 0, w: 14400, h: 745.9 };
    const v = fitRect(wide, 1600, 960, 16, "page");
    const [x0] = worldToScreen(v, wide.x, 0);
    close(x0, 16, 1e-6);
  });
});

describe("constrain", () => {
  const bounds = { x: -100, y: 0, w: 200, h: 300 };

  it("leaves a visible view alone", () => {
    const v = { scale: 1, tx: 500, ty: 100 };
    expect(constrainView(v, bounds, 1000, 800)).toBe(v);
  });

  it("keeps a document smaller than the view wholly in view", () => {
    // 200 x 300 at scale 1 in a 1000 x 800 view, pushed off the left and the bottom.
    const c = constrainView({ scale: 1, tx: -5000, ty: 900 }, bounds, 1000, 800, 16);
    close(bounds.x * c.scale + c.tx, 16); // left edge back at the margin
    close((bounds.y + bounds.h) * c.scale + c.ty, 800 - 16); // bottom edge at the margin
  });

  it("stops a document bigger than the view at its edges, never leaving empty view", () => {
    // At scale 10 the document is 2000 x 3000: its edges may not come inside the margin.
    const tooFarLeft = constrainView({ scale: 10, tx: -5000, ty: 0 }, bounds, 1000, 800, 16);
    close((bounds.x + bounds.w) * 10 + tooFarLeft.tx, 1000 - 16); // right edge at the margin
    const tooFarDown = constrainView({ scale: 10, tx: 1500, ty: 400 }, bounds, 1000, 800, 16);
    close(bounds.x * 10 + tooFarDown.tx, 16); // left edge at the margin
    close(bounds.y * 10 + tooFarDown.ty, 16); // top edge at the margin
    const inside = { scale: 10, tx: 500, ty: -1000 };
    expect(constrainView(inside, bounds, 1000, 800, 16)).toBe(inside); // anywhere in between is fine
  });
});

describe("smooth zoom easing", () => {
  it("converges on the target and never overshoots", () => {
    let s = 1;
    const target = 2;
    for (let i = 0; i < 100 && s !== target; i++) {
      const n = approachScale(s, target, 16);
      expect(n).toBeGreaterThan(s);
      expect(n).toBeLessThanOrEqual(target);
      s = n;
    }
    expect(s).toBe(target);
  });

  it("is frame-rate independent", () => {
    let a = 1;
    for (let i = 0; i < 6; i++) a = approachScale(a, 2, 8);
    let b = 1;
    for (let i = 0; i < 3; i++) b = approachScale(b, 2, 16);
    close(a, b, 1e-9);
  });
});

describe("eased view changes", async () => {
  const { easeOutCubic, interpolateView, fitWidthKeepingY, keepCentre, stickyZoomTarget, screenToWorld, fitRect } = await import("./viewMath");

  it("easeOutCubic runs 0 to 1, front-loaded, clamped", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it("interpolateView keeps ends exact and moves the centre point in a line, the scale geometrically", () => {
    const a = { scale: 1, tx: 0, ty: 0 };
    const b = { scale: 4, tx: -1000, ty: -600 };
    expect(interpolateView(a, b, 0, 800, 600)).toBe(a);
    expect(interpolateView(a, b, 1, 800, 600)).toBe(b);
    const m = interpolateView(a, b, 0.5, 800, 600);
    expect(m.scale).toBeCloseTo(2, 9);
    const [ax, ay] = screenToWorld(a, 400, 300);
    const [bx, by] = screenToWorld(b, 400, 300);
    const [mx, my] = screenToWorld(m, 400, 300);
    expect(mx).toBeCloseTo((ax + bx) / 2, 9);
    expect(my).toBeCloseTo((ay + by) / 2, 9);
  });

  it("fit width keeps the vertical centre point, or goes to the top when it's off the page", () => {
    const page = { x: 0, y: 0, w: 1000, h: 1400 };
    const fitW = fitRect(page, 800, 600, 16, "width");
    // Looking at y = 900 on the page at some zoom.
    const cur = { scale: 0.5, tx: 100, ty: 300 - 900 * 0.5 };
    const v = fitWidthKeepingY(page, cur, 800, 600, 16);
    expect(v.scale).toBeCloseTo(fitW.scale, 9);
    expect(v.tx).toBeCloseTo(fitW.tx, 9);
    expect(screenToWorld(v, 400, 300)[1]).toBeCloseTo(900, 9);
    // Centre point above the page: fit width at its top, as before.
    const above = { scale: 0.5, tx: 100, ty: 300 + 100 * 0.5 };
    expect(fitWidthKeepingY(page, above, 800, 600, 16)).toEqual(fitW);
  });

  it("keepCentre keeps the world point at the viewport centre after a resize", () => {
    const v = { scale: 2, tx: -300, ty: -100 };
    const before = screenToWorld(v, 400, 300);
    const after = keepCentre(v, 800, 600, 1200, 700);
    const w = screenToWorld(after, 600, 350);
    expect(w[0]).toBeCloseTo(before[0], 9);
    expect(w[1]).toBeCloseTo(before[1], 9);
  });

  it("stickyZoomTarget stops at the first stop crossed, either way, and lets go of one it starts on", () => {
    const stops = [1, 1.5, 3];
    expect(stickyZoomTarget(0.8, 1.2, stops)).toBe(1);
    expect(stickyZoomTarget(0.8, 5, stops)).toBe(1); // the first one crossed, not the last
    expect(stickyZoomTarget(4, 1.2, stops)).toBe(3);
    expect(stickyZoomTarget(1, 1.25, stops)).toBe(1.25); // starting on a stop: carry on
    expect(stickyZoomTarget(1.001, 0.8, stops)).toBe(0.8); // within 0.5% counts as on it
    expect(stickyZoomTarget(1.2, 1.4, stops)).toBe(1.4); // none crossed
    expect(stickyZoomTarget(1.2, 1.5, stops)).toBe(1.5); // landing exactly on one
  });
});

describe("pageFitsView", async () => {
  const { pageFitsView } = await import("./viewMath");
  it("compares sizes, not positions, with rounding slack", () => {
    expect(pageFitsView({ x: -10, y: -10, w: 120, h: 220 }, 100, 200)).toBe(true);
    expect(pageFitsView({ x: 0.3, y: 0, w: 99.8, h: 200 }, 100, 200)).toBe(true);
    // Half scrolled off, as between pages at fit in a continuous document: still fits.
    expect(pageFitsView({ x: 0, y: 150, w: 120, h: 220 }, 100, 200)).toBe(true);
    // Zoomed in: the view is smaller than the page.
    expect(pageFitsView({ x: 0, y: 0, w: 100, h: 150 }, 100, 200)).toBe(false);
    expect(pageFitsView(null, 100, 200)).toBe(false);
  });
});

describe("unionRect and lerpRect", async () => {
  const { unionRect, lerpRect } = await import("./viewMath");
  it("unionRect contains every rect, and is null for none", () => {
    expect(unionRect([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 20, w: 10, h: 5 }])).toEqual({ x: 0, y: 0, w: 15, h: 25 });
    expect(unionRect([{ x: -3, y: 2, w: 1, h: 1 }])).toEqual({ x: -3, y: 2, w: 1, h: 1 });
    expect(unionRect([])).toBeNull();
  });
  it("lerpRect runs from a to b, clamped", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 10, y: 20, w: 30, h: 10 };
    expect(lerpRect(a, b, 0)).toEqual(a);
    expect(lerpRect(a, b, 1)).toEqual(b);
    expect(lerpRect(a, b, 0.5)).toEqual({ x: 5, y: 10, w: 20, h: 10 });
    expect(lerpRect(a, b, 2)).toEqual(b);
  });
});

describe("mapUseful", async () => {
  const { mapUseful } = await import("./viewMath");
  const grid = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 110, y: 0, w: 100, h: 100 },
    { x: 0, y: 110, w: 100, h: 100 },
    { x: 110, y: 110, w: 100, h: 100 },
  ];
  it("is true where four pages meet", () => {
    expect(mapUseful({ x: 50, y: 50, w: 110, h: 110 }, grid)).toBe(true);
  });
  it("is true zoomed into one page", () => {
    expect(mapUseful({ x: 20, y: 20, w: 40, h: 40 }, [grid[0]])).toBe(true);
  });
  it("is false scrolling down full-width pages, stopped between two of them", () => {
    // At fit page each page is no taller than the view.
    const stack = [{ x: 0, y: 0, w: 100, h: 140 }, { x: 0, y: 150, w: 100, h: 140 }];
    expect(mapUseful({ x: -20, y: 80, w: 140, h: 150 }, stack)).toBe(false);
  });
  it("is true inside a page taller than the view (the aerial drawing at fit width)", () => {
    expect(mapUseful({ x: -5, y: 300, w: 110, h: 200 }, [{ x: 0, y: 0, w: 100, h: 1000 }])).toBe(true);
  });
  it("a tall page only counts in CAD navigation: reading a document at fit width stays quiet", () => {
    const tallPage = [{ x: 0, y: 0, w: 100, h: 1000 }];
    expect(mapUseful({ x: -5, y: 300, w: 110, h: 200 }, tallPage, true)).toBe(true);
    expect(mapUseful({ x: -5, y: 300, w: 110, h: 200 }, tallPage, false)).toBe(false);
    // Cut at the side still counts either way.
    expect(mapUseful({ x: 20, y: 300, w: 50, h: 200 }, tallPage, false)).toBe(true);
  });
  it("is true at the top of that tall page too (Matt: losing it there didn't help)", () => {
    expect(mapUseful({ x: -5, y: -10, w: 110, h: 200 }, [{ x: 0, y: 0, w: 100, h: 1000 }])).toBe(true);
  });
});

describe("mini map shape and window", async () => {
  const { mapFraming, mapBox, MAP_WIDTH } = await import("./viewMath");
  it("frames the pages as they are when their shape is within limits", () => {
    const sheet = { x: 0, y: 0, w: 1190, h: 842 };
    expect(mapFraming(sheet, { x: 100, y: 100, w: 50, h: 50 })).toBe(sheet);
  });
  it("windows onto a very tall page around the view, kept inside it", () => {
    const aerial = { x: -373, y: 0, w: 746, h: 14400 };
    const mid = mapFraming(aerial, { x: -373, y: 7000, w: 746, h: 400 });
    expect(mid).toEqual({ x: -373, y: 7200 - 2238, w: 746, h: 4476 }); // six widths tall
    expect(mapFraming(aerial, { x: -373, y: 0, w: 746, h: 400 }).y).toBe(0); // clamped at the top
    expect(mapFraming(aerial, { x: -373, y: 14000, w: 746, h: 400 }).y).toBe(14400 - 4476); // and the bottom
  });
  it("windows onto a very wide page the same way", () => {
    const strip = { x: 0, y: 0, w: 10000, h: 100 };
    expect(mapFraming(strip, { x: 4900, y: 0, w: 200, h: 100 })).toEqual({ x: 4700, y: 0, w: 600, h: 100 });
  });
  it("mapBox keeps the width and takes the shape, within limits", () => {
    expect(mapBox(1.48)).toEqual({ w: MAP_WIDTH, h: Math.round(MAP_WIDTH / 1.48) });
    expect(mapBox(0.5)).toEqual({ w: MAP_WIDTH, h: MAP_WIDTH * 2 }); // portrait: taller
    expect(mapBox(0.05)).toEqual({ w: MAP_WIDTH, h: MAP_WIDTH * 6 }); // clamped to 1:6
    expect(mapBox(20)).toEqual({ w: MAP_WIDTH, h: Math.round(MAP_WIDTH / 6) }); // and 6:1
  });
  it("mapLimits: 60% at default size, growing with size to the whole area less gutters", async () => {
    const { mapLimits, MAP_GUTTER, MAP_FRAME } = await import("./viewMath");
    const d = mapLimits(1000, 800, 1, 1);
    expect(d.maxH).toBeCloseTo(800 * 0.6 - MAP_FRAME, 9);
    const big = mapLimits(1000, 800, 5, 1);
    expect(big.maxH).toBeCloseTo(800 - 2 * MAP_GUTTER - MAP_FRAME, 9);
    expect(big.maxW).toBeCloseTo(1000 - 2 * MAP_GUTTER - MAP_FRAME, 9);
    // The grip's limit: where a square map reaches the full height (the shorter side here).
    expect(mapLimits(1000, 800, 1, 1).maxSize * MAP_WIDTH).toBeCloseTo(800 - 2 * MAP_GUTTER - MAP_FRAME, 9);
  });
  it("mapGuardSize is the size where the map reaches 60% of the area its limiting way", async () => {
    const { mapGuardSize, MAP_FRAME } = await import("./viewMath");
    // Landscape 1.5:1 in a 1000 x 800 area: width is the limit (600 - frame).
    expect(mapGuardSize(1000, 800, 1.5) * MAP_WIDTH).toBeCloseTo(600 - MAP_FRAME, 9);
    // A 1:6 strip in a 2000 x 1600 area: height is (960 - frame), the width a sixth of that.
    expect(mapGuardSize(2000, 1600, 1 / 6) * MAP_WIDTH).toBeCloseTo((960 - MAP_FRAME) / 6, 9);
  });
  it("mapBox shrinks evenly to fit the window, keeping its shape", () => {
    const big = mapBox(1 / 6, 3, 1000, 400);
    expect(big.h).toBeLessThanOrEqual(400);
    expect(big.h / big.w).toBeCloseTo(6, 0);
  });
  it("mapBox scales its sides by the user's size", () => {
    const a = mapBox(1.5, 1);
    const b = mapBox(1.5, 2);
    expect(b.w / a.w).toBeCloseTo(2, 1);
    expect(b.h / a.h).toBeCloseTo(2, 1);
  });
});

describe("mini map turned a quarter turn", async () => {
  const { mapBox, mapLimits, mapGuardSize } = await import("./viewMath");
  it("swaps width and height instead of keeping the width", () => {
    // A landscape page, then the same page rotated 90 degrees (its framing is now portrait).
    const flat = mapBox(1.5, 1);
    expect(mapBox(1 / 1.5, 1, Infinity, Infinity, true)).toEqual({ w: flat.h, h: flat.w });
    const big = mapBox(1.5, 2.5);
    expect(mapBox(1 / 1.5, 2.5, Infinity, Infinity, true)).toEqual({ w: big.h, h: big.w });
  });
  it("fits the swapped limits", () => {
    const b = mapBox(1 / 1.5, 4, 300, 200, true);
    expect(b.w).toBeLessThanOrEqual(300);
    expect(b.h).toBeLessThanOrEqual(200);
  });
  it("swaps the limits and keeps the same size ceiling for the page", () => {
    const flat = mapLimits(1000, 800, 1, 1.5);
    const turned = mapLimits(800, 1000, 1, 1 / 1.5, true);
    expect(turned).toEqual({ maxW: flat.maxH, maxH: flat.maxW, maxSize: flat.maxSize });
  });
  it("guards the same way, turned", () => {
    expect(mapGuardSize(800, 1000, 1 / 1.5, true)).toBeCloseTo(mapGuardSize(1000, 800, 1.5), 9);
  });
  it("changes nothing when not turned", () => {
    expect(mapBox(0.5, 1, Infinity, Infinity, false)).toEqual(mapBox(0.5));
  });
});
