import { describe, expect, it } from "vitest";
import { DEFAULTS, sanitiseSettings } from "./settings";

describe("measuring settings", () => {
  it("default to automatic units, two decimals, 1/16 inch, 8 pt labels, no page scales, bars and Helvetica", () => {
    expect(DEFAULTS.measure).toEqual({ format: { units: "auto", decimals: 2, fraction: 16 }, labelSize: 8, pageScales: {}, look: { ends: "bar", font: "helvetica" } });
    expect(sanitiseSettings({}).measure).toEqual(DEFAULTS.measure);
  });

  it("read back what was stored, checked", () => {
    const s = sanitiseSettings({
      measure: { format: { units: "m", decimals: 3 }, labelSize: 12, pageScales: { "c:\\a.pdf": { 2: 50 }, bad: { 1: -4 } }, look: { ends: "tick", font: "courierBold" } },
    });
    expect(s.measure).toEqual({ format: { units: "m", decimals: 3, fraction: 16 }, labelSize: 12, pageScales: { "c:\\a.pdf": { 2: 50 } }, look: { ends: "tick", font: "courierBold" } });
    expect(sanitiseSettings({ measure: { labelSize: 900, format: "x", look: { ends: "dot" } } }).measure).toEqual(DEFAULTS.measure);
  });

  // Imperial (stage 5 [A9])
  it("read back an imperial format with its precision, and never the view's system", () => {
    const s = sanitiseSettings({ measure: { format: { units: "ft-in", decimals: 2, fraction: 32, system: "imperial" } } });
    expect(s.measure.format).toEqual({ units: "ft-in", decimals: 2, fraction: 32 });
    expect(sanitiseSettings({ measure: { format: { units: "in", decimals: 1, fraction: 3 } } }).measure.format).toEqual({ units: "in", decimals: 1, fraction: 16 });
    expect(sanitiseSettings({ measure: { format: { units: "yd", decimals: 2, fraction: 64 } } }).measure.format).toEqual({ units: "auto", decimals: 2, fraction: 64 });
  });
});
