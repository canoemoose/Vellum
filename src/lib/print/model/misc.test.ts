// Geometry helpers, page ranges and settings.

import { describe, expect, it } from "vitest";
import {
  areaOf, box, describeSize, effectiveRatio, factorForRatio, fmtMm, fmtPercent, fmtRatio, intersect, isoName, isoSize,
  mmToPt, orient, ptToMm, quarter, rotatedSize,
} from "./geom";
import { boxLines, formatDate, stampText, stampedArea } from "./job";
import { parseRange } from "./pages";
import {
  DEFAULT_SETTINGS, PRESET_KEYS, applyPreset, nearestStandardRatio, nextStandardRatio, parseRatio, presetFrom, sanitise,
  sanitisePresets,
} from "./settings";

describe("geometry", () => {
  it("converts units", () => {
    expect(mmToPt(25.4)).toBeCloseTo(72);
    expect(ptToMm(72)).toBeCloseTo(25.4);
  });

  it("normalises boxes, rotations and orientation", () => {
    expect(box(10, 20, 0, 5)).toEqual({ x0: 0, y0: 5, x1: 10, y1: 20 });
    expect(quarter(-90)).toBe(270);
    expect(quarter(44)).toBe(0);
    expect(quarter(46)).toBe(90);
    expect(rotatedSize({ w: 1, h: 2 }, 90)).toEqual({ w: 2, h: 1 });
    expect(orient({ w: 1, h: 2 }, true)).toEqual({ w: 2, h: 1 });
    expect(orient({ w: 2, h: 1 }, false)).toEqual({ w: 1, h: 2 });
    expect(intersect(box(0, 0, 10, 10), box(5, 5, 20, 20))).toEqual(box(5, 5, 10, 10));
    expect(intersect(box(0, 0, 10, 10), box(10, 0, 20, 10))).toBeNull();
    expect(areaOf({ w: 100, h: 50 }, { left: 1, top: 2, right: 3, bottom: 4 })).toEqual({ x0: 1, y0: 2, x1: 97, y1: 46 });
  });

  it("names paper sizes", () => {
    expect(isoName({ w: mmToPt(841), h: mmToPt(594) })).toBe("A1");
    expect(isoName({ w: 612, h: 792 })).toBe("Letter");
    expect(isoName({ w: 500, h: 500 })).toBeNull();
    expect(isoSize("a3")).toEqual({ w: mmToPt(297), h: mmToPt(420) });
    expect(isoSize("Z9")).toBeNull();
    expect(describeSize({ w: mmToPt(420), h: mmToPt(297) })).toBe("A3 landscape");
    expect(describeSize({ w: mmToPt(100), h: mmToPt(55.55) })).toBe("100 × 55.6 mm");
    expect(fmtMm(mmToPt(12))).toBe("12");
  });

  it("formats scales", () => {
    expect(effectiveRatio(100, 0.5)).toBe(200);
    expect(factorForRatio(100, 200)).toBe(0.5);
    expect(fmtRatio(205.8)).toBe("1:206");
    expect(fmtRatio(12.46)).toBe("1:12.5");
    expect(fmtRatio(1)).toBe("1:1");
    expect(fmtRatio(0)).toBe("1:?");
    expect(fmtPercent(0.4821)).toBe("48%");
    expect(fmtPercent(0.0456)).toBe("4.6%");
  });

  it("standard scales", () => {
    expect(nextStandardRatio(206)).toBe(250);
    expect(nextStandardRatio(200)).toBe(200);
    expect(nextStandardRatio(1e6)).toBeNull();
    expect(nearestStandardRatio(206)).toBe(200);
    expect(nearestStandardRatio(230)).toBe(250);
    expect(parseRatio("1:200")).toBe(200);
    expect(parseRatio(" 1 / 12.5 ")).toBe(12.5);
    expect(parseRatio("50")).toBe(50);
    expect(parseRatio("1:0")).toBeNull();
    expect(parseRatio("abc")).toBeNull();
  });
});

describe("job helpers", () => {
  it("borders, stamp and date", () => {
    expect(boxLines(box(0, 0, 10, 20))).toHaveLength(4);
    const a = box(10, 10, 200, 300);
    expect(stampedArea(a, true).y1).toBe(290);
    expect(stampedArea(a, false)).toBe(a);
    const t = stampText("x", a);
    expect(t.y).toBeGreaterThan(290);
    expect(t.y).toBeLessThan(300);
    expect(formatDate(new Date(2026, 10, 8, 9, 5))).toBe("08/11/2026 09:05");
  });
});

describe("page ranges", () => {
  it("parses lists and ranges", () => {
    expect(parseRange("1-3, 7", 10)).toEqual({ ok: true, pages: [0, 1, 2, 6] });
    expect(parseRange("5-3", 10)).toEqual({ ok: true, pages: [4, 3, 2] });
    expect(parseRange("8-", 10)).toEqual({ ok: true, pages: [7, 8, 9] });
    expect(parseRange("-2", 10)).toEqual({ ok: true, pages: [0, 1] });
    expect(parseRange("2–4;2", 10)).toEqual({ ok: true, pages: [1, 2, 3, 1] });
  });

  it("takes an empty range as every page", () => {
    expect(parseRange("", 3)).toEqual({ ok: true, pages: [0, 1, 2] });
    expect(parseRange(" , ", 2)).toEqual({ ok: true, pages: [0, 1] });
  });

  it("explains what's wrong, in one message for anything unreadable", () => {
    expect(parseRange("0", 10)).toEqual({ ok: false, error: "Pages run from 1 to 10." });
    expect(parseRange("3-11", 10)).toEqual({ ok: false, error: "Pages run from 1 to 10." });
    expect(parseRange("a", 10)).toEqual({ ok: false, error: "Use page numbers and ranges, such as 1-3, 7." });
    expect(parseRange("-", 10)).toEqual({ ok: false, error: "Use page numbers and ranges, such as 1-3, 7." });
  });
});

describe("settings and presets", () => {
  it("sanitises junk to defaults and clamps numbers", () => {
    expect(sanitise(null)).toEqual(DEFAULT_SETTINGS);
    const s = sanitise({ sizing: "bogus", copies: 5000, nUp: 3, tileOverlapMm: -5, colour: "blackLines", printer: "HP" });
    expect(s.sizing).toBe("fit");
    expect(s.copies).toBe(999);
    expect(s.nUp).toBe(1);
    expect(s.tileOverlapMm).toBe(0);
    expect(s.colour).toBe("blackLines");
    expect(s.printer).toBe("HP");
  });

  it("presets keep everything but the pages, range and copies", () => {
    const s = { ...DEFAULT_SETTINGS, colour: "blackLines" as const, stamp: true, copies: 3, range: "1-2", pagesMode: "range" as const };
    const p = presetFrom("A3 site set", s);
    expect(Object.keys(p.settings).sort()).toEqual([...PRESET_KEYS].sort());
    expect("copies" in p.settings).toBe(false);
    const applied = applyPreset({ ...DEFAULT_SETTINGS, copies: 2, range: "5", pagesMode: "current" }, p);
    expect(applied).toMatchObject({ colour: "blackLines", stamp: true, copies: 2, range: "5", pagesMode: "current" });
  });

  it("sanitises stored preset lists", () => {
    expect(sanitisePresets("x")).toEqual([]);
    const list = sanitisePresets([{ name: "A", settings: { sizing: "tile" } }, { nope: 1 }, null]);
    expect(list).toHaveLength(1);
    expect(list[0].settings.sizing).toBe("tile");
  });
});
