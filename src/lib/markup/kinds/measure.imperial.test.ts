// Imperial measuring (stage 5 [A9]) through the measuring kinds: labels and readouts in feet and
// inches, the scale read the imperial way, areas in square feet, angles unchanged, the saved
// /Measure, and Auto following View > Units (resolveAuto, reformat, a new measurement taking
// the view's system from the measure source).

import { afterEach, describe, expect, it } from "vitest";
import type { Markup, MarkupKind, MarkupOf } from "../base";
import { type TextOp, opsFor } from "../ops";
import { toSpec } from "../spec";
import type { Frame } from "../pdf";
import { DEFAULT_FORMAT, type MeasureFormat, MM_PER_PT, setMeasureSource } from "../measure";
import { MM_PER_IN } from "../imperial";
import { newMeasure } from "../dimension";
import { measurementLine, measurementText, reformat, resolveAuto } from "../measurements";
import { kindOf } from ".";

const A3: Frame = { quarterTurns: 0, bbox: [0, 0, 1191, 842] };
const meta = { author: "Tester", created: "2026-11-15T10:00:00Z", modified: "2026-11-15T10:00:00Z" };
const metricAuto: MeasureFormat = { units: "auto", decimals: 2, fraction: 16, system: "metric" };
const imperialAuto: MeasureFormat = { ...metricAuto, system: "imperial" };
/** Page points for a real length in inches at 1:48 (1/4" = 1'-0"). */
const at48 = (inches: number) => inches / 48 / MM_PER_PT * MM_PER_IN;

function mk<K extends MarkupKind>(kind: K, shape: Record<string, unknown>, fmt: MeasureFormat, scale: number | null = 48): MarkupOf<K> {
  return { id: `t-${kind}`, page: 0, kind, style: kindOf(kind).defaultStyle(), meta, scale, userUnit: 1, fmt, labelSize: 8, ...shape } as unknown as MarkupOf<K>;
}

const label = (m: Markup) => opsFor(m).filter((o): o is TextOp => o.t === "text").flatMap((t) => t.lines);
const length = (inches: number, fmt: MeasureFormat, scale: number | null = 48) => mk("measureLength", { from: [100, 100], to: [100 + at48(inches), 100] }, fmt, scale);

afterEach(() => setMeasureSource({ page: () => ({ ratio: null, userUnit: 1 }), format: () => DEFAULT_FORMAT, labelSize: () => 8 }));

describe("an imperial length", () => {
  it("labels and reads out in feet and inches, at an architectural scale", () => {
    const m = length(148.5, imperialAuto);
    expect(label(m)).toEqual([`12' 4 1/2"`]);
    expect(measurementText(m)).toEqual({ real: `12' 4 1/2" at 1/4" = 1'-0"`, paper: "78.6 mm on paper" });
    expect(measurementLine(m)).toBe(`12' 4 1/2" at 1/4" = 1'-0", 78.6 mm on paper`);
  });

  it("reads in each unit chosen, whatever the view", () => {
    const fmt = (units: MeasureFormat["units"]) => ({ ...metricAuto, units });
    expect(label(length(148.5, fmt("ft-in")))).toEqual([`12' 4 1/2"`]);
    expect(label(length(148.5, fmt("in-frac")))).toEqual([`148 1/2"`]);
    expect(label(length(148.5, fmt("ft")))).toEqual(["12.38 ft"]);
    expect(label(length(148.5, fmt("in")))).toEqual(["148.50 in"]);
    expect(label(length(148.5, metricAuto))).toEqual(["3.77 m"]);
  });

  it("keeps a metric scale as a ratio, and an imperial unit at a metric scale", () => {
    const m = length(148.5, { ...metricAuto, units: "ft-in" }, 100);
    expect(measurementText(m)!.real).toMatch(/ at 1:100$/);
    // A metric measurement in an imperial view reads its scale as a ratio.
    expect(measurementText(length(148.5, { ...imperialAuto, units: "m" }))!.real).toBe("3.77 m at 1:48");
  });

  it("with no scale, still reads paper millimetres", () => {
    expect(label(length(148.5, imperialAuto, null))[0]).toMatch(/mm \(paper\)$/);
  });

  it("saves a /Measure that writes feet and inches", () => {
    const s = toSpec(length(148.5, imperialAuto), A3);
    expect(s.contents).toBe(`12' 4 1/2"`);
    expect(s.measure).toMatchObject({ ratio: `1/4" = 1'-0"`, unit: "ft", precision: 16, fraction: true, feetInches: true, areaUnit: "sq ft" });
    // Its factor turns the drawn length back into the label's value.
    expect(at48(148.5) * s.measure!.factor * 12).toBeCloseTo(148.5, 9);
  });
});

describe("an imperial area and angle", () => {
  // A 10 ft square at 1:48.
  const side = at48(120);
  const sq = [[100, 100], [100 + side, 100], [100 + side, 100 + side], [100, 100 + side]];

  it("an area reads square feet and a feet and inches perimeter", () => {
    const m = mk("measureArea", { vertices: sq }, imperialAuto);
    expect(label(m)).toEqual(["100.00 ft²", `Perimeter 40' 0"`]);
    expect(measurementText(m)!.real).toBe(`100.00 ft², perimeter 40' 0" at 1/4" = 1'-0"`);
    expect(toSpec(m, A3).measure).toMatchObject({ unit: "ft", areaUnit: "sq ft", areaFactor: 1, areaPrecision: 100 });
  });

  it("an angle is unaffected", () => {
    const vertices = [[200, 100], [100, 100], [100, 200]];
    expect(label(mk("measureAngle", { vertices }, imperialAuto))).toEqual(label(mk("measureAngle", { vertices }, metricAuto)));
  });
});

describe("Auto follows View > Units", () => {
  it("a new measurement takes the view's system from the measure source", () => {
    setMeasureSource({ page: () => ({ ratio: 48, userUnit: 1 }), format: () => ({ ...DEFAULT_FORMAT, system: "imperial" }), labelSize: () => 8 });
    expect(newMeasure().fmt.system).toBe("imperial");
  });

  it("resolveAuto rewrites every Auto measurement's system, and nothing else", () => {
    const auto = length(148.5, metricAuto);
    const ft = { ...length(148.5, { ...metricAuto, units: "ft" }), id: "ft" };
    const note = { id: "n", page: 0, kind: "note", style: kindOf("measureLength").defaultStyle(), meta } as unknown as Markup;
    const list = [auto, ft, note];
    const out = resolveAuto(list, "imperial");
    expect(label(out[0])).toEqual([`12' 4 1/2"`]);
    expect(out[1]).toBe(ft);
    expect(out[2]).toBe(note);
    // Back to metric; and no change gives the same list.
    expect(label(resolveAuto(out, "metric")[0])).toEqual(["3.77 m"]);
    expect(resolveAuto(out, "imperial")).toBe(out);
    expect(resolveAuto([length(1, { units: "auto", decimals: 2 })], "metric")).toHaveLength(1);
    const old = [length(1, { units: "auto", decimals: 2 })];
    expect(resolveAuto(old, "metric")).toBe(old);
  });

  it("reformat keeps the measurement's system when the new format has none", () => {
    const m = length(148.5, imperialAuto);
    const r = reformat([m], { units: "auto", decimals: 2, fraction: 32 });
    expect(r.changed).toBe(1);
    expect((r.markups[0] as typeof m).fmt).toEqual({ units: "auto", decimals: 2, fraction: 32, system: "imperial" });
    // The same text in another form changes nothing.
    expect(reformat([m], { units: "auto", decimals: 2 }).changed).toBe(0);
    expect(reformat([m], { ...imperialAuto }).changed).toBe(0);
  });

  it("changing the precision changes an imperial measurement", () => {
    const m = length(4.67, { ...metricAuto, units: "in-frac" });
    expect(label(m)).toEqual([`4 11/16"`]);
    const r = reformat([m], { ...metricAuto, units: "in-frac", fraction: 64 });
    expect(label(r.markups[0])).toEqual([`4 43/64"`]);
  });
});
