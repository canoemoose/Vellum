import { describe, expect, it } from "vitest";
import type { Pt } from "./base";
import {
  MM_PER_PT, angleAt, calibrate, formatAngle, formatArea, formatLength, formatPaper, formatPaperArea, formatScale, labelPoint, paperMm, paperMm2,
  parseDistance, pathLength, polygonArea, realMm, realMm2, sanitiseFormat, selfCrossing, uprightDir,
} from "./measure";

/** Page points for a length on paper in mm. */
const pt = (mm: number) => mm / MM_PER_PT;

describe("lengths", () => {
  it("adds up a run of points, open or closed", () => {
    const sq: Pt[] = [[0, 0], [3, 0], [3, 4], [0, 4]];
    expect(pathLength(sq)).toBe(10);
    expect(pathLength(sq, true)).toBe(14);
    expect(pathLength([[0, 0], [3, 4]])).toBe(5);
    expect(pathLength([[1, 1]])).toBe(0);
  });

  it("converts page points to paper and real millimetres", () => {
    expect(paperMm(72)).toBeCloseTo(25.4, 9);
    expect(realMm(72, { ratio: 100, userUnit: 1 })).toBeCloseTo(2540, 9);
    expect(realMm(72, { ratio: null, userUnit: 1 })).toBeNull();
  });

  it("counts a page's /UserUnit", () => {
    // A unit on a /UserUnit 10 page is ten points long.
    expect(paperMm(72, 10)).toBeCloseTo(254, 9);
    expect(realMm(72, { ratio: 50, userUnit: 10 })).toBeCloseTo(12700, 9);
    expect(paperMm2(72 * 72, 10)).toBeCloseTo(254 * 254, 6);
  });
});

describe("areas", () => {
  it("measures a 10 m square drawn at 1:100", () => {
    // 10 m at 1:100 is 100 mm on paper.
    const s = pt(100);
    const sq: Pt[] = [[0, 0], [s, 0], [s, s], [0, s]];
    expect(realMm2(polygonArea(sq), { ratio: 100, userUnit: 1 })! / 1e6).toBeCloseTo(100, 9);
    expect(realMm(pathLength(sq, true), { ratio: 100, userUnit: 1 })! / 1000).toBeCloseTo(40, 9);
    expect(formatArea(realMm2(polygonArea(sq), { ratio: 100, userUnit: 1 })!)).toBe("100.00 m²");
  });

  it("measures either winding the same", () => {
    const cw: Pt[] = [[0, 0], [4, 0], [4, 3]];
    expect(polygonArea(cw)).toBe(6);
    expect(polygonArea([...cw].reverse())).toBe(6);
  });

  it("measures a concave shape", () => {
    // An L: a 4 x 4 square less a 2 x 2 corner.
    const l: Pt[] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
    expect(polygonArea(l)).toBe(12);
    expect(pathLength(l, true)).toBe(16);
    expect(selfCrossing(l)).toBe(false);
  });

  it("nets out a self-crossing outline's lobes and says it crosses", () => {
    // A figure of eight (bow tie): two triangles of 4 wound opposite ways.
    const bow: Pt[] = [[0, 0], [4, 4], [4, 0], [0, 4]];
    expect(polygonArea(bow)).toBe(0);
    expect(selfCrossing(bow)).toBe(true);
    expect(selfCrossing([[0, 0], [4, 0], [4, 4], [0, 4]])).toBe(false);
  });

  it("puts the label inside, even when the centroid isn't", () => {
    expect(labelPoint([[0, 0], [4, 0], [4, 4], [0, 4]])).toEqual([2, 2]);
    // A C shape whose centroid lies in the notch.
    const c: Pt[] = [[0, 0], [10, 0], [10, 2], [2, 2], [2, 8], [10, 8], [10, 10], [0, 10]];
    const p = labelPoint(c);
    expect(p[0]).toBeGreaterThan(0);
    expect(p[0]).toBeLessThan(2);
  });
});

describe("angles", () => {
  const c: Pt = [0, 0];
  it("measures in every quadrant", () => {
    expect(angleAt([1, 0], c, [0, 1])).toBeCloseTo(90, 9);
    expect(angleAt([1, 0], c, [-1, 1])).toBeCloseTo(135, 9);
    expect(angleAt([-1, 0], c, [0, -1])).toBeCloseTo(90, 9);
    expect(angleAt([1, -1], c, [1, 1])).toBeCloseTo(90, 9);
    expect(angleAt([1, 0], c, [-1, -1e-12])).toBeCloseTo(180, 6);
    expect(angleAt([1, 0], c, [Math.cos(0.5), -Math.sin(0.5)])).toBeCloseTo((0.5 * 180) / Math.PI, 9);
  });

  it("is the same whichever arm is clicked first, and never over 180", () => {
    expect(angleAt([0, 1], c, [1, 0])).toBeCloseTo(90, 9);
    expect(angleAt([1, 0], c, [-1, -0.2])).toBeLessThanOrEqual(180);
  });

  it("is 0 for an arm with no length", () => {
    expect(angleAt(c, c, [1, 0])).toBe(0);
  });
});

describe("formatting", () => {
  const f = { units: "auto" as const, decimals: 2 };
  it("writes metres from 1 m up and whole millimetres below", () => {
    expect(formatLength(12400, f)).toBe("12.40 m");
    expect(formatLength(1000, f)).toBe("1.00 m");
    expect(formatLength(999, f)).toBe("999 mm");
    expect(formatLength(999.4, f)).toBe("999 mm");
    // Rounds up to 1000: written in metres, never "1000 mm".
    expect(formatLength(999.6, f)).toBe("1.00 m");
    expect(formatLength(0.3, f)).toBe("0 mm");
    expect(formatLength(850.5, f)).toBe("851 mm");
  });

  it("keeps to always mm or always m", () => {
    expect(formatLength(12400, { units: "mm", decimals: 2 })).toBe("12400 mm");
    expect(formatLength(850, { units: "m", decimals: 3 })).toBe("0.850 m");
    expect(formatLength(12400, { units: "m", decimals: 0 })).toBe("12 m");
  });

  it("writes areas, angles and paper values", () => {
    expect(formatArea(12.4e6, f)).toBe("12.40 m²");
    expect(formatArea(250000, f)).toBe("0.25 m²");
    expect(formatArea(250000, { units: "mm", decimals: 2 })).toBe("250000 mm²");
    expect(formatAngle(45)).toBe("45.0°");
    expect(formatAngle(89.96)).toBe("90.0°");
    expect(formatPaper(124)).toBe("124.0 mm");
    expect(formatPaperArea(1240)).toBe("1240.0 mm²");
    expect(formatPaper(-0.01)).toBe("0.0 mm");
  });

  it("writes scales as the Drawing scale dialog does", () => {
    expect(formatScale(100)).toBe("1:100");
    expect(formatScale(98.7341)).toBe("1:98.73");
  });

  it("cleans a stored format", () => {
    expect(sanitiseFormat({ units: "m", decimals: 3 })).toEqual({ units: "m", decimals: 3, fraction: 16 });
    expect(sanitiseFormat({ units: "yd", decimals: 9 })).toEqual({ units: "auto", decimals: 4, fraction: 16 });
    expect(sanitiseFormat(null)).toEqual({ units: "auto", decimals: 2, fraction: 16 });
  });
});

describe("labels never upside down", () => {
  it("reads rightwards, or upwards when vertical", () => {
    expect(uprightDir([0, 0], [10, 0])).toEqual([1, 0]);
    expect(uprightDir([10, 0], [0, 0])).toEqual([1, 0]);
    // y down: upwards on the page is -y.
    expect(uprightDir([0, 0], [0, 10])).toEqual([0, -1]);
    expect(uprightDir([0, 10], [0, 0])).toEqual([0, -1]);
    for (let a = 0; a < 360; a += 7.5) {
      const r = (a * Math.PI) / 180;
      const d = uprightDir([0, 0], [Math.cos(r), Math.sin(r)]);
      // Never reading leftwards; straight up or down reads up.
      expect(d[0] >= -1e-9).toBe(true);
      if (Math.abs(d[0]) < 1e-9) expect(d[1]).toBeLessThan(0);
    }
  });
});

describe("calibration", () => {
  it("parses a typed distance in mm, cm, m or km", () => {
    expect(parseDistance("4.2 m")).toBe(4200);
    expect(parseDistance("4200")).toBe(4200);
    expect(parseDistance("4200mm")).toBe(4200);
    expect(parseDistance("4,2m")).toBe(4200);
    expect(parseDistance(" 42 CM ")).toBe(420);
    expect(parseDistance("0.5km")).toBe(500000);
    expect(parseDistance(".5 m")).toBe(500);
    expect(parseDistance("")).toBeNull();
    expect(parseDistance("0")).toBeNull();
    expect(parseDistance("-3 m")).toBeNull();
    expect(parseDistance("1:100")).toBeNull();
  });

  it("makes the scale real over paper", () => {
    expect(calibrate(4200, 42)).toBe(100);
    // A detail drawn twice full size.
    expect(calibrate(10, 20)).toBe(0.5);
    expect(calibrate(4200, 0)).toBeNull();
    expect(calibrate(1e9, 1)).toBeNull();
  });
});
