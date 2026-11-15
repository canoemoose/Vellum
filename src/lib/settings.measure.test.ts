import { describe, expect, it } from "vitest";
import { DEFAULTS, sanitiseSettings } from "./settings";

describe("measuring settings", () => {
  it("default to automatic units, two decimals, 8 pt labels and no page scales", () => {
    expect(DEFAULTS.measure).toEqual({ format: { units: "auto", decimals: 2 }, labelSize: 8, pageScales: {} });
    expect(sanitiseSettings({}).measure).toEqual(DEFAULTS.measure);
  });

  it("read back what was stored, checked", () => {
    const s = sanitiseSettings({ measure: { format: { units: "m", decimals: 3 }, labelSize: 12, pageScales: { "c:\\a.pdf": { 2: 50 }, bad: { 1: -4 } } } });
    expect(s.measure).toEqual({ format: { units: "m", decimals: 3 }, labelSize: 12, pageScales: { "c:\\a.pdf": { 2: 50 } } });
    expect(sanitiseSettings({ measure: { labelSize: 900, format: "x" } }).measure).toEqual(DEFAULTS.measure);
  });
});
