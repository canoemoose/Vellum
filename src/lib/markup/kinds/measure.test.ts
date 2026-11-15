// The measuring kinds: their values and labels, live against their scale, labels upright,
// their annotations (intent, /Measure, /Contents) and re-valuing on a scale change.

import { afterEach, describe, expect, it } from "vitest";
import type { Markup, MarkupKind, MarkupOf, Pt } from "../base";
import { type PathOp, type TextOp, opsFor } from "../ops";
import { toSpec } from "../spec";
import type { Frame } from "../pdf";
import { MM_PER_PT, type PageMeasure, setMeasureSource } from "../measure";
import { MEASURE_BLUE, settleMeasure } from "../dimension";
import { drawingLine, isMeasurement, measurementLine, measurementText, reformat, resizeLabels, revalue } from "../measurements";
import { kindOf } from ".";
import { arcRadius } from "./measureAngle";

const A3: Frame = { quarterTurns: 0, bbox: [0, 0, 1191, 842] };
const meta = { author: "Tester", created: "2026-11-15T10:00:00Z", modified: "2026-11-15T10:00:00Z" };
const fmt = { units: "auto" as const, decimals: 2 };
/** Page points for a paper length in mm. */
const pt = (mm: number) => mm / MM_PER_PT;

function mk<K extends MarkupKind>(kind: K, shape: Record<string, unknown>, scale: number | null = 100, extra: Record<string, unknown> = {}): MarkupOf<K> {
  return { id: `t-${kind}`, page: 0, kind, style: kindOf(kind).defaultStyle(), meta, scale, userUnit: 1, fmt, labelSize: 8, ...shape, ...extra } as unknown as MarkupOf<K>;
}

const texts = (m: Markup) => opsFor(m).filter((o): o is TextOp => o.t === "text");
const label = (m: Markup) => texts(m).flatMap((t) => t.lines);

afterEach(() => setMeasureSource({ page: () => ({ ratio: null, userUnit: 1 }), format: () => fmt, labelSize: () => 8 }));

describe("length", () => {
  // 124 mm on paper at 1:100 is 12.40 m.
  const m = mk("measureLength", { from: [100, 100], to: [100 + pt(124), 100] });

  it("reads both values, and labels the real one", () => {
    expect(measurementText(m)).toEqual({ real: "12.40 m at 1:100", paper: "124.0 mm on paper" });
    expect(measurementLine(m)).toBe("12.40 m at 1:100, 124.0 mm on paper");
    expect(label(m)).toEqual(["12.40 m"]);
  });

  it("shows paper millimetres, marked, with no scale", () => {
    const n = mk("measureLength", { from: [100, 100], to: [100 + pt(124), 100] }, null);
    expect(label(n)).toEqual(["124.0 mm (paper)"]);
    expect(measurementText(n)).toEqual({ real: "No scale set", paper: "124.0 mm on paper" });
    expect(measurementLine(n)).toBe("124.0 mm on paper (no scale set)");
  });

  it("is live: moving an end changes the value", () => {
    const moved = kindOf("measureLength").dragHandle(m, "to", [100 + pt(62), 100], false, 0);
    expect(label(moved)).toEqual(["6.20 m"]);
  });

  it("is drawn as a dimension: a thin blue line with a bar at each end", () => {
    const paths = opsFor(m).filter((o): o is PathOp => o.t === "path");
    expect(paths[0].width).toBe(0.75);
    expect(paths[0].stroke).toEqual(MEASURE_BLUE);
    // The bars: two strokes square to the line.
    const bars = paths[1].segs;
    expect(bars.length).toBe(4);
    expect(bars[0][1]).toBeCloseTo(100);
    expect(bars[1][1]).toBeCloseTo(100);
    expect(texts(m)[0].colour).toEqual(MEASURE_BLUE);
  });

  it("puts its label above the line, reading upright, whichever way it was drawn", () => {
    for (let a = 0; a < 360; a += 15) {
      const r = (a * Math.PI) / 180;
      const from: Pt = [300, 300];
      const to: Pt = [300 + 100 * Math.cos(r), 300 + 100 * Math.sin(r)];
      const t = texts(mk("measureLength", { from, to }))[0];
      expect(t.dir[0], `${a}°`).toBeGreaterThanOrEqual(-1e-9);
      if (Math.abs(t.dir[0]) < 1e-9) expect(t.dir[1]).toBeLessThan(0);
      // "Up" for the text is (dir.y, -dir.x): the label's baseline sits on that side of the line.
      const up: Pt = [t.dir[1], -t.dir[0]];
      const mid: Pt = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      expect((t.origin[0] - mid[0]) * up[0] + (t.origin[1] - mid[1]) * up[1], `${a}°`).toBeGreaterThan(0);
    }
  });

  it("saves as a Line dimension with /Measure and its value", () => {
    const s = toSpec(m, A3);
    expect(s.subtype).toBe("Line");
    expect(s.intent).toBe("LineDimension");
    expect(s.contents).toBe("12.40 m");
    expect(s.caption).toBe(true);
    expect(s.lineEnds).toEqual(["Butt", "Butt"]);
    expect(s.measure!.ratio).toBe("1:100");
    expect(s.measure!.unit).toBe("m");
    expect(s.measure!.precision).toBe(100);
    // Units per user-space unit: so the line's length in user space times it is 12.40.
    expect(pt(124) * s.measure!.factor).toBeCloseTo(12.4, 9);
  });

  it("writes /Measure in paper mm with no scale, and counts /UserUnit", () => {
    const n = mk("measureLength", { from: [0, 0], to: [72, 0] }, null);
    const s = toSpec(n, A3);
    expect(s.measure).toEqual({ ratio: "1:1 (paper)", unit: "mm", factor: MM_PER_PT, precision: 10 });
    const big = mk("measureLength", { from: [0, 0], to: [72, 0] }, 50, { userUnit: 10 });
    // 72 units at /UserUnit 10 is 254 mm on paper, 12.7 m at 1:50.
    expect(measurementText(big)!.paper).toBe("254.0 mm on paper");
    expect(label(big)).toEqual(["12.70 m"]);
    expect(72 * toSpec(big, A3).measure!.factor).toBeCloseTo(12.7, 9);
  });

  it("keeps its values on a rotated page and writes the line in user space", () => {
    const rot: Frame = { quarterTurns: 1, bbox: [0, 0, 842, 1191] };
    const s = toSpec(m, rot);
    expect(s.contents).toBe("12.40 m");
    const [x0, y0, x1, y1] = s.line!;
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(pt(124), 2);
  });
});

describe("polyline length", () => {
  const m = mk("measurePath", { vertices: [[0, 0], [pt(30), 0], [pt(30), pt(40)]] });

  it("adds up its segments and labels the longest", () => {
    expect(measurementText(m)!.real).toBe("7.00 m at 1:100");
    expect(label(m)).toEqual(["7.00 m"]);
    // Along the vertical (longest) segment, reading upwards.
    expect(texts(m)[0].dir).toEqual([0, -1]);
  });

  it("shows the segment under the pointer while drawing", () => {
    expect(drawingLine(m, { from: [pt(30), 0], to: [pt(30), pt(40)] })).toBe("7.00 m at 1:100, 70.0 mm on paper; this segment 4.00 m");
  });

  it("saves as a PolyLine dimension", () => {
    const s = toSpec(m, A3);
    expect([s.subtype, s.intent, s.contents]).toEqual(["PolyLine", "PolyLineDimension", "7.00 m"]);
    expect(s.measure!.unit).toBe("m");
  });
});

describe("area", () => {
  // A 10 m square at 1:100: 100 mm on paper.
  const s = pt(100);
  const m = mk("measureArea", { vertices: [[0, 0], [s, 0], [s, s], [0, s]] });

  it("reads its area and perimeter", () => {
    expect(label(m)).toEqual(["100.00 m²", "Perimeter 40.00 m"]);
    expect(measurementText(m)).toEqual({ real: "100.00 m², perimeter 40.00 m at 1:100", paper: "10000.0 mm², perimeter 400.0 mm on paper" });
  });

  it("centres its label in the shape", () => {
    const t = texts(m)[0];
    const c = t.clip!;
    expect((c[0][0] + c[2][0]) / 2).toBeCloseTo(s / 2, 6);
    expect((c[0][1] + c[2][1]) / 2).toBeCloseTo(s / 2, 0);
  });

  it("says when its outline crosses itself", () => {
    const bow = mk("measureArea", { vertices: [[0, 0], [s, s], [s, 0], [0, s]] });
    expect(label(bow)).toContain("Outline crosses itself");
    expect(measurementText(bow)!.real).toContain("crosses itself");
  });

  it("saves as a Polygon dimension in square metres", () => {
    const sp = toSpec(m, A3);
    expect([sp.subtype, sp.intent]).toEqual(["Polygon", "PolygonDimension"]);
    expect(sp.contents).toBe("100.00 m², Perimeter 40.00 m");
    expect(sp.measure!.unit).toBe("m");
    expect(s * sp.measure!.factor).toBeCloseTo(10, 9);
  });

  it("takes a fill, and is picked inside only when filled", () => {
    expect(kindOf("measureArea").controls.fill).toBe(true);
    expect(kindOf("measureArea").hits(m, [s / 2, s / 2], 1)).toBe(false);
    expect(kindOf("measureArea").hits({ ...m, style: { ...m.style, fill: [1, 1, 1] } }, [s / 2, s / 2], 1)).toBe(true);
  });
});

describe("angle", () => {
  it("measures at the corner, the same at any scale", () => {
    const m = mk("measureAngle", { vertices: [[200, 100], [100, 100], [100, 0]] });
    expect(label(m)).toEqual(["90.0°"]);
    expect(measurementText(m)).toEqual({ real: "90.0°", paper: null });
    expect(measurementText({ ...m, scale: 20 })).toEqual({ real: "90.0°", paper: null });
  });

  it("draws its arc inside the angle and its label beyond it", () => {
    const m = mk("measureAngle", { vertices: [[200, 100], [100, 100], [100, 0]] });
    const ops = opsFor(m);
    const arc = (ops[1] as PathOp).segs;
    expect(arc[0][0]).toBe("M");
    // The label is out along the bisector (up and right of the corner, y down).
    const c = (ops[2] as TextOp).clip!;
    const cx = (c[0][0] + c[2][0]) / 2, cy = (c[0][1] + c[2][1]) / 2;
    expect(cx).toBeGreaterThan(100 + arcRadius([200, 100], [100, 100], [100, 0]) * 0.7);
    expect(cy).toBeLessThan(100);
  });

  it("saves as a plain PolyLine with the value in /Contents", () => {
    const s = toSpec(mk("measureAngle", { vertices: [[200, 100], [100, 100], [100, 0]] }), A3);
    expect([s.subtype, s.intent, s.measure, s.contents]).toEqual(["PolyLine", undefined, undefined, "Angle 90.0°"]);
  });
});

describe("the scale it's valued at", () => {
  it("takes its page's scale while drawn, and keeps it once made", () => {
    const pages: Record<number, PageMeasure> = { 0: { ratio: 100, userUnit: 1 }, 1: { ratio: 50, userUnit: 1 } };
    setMeasureSource({ page: (p) => pages[p], format: () => fmt, labelSize: () => 8 });
    const draft = { ...mk("measureLength", { from: [0, 0], to: [pt(100), 0] }), page: 1, scale: undefined, userUnit: undefined };
    expect(label(draft)).toEqual(["5.00 m"]);
    const made = settleMeasure(draft);
    expect(made.scale).toBe(50);
    pages[1] = { ratio: 200, userUnit: 1 };
    // Made: keeps its own until the app re-values it.
    expect(label(made)).toEqual(["5.00 m"]);
  });

  it("re-values the measurements on changed pages, and counts them", () => {
    const a = mk("measureLength", { from: [0, 0], to: [pt(100), 0] });
    const b = { ...mk("measureArea", { vertices: [[0, 0], [10, 0], [10, 10]] }), id: "b", page: 1 };
    const g = mk("measureAngle", { vertices: [[1, 0], [0, 0], [0, 1]] });
    const other = { ...mk("measureLength", { from: [0, 0], to: [1, 0] }), kind: "arrow" } as unknown as Markup;
    const r = revalue([a, b, g, other], new Set([0]), () => ({ ratio: 50, userUnit: 1 }));
    expect(r.changed).toBe(1);
    expect(label(r.markups[0])).toEqual(["5.00 m"]);
    expect(r.markups[1]).toBe(b);
    expect(r.markups[3]).toBe(other);
    // Nothing to change: the same list, so no undo step.
    const again = revalue(r.markups, null, (p) => ({ ratio: p === 0 ? 50 : 100, userUnit: 1 }));
    expect(again.changed).toBe(0);
    expect(again.markups).toBe(r.markups);
    // Cleared: back to paper.
    expect(label(revalue([a], null, () => ({ ratio: null, userUnit: 1 })).markups[0])).toEqual(["100.0 mm (paper)"]);
  });

  it("re-formats and resizes labels", () => {
    const a = mk("measureLength", { from: [0, 0], to: [pt(100), 0] });
    const r = reformat([a], { units: "mm", decimals: 2 });
    expect(r.changed).toBe(1);
    expect(label(r.markups[0])).toEqual(["10000 mm"]);
    const big = resizeLabels([a], new Set([a.id]), 14)[0];
    expect(texts(big)[0].size).toBe(14);
  });

  it("knows a measurement from other markups, Calibrate included", () => {
    expect(isMeasurement(mk("measureLength", {}))).toBe(true);
    expect(isMeasurement(mk("measureCalibrate", {}))).toBe(false);
    expect(measurementText(mk("measureCalibrate", {}))).toBeNull();
    expect(drawingLine(mk("measureCalibrate", { from: [0, 0], to: [pt(42), 0] }), null)).toBe("42.0 mm on paper: click the other end");
  });
});
