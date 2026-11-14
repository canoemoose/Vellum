import { describe, expect, it } from "vitest";
import {
  between,
  bounds,
  boxBetween,
  clampAngle,
  corners,
  dragBox,
  fitView,
  frameSize,
  FULL,
  handleCursor,
  hitBox,
  hitRect,
  initialAdjust,
  isFull,
  rotate,
  settleView,
  toBox,
  toCommand,
  toCrop,
  toFrame,
  toScreen,
  turn,
  knobAt,
  angleByDrag,
  type Box,
  type Crop,
} from "./frame";

const F = { w: 100, h: 100 };
const MIN = 10;
const close = <T extends object>(a: T, b: T, digits = 9) => {
  for (const k of Object.keys(b) as (keyof T)[]) expect(a[k] as number).toBeCloseTo(b[k] as number, digits);
};
/** A level box from its left, top, width and height, as the old tests had it. */
const rect = (x: number, y: number, w: number, h: number): Box => ({ cx: x + w / 2, cy: y + h / 2, w, h });

describe("frame", () => {
  it("swaps width and height on odd quarter turns", () => {
    expect(frameSize(400, 300, 0)).toEqual({ w: 400, h: 300 });
    expect(frameSize(400, 300, 1)).toEqual({ w: 300, h: 400 });
    expect(frameSize(400, 300, 2)).toEqual({ w: 400, h: 300 });
    expect(frameSize(400, 300, 3)).toEqual({ w: 300, h: 400 });
  });

  it("turns the box with the picture, so it holds the same part", () => {
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

  it("keeps the box's turn within 45 degrees", () => {
    expect(clampAngle(60)).toBe(45);
    expect(clampAngle(-50)).toBe(-45);
    expect(clampAngle(2.5)).toBe(2.5);
    expect(clampAngle(NaN)).toBe(0);
  });

  it("converts between fractions and frame pixels", () => {
    const f = { w: 400, h: 200 };
    const c: Crop = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 };
    expect(toBox(c, f)).toEqual({ cx: 200, cy: 125, w: 200, h: 50 });
    close(toCrop(toBox(c, f), f), c);
  });

  it("turns clockwise with y down, and finds a turned box's corners", () => {
    close(rotate({ x: 1, y: 0 }, 90), { x: 0, y: 1 });
    const c = corners({ cx: 50, cy: 50, w: 40, h: 20 }, 90);
    // Turned a quarter clockwise, the box's top left is at the screen's top right.
    close(c[0], { x: 60, y: 30 });
    close(bounds(c), { x: 40, y: 30, w: 20, h: 40 });
  });
});

describe("dragging a level box", () => {
  const b = rect(20, 20, 50, 50);

  it("resizes from a corner or an edge, inside the frame and not too small", () => {
    close(dragBox(b, 0, "se", { x: 10, y: 5 }, MIN, F), rect(20, 20, 60, 55));
    close(dragBox(b, 0, "nw", { x: -10, y: -10 }, MIN, F), rect(10, 10, 60, 60));
    close(dragBox(b, 0, "e", { x: 10, y: 30 }, MIN, F), rect(20, 20, 60, 50)); // an edge moves one way only
    close(dragBox(b, 0, "n", { x: 30, y: -50 }, MIN, F), rect(20, 0, 50, 70)); // stops at the frame
    close(dragBox(b, 0, "w", { x: 90, y: 0 }, MIN, F), rect(60, 20, 10, 50)); // stops at the minimum
  });

  it("moves without changing size, inside the frame", () => {
    close(dragBox(b, 0, "move", { x: 10, y: -10 }, MIN, F), rect(30, 10, 50, 50));
    close(dragBox(b, 0, "move", { x: 100, y: 100 }, MIN, F), rect(50, 50, 50, 50));
    close(dragBox(b, 0, "move", { x: -100, y: 0 }, MIN, F), rect(0, 20, 50, 50));
  });

  it("draws a new box either way round, clamped and not too small", () => {
    close(boxBetween({ x: 60, y: 70 }, { x: 20, y: 30 }, 0, MIN, F), rect(20, 30, 40, 40));
    close(boxBetween({ x: -50, y: 50 }, { x: 50, y: 200 }, 0, MIN, F), rect(0, 50, 50, 50));
    // A click (no drag) makes a minimum box from where it started.
    close(boxBetween({ x: 30, y: 30 }, { x: 30, y: 30 }, 0, MIN, F), rect(30, 30, 10, 10));
    // Dragged up and left from near the corner: grows the other way, kept inside.
    close(boxBetween({ x: 5, y: 5 }, { x: 2, y: 2 }, 0, MIN, F), rect(0, 0, 10, 10));
    // At the far edge there's no room to grow forwards.
    close(boxBetween({ x: 98, y: 98 }, { x: 99, y: 99 }, 0, MIN, F), rect(90, 90, 10, 10));
  });
});

describe("dragging a turned box", () => {
  const b: Box = { cx: 50, cy: 50, w: 40, h: 20 };

  it("resizes along its own sides, the opposite side staying put", () => {
    // Turned a quarter clockwise, the box's right edge faces down the screen.
    const out = dragBox(b, 90, "e", { x: 0, y: 10 }, MIN, F);
    close(out, { cx: 50, cy: 55, w: 50, h: 20 });
    // The left edge (now at the top) hasn't moved.
    close(corners(out, 90)[0], corners(b, 90)[0]);
    // Pulling across the side does nothing.
    close(dragBox(b, 90, "e", { x: 30, y: 0 }, MIN, F), b);
    // A corner at 30 degrees: drag exactly along the box's width.
    const d = rotate({ x: 10, y: 0 }, 30);
    const se = dragBox(b, 30, "se", d, MIN, F);
    expect(se.w).toBeCloseTo(50);
    expect(se.h).toBeCloseTo(20);
    close(corners(se, 30)[0], corners(b, 30)[0]);
  });

  it("may stick out of the frame, but keeps its centre on the photo", () => {
    const moved = dragBox(b, 20, "move", { x: 200, y: -10 }, MIN, F);
    close(moved, { cx: 100, cy: 40, w: 40, h: 20 });
    const grown = dragBox(b, 20, "e", rotate({ x: 40, y: 0 }, 20), MIN, F);
    expect(grown.w).toBeCloseTo(80);
    expect(bounds(corners(grown, 20)).x + bounds(corners(grown, 20)).w).toBeGreaterThan(100);
  });

  it("draws a new box at the same turn", () => {
    // Corner to corner of the box as it lies: the same box back.
    const c = corners(b, 30);
    close(boxBetween(c[0], c[2], 30, MIN, F), b);
    close(boxBetween(c[2], c[0], 30, MIN, F), b);
  });
});

describe("sending", () => {
  it("sends no crop when it's the whole frame", () => {
    expect(isFull(FULL)).toBe(true);
    expect(toCommand(initialAdjust())).toEqual({ turns: 0, angle: 0, crop: null });
    const a = { turns: 1, angle: 70, crop: { x: 0.1, y: 0, w: 0.9, h: 1 } };
    expect(toCommand(a)).toEqual({ turns: 1, angle: 45, crop: a.crop });
  });
});

describe("view", () => {
  const frame = { w: 400, h: 200 };
  const stage = { w: 500, h: 500 };

  it("fits the frame in the stage, centred", () => {
    const v = fitView(frame, stage, 50);
    expect(v.scale).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(50);
    expect(v.y).toBeCloseTo(150);
  });

  it("settles on the box: centred, with room round it, never further out than the whole photo", () => {
    // A small box: zoomed in so it fills 3/4 of the stage's width, centred.
    const target = { x: 100, y: 50, w: 100, h: 20 };
    const v = settleView(frame, target, stage, 50, 0.75, 8);
    expect(v.scale).toBeCloseTo(3);
    close(toScreen(v, { x: 150, y: 60 }), { x: 250, y: 250 });
    // The whole photo: just fitted.
    expect(settleView(frame, { x: 0, y: 0, w: 400, h: 200 }, stage, 50, 0.75, 8)).toEqual(fitView(frame, stage, 50));
    // A tiny box: no closer than the limit.
    expect(settleView(frame, { x: 0, y: 0, w: 1, h: 1 }, stage, 50, 0.75, 8).scale).toBe(8);
  });

  it("goes from one view to another evenly", () => {
    const a = { scale: 1, x: 0, y: 0 };
    const b = { scale: 4, x: -300, y: -100 };
    expect(between(a, b, 0, stage)).toEqual(a);
    close(between(a, b, 1, stage), b);
    expect(between(a, b, 0.5, stage).scale).toBeCloseTo(2);
  });

  it("puts the rotate handle above the box's top edge, turning with it", () => {
    const v = { scale: 2, x: 0, y: 0 };
    const b: Box = { cx: 50, cy: 50, w: 40, h: 20 };
    // Centre (100, 100) on screen, the top edge 20 px up, the handle KNOB_GAP beyond.
    close(knobAt(v, b, 0), { x: 100, y: 52 });
    close(knobAt(v, b, 90), { x: 148, y: 100 });
  });

  it("turns the box as far as the handle goes round its centre", () => {
    const c = { x: 0, y: 0 };
    // From straight up to up-and-right by 20 degrees: 20 degrees clockwise.
    const up = { x: 0, y: -100 };
    const to = rotate(up, 20);
    expect(angleByDrag(0, c, up, to)).toBeCloseTo(20);
    expect(angleByDrag(10, c, up, rotate(up, -25))).toBeCloseTo(-15);
    // Kept within 45 degrees, and across the left of the circle without a jump.
    expect(angleByDrag(0, c, up, rotate(up, 80))).toBe(45);
    expect(angleByDrag(0, c, { x: -100, y: 1 }, { x: -100, y: -1 })).toBeCloseTo(1.1, 1);
    // Close to level snaps level.
    expect(angleByDrag(0.4, c, up, rotate(up, 0.2))).toBe(0);
  });

  it("maps between the screen and the frame", () => {
    const v = { scale: 2, x: 10, y: 20 };
    expect(toFrame(v, { x: 410, y: 220 })).toEqual({ x: 200, y: 100 });
    expect(toScreen(v, { x: 200, y: 100 })).toEqual({ x: 410, y: 220 });
  });

  it("finds the corner, edge or middle under the pointer", () => {
    const r = { x: 100, y: 100, w: 200, h: 100 };
    expect(hitRect(r, { x: 102, y: 98 }, 6)).toBe("nw");
    expect(hitRect(r, { x: 300, y: 200 }, 6)).toBe("se");
    expect(hitRect(r, { x: 200, y: 104 }, 6)).toBe("n");
    expect(hitRect(r, { x: 297, y: 150 }, 6)).toBe("e");
    expect(hitRect(r, { x: 200, y: 150 }, 6)).toBe("move");
    expect(hitRect(r, { x: 50, y: 150 }, 6)).toBeNull();
    expect(hitRect(r, { x: 200, y: 220 }, 6)).toBeNull();
  });

  it("finds the handles of a turned box where they're drawn", () => {
    const v = { scale: 2, x: 0, y: 0 };
    const b: Box = { cx: 50, cy: 50, w: 40, h: 20 };
    const c = corners(b, 90).map((p) => toScreen(v, p));
    expect(hitBox(v, b, 90, c[0], 6)).toBe("nw");
    expect(hitBox(v, b, 90, c[2], 6)).toBe("se");
    expect(hitBox(v, b, 90, { x: 100, y: 100 }, 6)).toBe("move");
    // Turned a quarter, the box is tall on screen: well left of the centre is outside it.
    expect(hitBox(v, b, 90, { x: 70, y: 100 }, 6)).toBeNull();
  });

  it("points the resize cursor along the turned box", () => {
    expect(handleCursor("e", 0)).toBe("ew-resize");
    expect(handleCursor("e", 90)).toBe("ns-resize");
    expect(handleCursor("se", 0)).toBe("nwse-resize");
    expect(handleCursor("ne", 0)).toBe("nesw-resize");
    expect(handleCursor("n", 40)).toBe("nesw-resize");
    expect(handleCursor("w", -10)).toBe("ew-resize");
    expect(handleCursor("move", 30)).toBe("move");
  });
});
