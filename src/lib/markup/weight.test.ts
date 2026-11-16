import { describe, expect, it } from "vitest";
import { MAX_WEIGHT, parseWeight, showWeight, stepWeight } from "./weight";

describe("line weight spinner", () => {
  it("steps in quarters below 1 pt, halves to 4 pt, wholes above", () => {
    const up: number[] = [0.25];
    while (up.at(-1)! < 6) up.push(stepWeight(up.at(-1)!, 1, 0.25));
    expect(up).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6]);
    const down: number[] = [6];
    while (down.at(-1)! > 0.25) down.push(stepWeight(down.at(-1)!, -1, 0.25));
    expect(down).toEqual([...up].reverse());
  });

  it("snaps an off-grid weight to the grid", () => {
    expect(stepWeight(1.3, 1, 0.25)).toBe(1.5);
    expect(stepWeight(1.3, -1, 0.25)).toBe(1);
    expect(stepWeight(4.4, -1, 0.25)).toBe(4);
  });

  it("stays within its limits", () => {
    expect(stepWeight(0.25, -1, 0.25)).toBe(0.25);
    expect(stepWeight(0.25, -1, 0)).toBe(0);
    expect(stepWeight(0, 1, 0)).toBe(0.25);
    expect(stepWeight(MAX_WEIGHT, 1, 0.25)).toBe(MAX_WEIGHT);
  });

  it("reads what's typed", () => {
    expect(parseWeight("1.5", 0.25)).toBe(1.5);
    expect(parseWeight(" 2 pt", 0.25)).toBe(2);
    expect(parseWeight("0,5", 0.25)).toBe(0.5);
    expect(parseWeight(".75", 0.25)).toBe(0.75);
    expect(parseWeight("0", 0.25)).toBe(0.25);
    expect(parseWeight("99", 0.25)).toBe(MAX_WEIGHT);
    expect(parseWeight("thick", 0.25)).toBeNull();
    expect(parseWeight("", 0.25)).toBeNull();
    expect(showWeight(1.5)).toBe("1.5");
    expect(showWeight(0.333333)).toBe("0.33");
  });
});

describe("line weight slider", () => {
  it("has a stop for every step from the lowest weight up", async () => {
    const { weightSteps, nearestStep } = await import("./weight");
    const s = weightSteps(0.25);
    expect(s.slice(0, 6)).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2]);
    expect(s.at(-1)).toBe(MAX_WEIGHT);
    expect(weightSteps(0)[0]).toBe(0);
    expect(s[nearestStep(s, 1.6)]).toBe(1.5);
    expect(s[nearestStep(s, 7.2)]).toBe(7);
  });
});

// docs/edit-lock-brief.md, 8: a dimension vanished when its Weight slider was dragged. However a
// weight comes to the bar, what it hands back is a number within range, never zero below the
// least allowed, and never not a number.
describe("a weight never reaches a markup as zero or not a number", () => {
  it("turns a missing or broken weight into the least allowed", async () => {
    const { clampWeight, stepWeight } = await import("./weight");
    expect(clampWeight(NaN, 0.25)).toBe(0.25);
    expect(clampWeight(undefined as unknown as number, 0.25)).toBe(0.25);
    expect(clampWeight(Infinity, 0.25)).toBe(0.25);
    expect(stepWeight(NaN, 1, 0.25)).toBe(0.25);
    expect(stepWeight(undefined as unknown as number, -1, 0.25)).toBe(0.25);
  });

  it("gives every slider stop as a usable weight, at or above the least", async () => {
    const { weightSteps } = await import("./weight");
    for (const min of [0, 0.25]) {
      for (const w of weightSteps(min)) {
        expect(Number.isFinite(w)).toBe(true);
        expect(w).toBeGreaterThanOrEqual(min);
      }
    }
    expect(weightSteps(0.25)).not.toContain(0);
  });

  it("reads nothing typed that isn't a weight", async () => {
    const { parseWeight } = await import("./weight");
    for (const s of ["", " ", "abc", "-1", "NaN", "1e3"]) expect(parseWeight(s, 0.25)).toBeNull();
    expect(parseWeight("0", 0.25)).toBe(0.25);
  });
});
