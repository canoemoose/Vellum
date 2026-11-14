import { describe, expect, it } from "vitest";
import {
  clampAngle,
  cropBetween,
  cropOnScreen,
  dragCrop,
  fitView,
  frameSize,
  FULL,
  hitCrop,
  initialAdjust,
  isFull,
  screenToFrame,
  toCommand,
  turn,
  zoomAt,
  type Crop,
} from "./frame";

const MIN = { w: 0.1, h: 0.1 };
const close = (a: Crop, b: Crop) => {
  for (const k of ["x", "y", "w", "h"] as const) expect(a[k]).toBeCloseTo(b[k], 9);
};

describe("frame", () => {
  it("swaps width and height on odd quarter turns", () => {
    expect(frameSize(400, 300, 0)).toEqual({ w: 400, h: 300 });
    expect(frameSize(400, 300, 1)).toEqual({ w: 300, h: 400 });
    expect(frameSize(400, 300, 2)).toEqual({ w: 400, h: 300 });
    expect(frameSize(400, 300, 3)).toEqual({ w: 300, h: 400 });
  });

  it("turns the crop with the picture, so it holds the same part", () => {
    // The top-left quarter's top half: after a clockwise turn it's at the top right.
    const a = { turns: 0, angle: 3, crop: { x: 0, y: 0, w: 0.5, h: 0.25 } };
    const cw = turn(a, 1);
    expect(cw.turns).toBe(1);
    expect(cw.angle).toBe(3);
    close(cw.crop, { x: 0.75, y: 0, w: 0.25, h: 0.5 });
    // Back again, and four turns are no turn.
    close(turn(cw, -1).crop, a.crop);
    let b = a;
    for (let i = 0; i < 4; i++) b = turn(b, 1);
    expect(b.turns).toBe(0);
    close(b.crop, a.crop);
    expect(turn(a, -1).turns).toBe(3);
    close(turn(a, -1).crop, { x: 0, y: 0.5, w: 0.25, h: 0.5 });
  });

  it("keeps straightening within 45 degrees", () => {
    expect(clampAngle(60)).toBe(45);
    expect(clampAngle(-50)).toBe(-45);
    expect(clampAngle(2.5)).toBe(2.5);
    expect(clampAngle(NaN)).toBe(0);
  });

  it("resizes a crop from a corner or an edge, inside the frame and not too small", () => {
    const c = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    close(dragCrop(c, "se", 0.1, 0.05, MIN), { x: 0.2, y: 0.2, w: 0.6, h: 0.55 });
    close(dragCrop(c, "nw", -0.1, -0.1, MIN), { x: 0.1, y: 0.1, w: 0.6, h: 0.6 });
    close(dragCrop(c, "e", 0.1, 0.3, MIN), { x: 0.2, y: 0.2, w: 0.6, h: 0.5 }); // an edge moves one way only
    close(dragCrop(c, "n", 0.3, -0.5, MIN), { x: 0.2, y: 0, w: 0.5, h: 0.7 }); // stops at the frame
    close(dragCrop(c, "w", 0.9, 0, MIN), { x: 0.6, y: 0.2, w: 0.1, h: 0.5 }); // stops at the minimum
  });

  it("moves a crop without changing its size, inside the frame", () => {
    const c = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    close(dragCrop(c, "move", 0.1, -0.1, MIN), { x: 0.3, y: 0.1, w: 0.5, h: 0.5 });
    close(dragCrop(c, "move", 1, 1, MIN), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    close(dragCrop(c, "move", -1, 0, MIN), { x: 0, y: 0.2, w: 0.5, h: 0.5 });
  });

  it("draws a new crop either way round, clamped and not too small", () => {
    close(cropBetween({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.3 }, MIN), { x: 0.2, y: 0.3, w: 0.4, h: 0.4 });
    close(cropBetween({ x: -0.5, y: 0.5 }, { x: 0.5, y: 2 }, MIN), { x: 0, y: 0.5, w: 0.5, h: 0.5 });
    // A click (no drag) makes a minimum box from where it started.
    close(cropBetween({ x: 0.3, y: 0.3 }, { x: 0.3, y: 0.3 }, MIN), { x: 0.3, y: 0.3, w: 0.1, h: 0.1 });
    // Dragged up and left from near the corner: grows the other way.
    close(cropBetween({ x: 0.05, y: 0.05 }, { x: 0.02, y: 0.02 }, MIN), { x: 0, y: 0, w: 0.1, h: 0.1 });
    // At the far edge there's no room to grow forwards.
    close(cropBetween({ x: 0.98, y: 0.98 }, { x: 0.99, y: 0.99 }, MIN), { x: 0.9, y: 0.9, w: 0.1, h: 0.1 });
  });

  it("sends no crop when it's the whole frame", () => {
    expect(isFull(FULL)).toBe(true);
    expect(toCommand(initialAdjust())).toEqual({ turns: 0, angle: 0, crop: null });
    const a = { turns: 1, angle: 70, crop: { x: 0.1, y: 0, w: 0.9, h: 1 } };
    expect(toCommand(a)).toEqual({ turns: 1, angle: 45, crop: a.crop });
  });
});

describe("view", () => {
  const frame = { w: 400, h: 200 };

  it("fits the frame in the box, centred", () => {
    const v = fitView(frame, { w: 500, h: 500 }, 50);
    expect(v.scale).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(50);
    expect(v.y).toBeCloseTo(150);
  });

  it("zooms about the pointer and keeps within limits", () => {
    const v = { scale: 1, x: 0, y: 0 };
    const at = { x: 100, y: 50 };
    const z = zoomAt(v, 2, at, 0.5, 4);
    // The frame point under the pointer stays under it.
    expect(screenToFrame(z, frame, at)).toEqual(screenToFrame(v, frame, at));
    expect(zoomAt(v, 100, at, 0.5, 4).scale).toBe(4);
    expect(zoomAt(v, 0.01, at, 0.5, 4).scale).toBe(0.5);
  });

  it("maps between the screen and the frame", () => {
    const v = { scale: 2, x: 10, y: 20 };
    expect(screenToFrame(v, frame, { x: 410, y: 220 })).toEqual({ x: 0.5, y: 0.5 });
    expect(cropOnScreen(v, frame, { x: 0.5, y: 0.5, w: 0.25, h: 0.5 })).toEqual({ x: 410, y: 220, w: 200, h: 200 });
  });

  it("finds the corner, edge or middle under the pointer", () => {
    const r = { x: 100, y: 100, w: 200, h: 100 };
    expect(hitCrop(r, { x: 102, y: 98 }, 6)).toBe("nw");
    expect(hitCrop(r, { x: 300, y: 200 }, 6)).toBe("se");
    expect(hitCrop(r, { x: 200, y: 104 }, 6)).toBe("n");
    expect(hitCrop(r, { x: 297, y: 150 }, 6)).toBe("e");
    expect(hitCrop(r, { x: 200, y: 150 }, 6)).toBe("move");
    expect(hitCrop(r, { x: 50, y: 150 }, 6)).toBeNull();
    expect(hitCrop(r, { x: 200, y: 220 }, 6)).toBeNull();
  });
});
