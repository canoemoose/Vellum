// docs/edit-lock-brief.md, 8 and Matt's review: eight swatches in each group; the fills run None,
// White, the pale hues and grey, then custom.

import { describe, expect, it } from "vitest";
import { FILL_COLOURS, LINE_COLOURS } from "./palette";

describe("the palettes", () => {
  it("run the fills White, red, yellow, green, blue, grey (None comes first in the bar)", () => {
    expect(FILL_COLOURS.map((c) => c.name)).toEqual(["White", "Pale red", "Pale yellow", "Pale green", "Pale blue", "Pale grey"]);
  });

  it("give every group eight swatches with None and custom", () => {
    expect(LINE_COLOURS.length + 1).toBe(8); // and custom
    expect(FILL_COLOURS.length + 2).toBe(8); // and None, and custom
  });

  it("keep each fill at the colour it always had, so saved ones still match", () => {
    const by = Object.fromEntries(FILL_COLOURS.map((c) => [c.name, c.c]));
    expect(by["White"]).toEqual([1, 1, 1]);
    expect(by["Pale yellow"]).toEqual([1, 0.97, 0.7]);
    expect(by["Pale red"]).toEqual([1, 0.85, 0.85]);
    expect(by["Pale blue"]).toEqual([0.85, 0.92, 1]);
    expect(by["Pale green"]).toEqual([0.85, 0.96, 0.85]);
    expect(by["Pale grey"]).toEqual([0.9, 0.9, 0.9]);
  });
});
