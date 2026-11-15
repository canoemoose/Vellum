// The scale box and status bar with imperial scales (stage 5 [A9]): architectural and
// engineering scales typed in, and shown that way in an imperial view; the ratio is still what
// is held.

import { describe, expect, it } from "vitest";
import { formatRatio, parseScaleInput, scaleStatusText } from "./scale";
import { pageScaleText } from "./pageScale";

describe("imperial scales in the scale box", () => {
  it("are accepted as typed", () => {
    expect(parseScaleInput(`1/4" = 1'-0"`)).toBeCloseTo(48, 9);
    expect(parseScaleInput(`1/8"=1'`)).toBeCloseTo(96, 9);
    expect(parseScaleInput(`3/32" = 1'-0"`)).toBeCloseTo(128, 9);
    expect(parseScaleInput(`1 1/2" = 1'-0"`)).toBeCloseTo(8, 9);
    expect(parseScaleInput(`1" = 20'`)).toBeCloseTo(240, 9);
    expect(parseScaleInput(`1 in = 100 ft`)).toBeCloseTo(1200, 9);
  });

  it("still take ratios, and refuse what's out of range", () => {
    expect(parseScaleInput("1:200")).toBe(200);
    expect(parseScaleInput("1/200")).toBe(200);
    expect(parseScaleInput("50")).toBe(50);
    // Larger than full size, or not a scale.
    expect(parseScaleInput(`2" = 1"`)).toBeNull();
    expect(parseScaleInput(`1/4" = 12`)).toBeNull();
    expect(parseScaleInput(`1/4"`)).toBeNull();
    expect(parseScaleInput(`1/4" = 1'-0" = 2'`)).toBeNull();
  });

  it("are shown the imperial way in an imperial view, and as ratios otherwise", () => {
    expect(formatRatio(48, "imperial")).toBe(`1/4" = 1'-0"`);
    expect(formatRatio(240, "imperial")).toBe(`1" = 20'`);
    expect(formatRatio(100, "imperial")).toBe("1:100");
    expect(formatRatio(48)).toBe("1:48");
    expect(formatRatio(48, "metric")).toBe("1:48");
    // What the box shows reads back to the same ratio.
    for (const r of [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 120, 240, 1200, 100, 2.5]) expect(parseScaleInput(formatRatio(r, "imperial"))).toBeCloseTo(r, 9);
  });

  it("show in the status bar", () => {
    expect(scaleStatusText({ ratio: 48, source: "detected" }, "imperial")).toBe(`Scale 1/4" = 1'-0" (from title block)`);
    expect(scaleStatusText({ ratio: 48, source: "manual" }, "imperial")).toBe(`Scale 1/4" = 1'-0"`);
    expect(scaleStatusText({ ratio: 48, source: "manual" })).toBe("Scale 1:48");
    expect(pageScaleText(null, { 1: { ratio: 96, source: "manual" } }, 1, "imperial")).toBe(`Scale 1/8" = 1'-0" (this page)`);
    expect(pageScaleText({ ratio: 240, source: "manual" }, {}, 0, "imperial")).toBe(`Scale 1" = 20'`);
    expect(pageScaleText(null, {}, 0, "imperial")).toBe("Scale not set");
  });
});
