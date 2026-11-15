import { describe, expect, it } from "vitest";
import { DEFAULTS, sanitiseSettings } from "./settings";

describe("measuring settings", () => {
  it("default to automatic units, two decimals, 8 pt labels, no page scales, bars and Helvetica", () => {
    expect(DEFAULTS.measure).toEqual({ format: { units: "auto", decimals: 2 }, labelSize: 8, pageScales: {}, look: { ends: "bar", font: "helvetica" } });
    expect(sanitiseSettings({}).measure).toEqual(DEFAULTS.measure);
  });

  it("read back what was stored, checked", () => {
    const s = sanitiseSettings({
      measure: { format: { units: "m", decimals: 3 }, labelSize: 12, pageScales: { "c:\\a.pdf": { 2: 50 }, bad: { 1: -4 } }, look: { ends: "tick", font: "courierBold" } },
    });
    expect(s.measure).toEqual({ format: { units: "m", decimals: 3 }, labelSize: 12, pageScales: { "c:\\a.pdf": { 2: 50 } }, look: { ends: "tick", font: "courierBold" } });
    expect(sanitiseSettings({ measure: { labelSize: 900, format: "x", look: { ends: "dot" } } }).measure).toEqual(DEFAULTS.measure);
  });
});
