import { describe, expect, it } from "vitest";
import { HOLD_PX, StickyAxis, alignStops } from "./stickyPan";

describe("sticky pan axis", () => {
  it("passes freely when no stop is crossed", () => {
    const ax = new StickyAxis();
    expect(ax.move(0, 10, [100])).toBe(10);
    expect(ax.move(10, -30, [100])).toBe(-20);
  });

  it("holds at a stop for the hold distance, then carries on without a jump", () => {
    const ax = new StickyAxis();
    let p = ax.move(90, 15, [100]); // crosses 100 by 5
    expect(p).toBe(100);
    p = ax.move(p, 10, [100]); // 15 over: still held
    expect(p).toBe(100);
    p = ax.move(p, 10, [100]); // 25 over: released, 1 past the hold
    expect(p).toBe(100 + 25 - HOLD_PX);
    p = ax.move(p, 5, [100]); // free again, and moving away doesn't re-catch
    expect(p).toBe(100 + 30 - HOLD_PX);
  });

  it("stops at the nearest stop crossed, either way", () => {
    const ax = new StickyAxis();
    expect(ax.move(0, -20, [-10, -15])).toBe(-10);
  });

  it("a big fling passes the hold in one move", () => {
    const ax = new StickyAxis();
    expect(ax.move(0, 200, [50])).toBe(200 - HOLD_PX);
  });

  it("backing off while held stays at the stop until it goes past the hold the other way", () => {
    const ax = new StickyAxis();
    let p = ax.move(95, 10, [100]); // held, 5 over
    p = ax.move(p, -20, [100]); // 15 back: still held
    expect(p).toBe(100);
    p = ax.move(p, -20, [100]); // 35 back: released
    expect(p).toBe(100 - 35 + HOLD_PX);
  });

  it("lets go if the view was moved by something else", () => {
    const ax = new StickyAxis();
    ax.move(95, 10, [100]);
    expect(ax.move(300, 5, [100])).toBe(305);
  });
});

describe("alignment stops", () => {
  it("start, end and (for a short page) centre on the viewport", () => {
    // A page spanning 100..300 on screen at translation 0, viewport 1000 long.
    const s = alignStops([{ a: 100, b: 300 }], 0, 1000);
    expect(s).toEqual([-100, 700, 300]);
  });

  it("a page longer than the viewport has no centre stop", () => {
    expect(alignStops([{ a: -500, b: 1500 }], 20, 1000)).toEqual([520, -480]);
  });
});
