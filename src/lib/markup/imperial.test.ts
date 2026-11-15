// Imperial measuring (stage 5 [A9]): fractions and their reduction, every precision, the
// rounding carry, negative and zero, each imperial unit, Auto following the view, areas in
// square feet, typed lengths in either system, architectural and engineering scales both ways,
// and the /Measure entry an imperial measurement saves with.

import { describe, expect, it } from "vitest";
import {
  ARCHITECTURAL_SCALES, DEFAULT_FRACTION, ENGINEERING_SCALES, FRACTIONS, MM2_PER_FT2, MM_PER_FT, MM_PER_IN, formatFeetInches, formatFracInches,
  imperialScaleText, parseImperial, parseLengthScale, reduceFraction, sanitiseFraction, splitInches,
} from "./imperial";
import {
  type MeasureFormat, MM_PER_PT, calibrate, formatArea, formatLength, formatScale, isFractional, isImperial, lengthUnit, parseDistance, sameFormat,
  sanitiseFormat,
} from "./measure";
import { measureSpec } from "./dimension";

const inch = (x: number) => x * MM_PER_IN;
const foot = (x: number) => x * MM_PER_FT;
const f = (units: MeasureFormat["units"], extra: Partial<MeasureFormat> = {}): MeasureFormat => ({ units, decimals: 2, fraction: 16, ...extra });
const autoImperial = (extra: Partial<MeasureFormat> = {}) => f("auto", { system: "imperial", ...extra });

describe("fractions", () => {
  it("reduce to their lowest terms", () => {
    expect(reduceFraction(16, 32)).toEqual([1, 2]);
    expect(reduceFraction(8, 64)).toEqual([1, 8]);
    expect(reduceFraction(3, 16)).toEqual([3, 16]);
    expect(reduceFraction(48, 64)).toEqual([3, 4]);
    expect(reduceFraction(0, 16)).toEqual([0, 1]);
  });

  it("read 16/32 as 1/2 and 4/16 as 1/4 when written", () => {
    expect(formatFracInches(4.5, 32)).toBe(`4 1/2"`);
    expect(formatFracInches(4.25, 16)).toBe(`4 1/4"`);
    expect(formatFracInches(4.75, 64)).toBe(`4 3/4"`);
    expect(formatFeetInches(150.5, 64)).toBe(`12' 6 1/2"`);
  });

  it("round to every precision from 1/2 to 1/64 inch", () => {
    // 4.67" falls on a different fraction at each one.
    const want: Record<number, string> = { 2: `4 1/2"`, 4: `4 3/4"`, 8: `4 5/8"`, 16: `4 11/16"`, 32: `4 21/32"`, 64: `4 43/64"` };
    for (const d of FRACTIONS) expect(formatFracInches(4.67, d)).toBe(want[d]);
    expect(FRACTIONS).toEqual([2, 4, 8, 16, 32, 64]);
  });

  it("carry when the fraction rounds up to a whole inch or foot", () => {
    // 11' 11 63/64" is exact at 1/64 and rounds up to 12' 0" at 1/32 or coarser.
    const v = 143 + 63 / 64;
    expect(formatFeetInches(v, 64)).toBe(`11' 11 63/64"`);
    for (const d of [2, 4, 8, 16, 32]) expect(formatFeetInches(v, d)).toBe(`12' 0"`);
    expect(formatFracInches(v, 32)).toBe(`144"`);
    expect(formatFracInches(4.99, 16)).toBe(`5"`);
    expect(formatFeetInches(11.99, 16)).toBe(`1' 0"`);
    expect(splitInches(v, 32, true)).toEqual({ neg: false, ft: 12, inch: 0, num: 0, den: 1 });
  });

  it("write zero, a fraction alone and negative values", () => {
    expect(formatFeetInches(0)).toBe(`0' 0"`);
    expect(formatFracInches(0)).toBe(`0"`);
    expect(formatFracInches(0.5)).toBe(`1/2"`);
    expect(formatFeetInches(6.5)).toBe(`0' 6 1/2"`);
    expect(formatFeetInches(144.5)).toBe(`12' 0 1/2"`);
    expect(formatFeetInches(-18)).toBe(`-1' 6"`);
    expect(formatFracInches(-4.5)).toBe(`-4 1/2"`);
    // A negative value that rounds to nothing has no sign.
    expect(formatFracInches(-0.01, 16)).toBe(`0"`);
    expect(formatFeetInches(-0.01, 16)).toBe(`0' 0"`);
  });

  it("default to 1/16 inch and keep a stored precision only if it is offered", () => {
    expect(DEFAULT_FRACTION).toBe(16);
    expect(formatFracInches(4.67)).toBe(`4 11/16"`);
    for (const d of FRACTIONS) expect(sanitiseFraction(d)).toBe(d);
    for (const d of [0, 1, 3, 128, "16", null, undefined, Number.NaN]) expect(sanitiseFraction(d)).toBe(16);
  });
});

describe("imperial lengths", () => {
  it("write each unit as the brief shows it", () => {
    const mm = inch(148.5); // 12' 4 1/2"
    expect(formatLength(mm, f("ft-in"))).toBe(`12' 4 1/2"`);
    expect(formatLength(mm, f("in-frac"))).toBe(`148 1/2"`);
    expect(formatLength(foot(12.38), f("ft"))).toBe("12.38 ft");
    expect(formatLength(mm, f("in"))).toBe("148.50 in");
  });

  it("write many values in each unit", () => {
    const cases: [number, string, string, string, string][] = [
      // inches, ft-in, in-frac, ft (2 dp), in (2 dp)
      [0, `0' 0"`, `0"`, "0.00 ft", "0.00 in"],
      [1 / 16, `0' 0 1/16"`, `1/16"`, "0.01 ft", "0.06 in"],
      [1, `0' 1"`, `1"`, "0.08 ft", "1.00 in"],
      [11.5, `0' 11 1/2"`, `11 1/2"`, "0.96 ft", "11.50 in"],
      [12, `1' 0"`, `12"`, "1.00 ft", "12.00 in"],
      [36.1875, `3' 0 3/16"`, `36 3/16"`, "3.02 ft", "36.19 in"],
      [100.75, `8' 4 3/4"`, `100 3/4"`, "8.40 ft", "100.75 in"],
      [1200, `100' 0"`, `1200"`, "100.00 ft", "1200.00 in"],
      [12345.4375, `1028' 9 7/16"`, `12345 7/16"`, "1028.79 ft", "12345.44 in"],
    ];
    for (const [i, ftin, infrac, ft, dec] of cases) {
      expect(formatLength(inch(i), f("ft-in")), `${i} in`).toBe(ftin);
      expect(formatLength(inch(i), f("in-frac")), `${i} in`).toBe(infrac);
      expect(formatLength(inch(i), f("ft")), `${i} in`).toBe(ft);
      expect(formatLength(inch(i), f("in")), `${i} in`).toBe(dec);
    }
  });

  it("take the decimals for decimal feet and inches, and the precision for fractions", () => {
    expect(formatLength(foot(12.375), f("ft", { decimals: 0 }))).toBe("12 ft");
    expect(formatLength(foot(12.375), f("ft", { decimals: 3 }))).toBe("12.375 ft");
    expect(formatLength(inch(148.5), f("in", { decimals: 1 }))).toBe("148.5 in");
    expect(formatLength(inch(148.5), f("in", { decimals: 4 }))).toBe("148.5000 in");
    expect(formatLength(inch(4.67), f("in-frac", { fraction: 2, decimals: 4 }))).toBe(`4 1/2"`);
    expect(formatLength(inch(4.67), f("ft-in", { fraction: 64 }))).toBe(`0' 4 43/64"`);
    // A format with no precision (made before there was one) takes 1/16.
    expect(formatLength(inch(4.67), { units: "in-frac", decimals: 2 })).toBe(`4 11/16"`);
  });

  it("write negative decimal values without a stray -0", () => {
    expect(formatLength(-inch(18), f("ft"))).toBe("-1.50 ft");
    expect(formatLength(-0.001, f("in"))).toBe("0.00 in");
  });
});

describe("Auto follows View > Units", () => {
  it("is metres and millimetres in a metric view, or with no system recorded", () => {
    expect(formatLength(12400, f("auto", { system: "metric" }))).toBe("12.40 m");
    expect(formatLength(850, f("auto"))).toBe("850 mm");
    expect(formatLength(inch(148.5), { units: "auto", decimals: 2 })).toBe("3.77 m");
  });

  it("is feet and inches in an imperial view, inches under a foot", () => {
    expect(formatLength(inch(148.5), autoImperial())).toBe(`12' 4 1/2"`);
    expect(formatLength(inch(6.5), autoImperial())).toBe(`6 1/2"`);
    expect(formatLength(inch(12), autoImperial())).toBe(`1' 0"`);
    expect(formatLength(0, autoImperial())).toBe(`0"`);
    expect(lengthUnit(inch(11.5), autoImperial())).toBe("in-frac");
    expect(lengthUnit(inch(12), autoImperial())).toBe("ft-in");
  });

  it("decides feet on the rounded value, so a value just under a foot reads 1' 0\"", () => {
    expect(formatLength(inch(11.99), autoImperial())).toBe(`1' 0"`);
    expect(formatLength(inch(11.995), autoImperial({ fraction: 64 }))).toBe(`1' 0"`);
    expect(formatLength(inch(11.99), autoImperial({ fraction: 64 }))).toBe(`11 63/64"`);
    expect(formatLength(inch(11.95), autoImperial({ fraction: 64 }))).toBe(`11 61/64"`);
    expect(formatLength(-inch(18), autoImperial())).toBe(`-1' 6"`);
  });

  it("only Auto uses the view's system", () => {
    expect(formatLength(12400, f("m", { system: "imperial" }))).toBe("12.40 m");
    expect(formatLength(inch(148.5), f("ft-in", { system: "metric" }))).toBe(`12' 4 1/2"`);
  });

  it("knows which formats are imperial and which take a precision", () => {
    expect(isImperial(f("auto"))).toBe(false);
    expect(isImperial(autoImperial())).toBe(true);
    for (const u of ["ft-in", "in-frac", "ft", "in"] as const) expect(isImperial(f(u))).toBe(true);
    for (const u of ["mm", "m"] as const) expect(isImperial(f(u, { system: "imperial" }))).toBe(false);
    expect(isFractional(autoImperial())).toBe(true);
    expect(isFractional(f("ft-in"))).toBe(true);
    expect(isFractional(f("in-frac"))).toBe(true);
    expect(isFractional(f("ft"))).toBe(false);
    expect(isFractional(f("in"))).toBe(false);
    expect(isFractional(f("auto"))).toBe(false);
  });

  it("compares formats by the text they write", () => {
    expect(sameFormat(f("auto"), f("auto", { system: "metric" }))).toBe(true);
    expect(sameFormat(f("auto"), autoImperial())).toBe(false);
    expect(sameFormat(f("m"), f("m", { system: "imperial" }))).toBe(true);
    expect(sameFormat(f("ft-in", { fraction: 16 }), { units: "ft-in", decimals: 2 })).toBe(true);
    expect(sameFormat(f("ft-in", { fraction: 32 }), f("ft-in"))).toBe(false);
  });
});

describe("imperial areas", () => {
  const sq = 100 * MM2_PER_FT2; // a 10 ft square
  it("are square feet in every imperial unit", () => {
    expect(formatArea(sq, f("ft-in"))).toBe("100.00 ft²");
    expect(formatArea(sq, f("in-frac"))).toBe("100.00 ft²");
    expect(formatArea(sq, f("ft"))).toBe("100.00 ft²");
    expect(formatArea(sq, f("in"))).toBe("100.00 ft²");
    expect(formatArea(sq, autoImperial())).toBe("100.00 ft²");
    expect(formatArea(foot(12) * foot(12.5), f("ft"))).toBe("150.00 ft²");
  });

  it("take the decimals where the unit has them, and two where it has a precision", () => {
    expect(formatArea(sq * 1.2346, f("ft", { decimals: 1 }))).toBe("123.5 ft²");
    expect(formatArea(sq * 1.2346, f("in", { decimals: 3 }))).toBe("123.460 ft²");
    expect(formatArea(sq * 1.2346, f("ft-in", { decimals: 0 }))).toBe("123.46 ft²");
    expect(formatArea(sq * 1.2346, autoImperial({ decimals: 4 }))).toBe("123.46 ft²");
  });

  it("leave metric areas alone", () => {
    expect(formatArea(12.4e6, f("auto"))).toBe("12.40 m²");
    expect(formatArea(250000, f("mm"))).toBe("250000 mm²");
    expect(formatArea(0, autoImperial())).toBe("0.00 ft²");
  });
});

describe("typed lengths", () => {
  it("read feet and inches in every usual way", () => {
    const cases: [string, number][] = [
      [`12' 4 1/2"`, 148.5],
      [`12'-4 1/2"`, 148.5],
      [`12' - 4-1/2"`, 148.5],
      [`12'4"`, 148],
      [`12' 6`, 150],
      [`12'`, 144],
      [`12'-0"`, 144],
      [`148.5"`, 148.5],
      [`148 1/2"`, 148.5],
      [`1/2"`, 0.5],
      [`3/4 in`, 0.75],
      [`12.38 ft`, 148.56],
      [`12.38'`, 148.56],
      [`12 ft 4 in`, 148],
      [`12ft4in`, 148],
      [`148.5 in`, 148.5],
      [`148.5in`, 148.5],
      [`6 inches`, 6],
      [`1 inch`, 1],
      [`2 feet`, 24],
      [`1 foot 6 inches`, 18],
      [`12 ft. 4 in.`, 148],
      [`12''`, 12],
      [`12′ 4″`, 148],
      [`12’ 4 1/2”`, 148.5],
      [` 12 ' 4 " `, 148],
      [`.5"`, 0.5],
    ];
    for (const [s, want] of cases) expect(parseImperial(s), s).toBeCloseTo(want, 9);
  });

  it("refuse what isn't a length, and a bare number unless told it's inches", () => {
    for (const s of ["", "'", `"`, "abc", "148", "4 1/2", `1/0"`, `12' 4 1/2" extra`, `-3"`, "4.2 m", "1:100", `12 yd`, `4 1/2' 3"`]) {
      expect(parseImperial(s), s).toBeNull();
    }
    expect(parseImperial("148", "in")).toBe(148);
    expect(parseImperial("4 1/2", "in")).toBe(4.5);
    expect(parseImperial("1/4", "in")).toBe(0.25);
  });

  it("calibrate from either system", () => {
    expect(parseDistance(`12' 4 1/2"`)).toBeCloseTo(3771.9, 9);
    expect(parseDistance(`12'-4 1/2"`)).toBeCloseTo(3771.9, 9);
    expect(parseDistance(`148.5"`)).toBeCloseTo(3771.9, 9);
    expect(parseDistance("12.38 ft")).toBeCloseTo(3773.424, 9);
    expect(parseDistance("4.2 ft")).toBeCloseTo(1280.16, 9);
    expect(parseDistance("3.2 m")).toBe(3200);
    expect(parseDistance("3200 mm")).toBe(3200);
    // A bare number is still millimetres, in either view.
    expect(parseDistance("3200")).toBe(3200);
    expect(parseDistance(`0'`)).toBeNull();
    expect(parseDistance(`0"`)).toBeNull();
    // 1 in on paper that is 4 ft in reality: 1/4" = 1'-0", 1:48.
    expect(calibrate(parseDistance(`4'`)!, 25.4)).toBeCloseTo(48, 9);
  });
});

describe("architectural and engineering scales", () => {
  const arch: [number, string][] = [
    [192, `1/16" = 1'-0"`],
    [128, `3/32" = 1'-0"`],
    [96, `1/8" = 1'-0"`],
    [64, `3/16" = 1'-0"`],
    [48, `1/4" = 1'-0"`],
    [32, `3/8" = 1'-0"`],
    [24, `1/2" = 1'-0"`],
    [16, `3/4" = 1'-0"`],
    [12, `1" = 1'-0"`],
    [8, `1 1/2" = 1'-0"`],
    [4, `3" = 1'-0"`],
    [2, `6" = 1'-0"`],
    [1, `12" = 1'-0"`],
  ];
  const eng: [number, string][] = [
    [120, `1" = 10'`],
    [240, `1" = 20'`],
    [360, `1" = 30'`],
    [480, `1" = 40'`],
    [600, `1" = 50'`],
    [720, `1" = 60'`],
    [1200, `1" = 100'`],
  ];

  it("are written the imperial way where the ratio is one", () => {
    for (const [r, s] of [...arch, ...eng]) expect(imperialScaleText(r), String(r)).toBe(s);
    for (const r of [100, 50, 1250, 47.93, 0.5, 0, Number.NaN, Infinity]) expect(imperialScaleText(r), String(r)).toBeNull();
  });

  it("are read back to the same ratio", () => {
    for (const [r, s] of [...arch, ...eng]) expect(parseLengthScale(s), s).toBeCloseTo(r, 9);
    for (const r of [...ARCHITECTURAL_SCALES, ...ENGINEERING_SCALES]) expect(parseLengthScale(imperialScaleText(r)!)).toBeCloseTo(r, 9);
  });

  it("are read however they're typed", () => {
    expect(parseLengthScale(`1/4"=1'`)).toBeCloseTo(48, 9);
    expect(parseLengthScale(`1/4 in = 1 ft`)).toBeCloseTo(48, 9);
    expect(parseLengthScale(`1/4 = 1'-0"`)).toBeCloseTo(48, 9);
    expect(parseLengthScale(`1" = 20 ft`)).toBeCloseTo(240, 9);
    expect(parseLengthScale(`1 = 20'`)).toBeCloseTo(240, 9);
    expect(parseLengthScale(`3/32″ = 1′-0″`)).toBeCloseTo(128, 9);
    for (const s of [`1/4" = 12`, "1:100", "100", "a = b", `0" = 1'`, `1" = 0'`, `1" = 1' = 2'`, ""]) expect(parseLengthScale(s), s).toBeNull();
  });

  it("are offered from small to large, architectural then engineering", () => {
    expect(ARCHITECTURAL_SCALES.every((r) => imperialScaleText(r)?.endsWith(`= 1'-0"`))).toBe(true);
    expect(ENGINEERING_SCALES.every((r) => /^1" = \d+'$/.test(imperialScaleText(r)!))).toBe(true);
  });

  it("show in measuring's own scale text only for imperial", () => {
    expect(formatScale(48, "imperial")).toBe(`1/4" = 1'-0"`);
    expect(formatScale(100, "imperial")).toBe("1:100");
    expect(formatScale(98.7341, "imperial")).toBe("1:98.73");
    expect(formatScale(48)).toBe("1:48");
    expect(formatScale(48, "metric")).toBe("1:48");
  });
});

describe("the saved /Measure for imperial", () => {
  const pm = { ratio: 48, userUnit: 1 };
  // One point on paper at 1:48 is 48/72 inch in reality.
  const realInPerPt = 48 / 72;

  it("feet and inches: feet converted, inches as a fraction, areas in square feet", () => {
    expect(measureSpec(pm, f("ft-in", { fraction: 32 }), inch(148.5))).toEqual({
      ratio: `1/4" = 1'-0"`,
      unit: "ft",
      factor: expect.closeTo(realInPerPt / 12, 12),
      precision: 32,
      fraction: true,
      feetInches: true,
      areaUnit: "sq ft",
      areaFactor: 1,
      areaPrecision: 100,
    });
  });

  it("inches with a fraction, and decimal feet and inches", () => {
    const i = measureSpec(pm, f("in-frac"), inch(10));
    expect(i).toMatchObject({ unit: "in", precision: 16, fraction: true, feetInches: false, areaUnit: "sq ft", areaPrecision: 100 });
    expect(i.factor).toBeCloseTo(realInPerPt, 12);
    expect(i.areaFactor).toBeCloseTo(1 / 144, 12);
    expect(measureSpec(pm, f("ft", { decimals: 3 }), 0)).toMatchObject({ unit: "ft", precision: 1000, fraction: false, feetInches: false, areaFactor: 1, areaPrecision: 1000 });
    expect(measureSpec(pm, f("in", { decimals: 1 }), 0)).toMatchObject({ unit: "in", precision: 10, fraction: false, areaPrecision: 10 });
  });

  it("follows Auto: inches for a short length, feet and inches for a long one or an area", () => {
    expect(measureSpec(pm, autoImperial(), inch(6)).unit).toBe("in");
    expect(measureSpec(pm, autoImperial(), inch(148.5))).toMatchObject({ unit: "ft", feetInches: true });
    expect(measureSpec(pm, autoImperial(), Infinity)).toMatchObject({ unit: "ft", feetInches: true });
  });

  it("turns the drawn length back into the label's value", () => {
    // 148.5 in at 1:48 is 3.09375 in on paper, 222.75 pt.
    const s = measureSpec(pm, f("ft-in"), inch(148.5));
    expect(222.75 * s.factor * 12).toBeCloseTo(148.5, 9);
    expect(MM_PER_PT * 222.75 * 48).toBeCloseTo(inch(148.5), 9);
  });

  it("writes metric and paper exactly as before", () => {
    expect(measureSpec(pm, f("auto"), 12400)).toEqual({ ratio: "1:48", unit: "m", factor: (MM_PER_PT * 48) / 1000, precision: 100 });
    expect(measureSpec({ ratio: null, userUnit: 1 }, autoImperial(), 100)).toEqual({ ratio: "1:1 (paper)", unit: "mm", factor: MM_PER_PT, precision: 10 });
  });
});

describe("stored formats", () => {
  it("keep the imperial units and the precision, and drop the view's system", () => {
    for (const u of ["auto", "mm", "m", "ft-in", "in-frac", "ft", "in"] as const) expect(sanitiseFormat({ units: u, decimals: 2 }).units).toBe(u);
    expect(sanitiseFormat({ units: "ft-in", decimals: 2, fraction: 32, system: "imperial" })).toEqual({ units: "ft-in", decimals: 2, fraction: 32 });
    expect(sanitiseFormat({ units: "in-frac", decimals: 2, fraction: 5 })).toEqual({ units: "in-frac", decimals: 2, fraction: 16 });
    // Formats stored before imperial (no precision) read back with 1/16.
    expect(sanitiseFormat({ units: "m", decimals: 3 })).toEqual({ units: "m", decimals: 3, fraction: 16 });
  });
});
