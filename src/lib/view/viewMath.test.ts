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

  it("pulls a lost document back so some of it stays on screen", () => {
    const v = { scale: 1, tx: -5000, ty: 100 };
    const c = constrainView(v, bounds, 1000, 800, 64);
    const right = (bounds.x + bounds.w) * c.scale + c.tx;
    close(right, 64);
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
