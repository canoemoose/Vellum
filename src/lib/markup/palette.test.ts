// docs/edit-lock-brief.md, 8: the line and fill palettes run in the same order, a fill under its
// line colour, each group eight swatches with None seventh among the fills and custom last.

import { describe, expect, it } from "vitest";
import { FILL_COLOURS, LINE_COLOURS } from "./palette";

describe("the palettes", () => {
  it("put each fill under its line colour", () => {
    const hues = ["Red", "Orange", "Yellow", "Green", "Blue"];
    expect(LINE_COLOURS.slice(0, 5).map((c) => c.name)).toEqual(hues);
    expect(FILL_COLOURS.slice(0, 5).map((c) => c.name)).toEqual(hues.map((h) => `Pale ${h.toLowerCase()}`));
    expect(LINE_COLOURS.slice(5).map((c) => c.name)).toEqual(["Magenta", "Black"]);
    // Sixth, White under Magenta; None (the bar's) under Black; custom under custom.
    expect(FILL_COLOURS.slice(5).map((c) => c.name)).toEqual(["White"]);
  });

  it("give every group eight swatches with None and custom", () => {
    expect(LINE_COLOURS.length + 1).toBe(8); // and custom
    expect(FILL_COLOURS.length + 2).toBe(8); // and None, and custom
  });

  it("keep the fills that were there before at the same colours, so saved ones still match", () => {
    const by = Object.fromEntries(FILL_COLOURS.map((c) => [c.name, c.c]));
    expect(by["White"]).toEqual([1, 1, 1]);
    expect(by["Pale yellow"]).toEqual([1, 0.97, 0.7]);
    expect(by["Pale red"]).toEqual([1, 0.85, 0.85]);
    expect(by["Pale blue"]).toEqual([0.85, 0.92, 1]);
    expect(by["Pale green"]).toEqual([0.85, 0.96, 0.85]);
    expect(by["Pale grey"]).toBeUndefined();
  });
});
