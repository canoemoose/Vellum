// The measuring tools against the stub viewer: two clicks or a drag for a length, clicking out
// a run and an area, three clicks for an angle, Calibrate handing its points over and keeping
// nothing, the live readout while drawing, and navigating mid-measurement.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakes, openViewer } from "./testkit";
import { MarkupTool, type Mods } from "./markupTool";
import { MarkupDoc } from "./markupDoc";
import { type Markup, type MarkupOf, defaultStyle, DEFAULT_TEXT } from "../markup/types";
import { MM_PER_PT, setMeasureSource } from "../markup/measure";
import { drawingLine, isMeasurement, measurementLine, revalue } from "../markup/measurements";
import { handles } from "../markup/geometry";
import type { Viewer } from "./viewer";

const fmt = { units: "auto" as const, decimals: 2 };
beforeEach(() => {
  installFakes();
  setMeasureSource({ page: () => ({ ratio: 100, userUnit: 1 }), format: () => fmt, labelSize: () => 8 });
});
afterEach(() => {
  vi.useRealTimers();
  setMeasureSource({ page: () => ({ ratio: null, userUnit: 1 }), format: () => fmt, labelSize: () => 8 });
});

const none: Mods = { shift: false, ctrl: false, alt: false };
const shift: Mods = { ...none, shift: true };
const pt = (mm: number) => mm / MM_PER_PT;

async function setup() {
  const { v } = await openViewer([{ w: 1200, h: 800 }]);
  v.setZoom(1);
  v.centreOn(0, 600, 400);
  const doc = new MarkupDoc();
  const t = new MarkupTool(v, { styleFor: (k) => defaultStyle(k), textStyle: () => DEFAULT_TEXT, author: () => "Tester", onChange: () => {} });
  t.attach(doc);
  return { v, doc, t };
}

const scr = (v: Viewer, x: number, y: number): [number, number] => v.pageToScreen(0, x, y)!;

function click(t: MarkupTool, v: Viewer, a: [number, number], clicks = 1, mods = none) {
  const [sx, sy] = scr(v, ...a);
  t.down(sx, sy, clicks, mods);
  t.up(sx, sy, mods);
}

function hover(t: MarkupTool, v: Viewer, a: [number, number], mods = none) {
  t.move(...scr(v, ...a), mods);
}

function drag(t: MarkupTool, v: Viewer, a: [number, number], b: [number, number], mods = none) {
  const [sx, sy] = scr(v, ...a);
  const [ex, ey] = scr(v, ...b);
  t.down(sx, sy, 1, mods);
  for (let k = 1; k <= 4; k++) t.move(sx + ((ex - sx) * k) / 4, sy + ((ey - sy) * k) / 4, mods);
  t.up(ex, ey, mods);
}

const last = (doc: MarkupDoc): Markup => doc.markups[doc.markups.length - 1];

describe("measuring tools", () => {
  it("measures a length the CAD way: each end, then where the dimension line goes, at the page's scale", async () => {
    const { v, doc, t } = await setup();
    t.setTool("measureLength");
    click(t, v, [100, 100]);
    expect(t.drawingPoints).toBe(true);
    hover(t, v, [100 + pt(50), 103]);
    // The live readout while the second end is picked, held level.
    const live = t.drawingShape()!;
    expect(drawingLine(live.markup, live.segment)).toBe("5.00 m at 1:100, 50.0 mm on paper");
    click(t, v, [100 + pt(124), 100]);
    expect(t.drawingPoints).toBe(true);
    // The third point: the dimension follows the pointer, pulled off the points.
    hover(t, v, [150, 60]);
    const pulled = t.drawingShape()!.markup as MarkupOf<"measureLength">;
    expect(pulled.offset).toBeCloseTo(40, 6);
    expect(measurementLine(pulled)).toBe("12.40 m at 1:100, 124.0 mm on paper");
    click(t, v, [150, 60]);
    expect(t.drawingPoints).toBe(false);
    const m = last(doc) as MarkupOf<"measureLength">;
    expect(m.kind).toBe("measureLength");
    expect(m.scale).toBe(100);
    expect(m.offset).toBeCloseTo(40, 6);
    expect(measurementLine(m)).toBe("12.40 m at 1:100, 124.0 mm on paper");
    expect(doc.selection.has(m.id)).toBe(true);
  });

  it("leaves a length in line with a third click on its points, or a double-click on the second", async () => {
    const { v, doc, t } = await setup();
    t.setTool("measureLength");
    click(t, v, [100, 100]);
    click(t, v, [300, 100]);
    click(t, v, [301, 102]); // on the second end, within a grip's reach
    expect((last(doc) as MarkupOf<"measureLength">).offset).toBe(0);
    click(t, v, [100, 200]);
    click(t, v, [300, 200]);
    click(t, v, [300, 200], 2);
    expect(doc.markups.length).toBe(2);
    expect((last(doc) as MarkupOf<"measureLength">).offset).toBe(0);
    expect(t.drawingPoints).toBe(false);
  });

  it("measures a length by dragging, in line, held level unless Shift frees it", async () => {
    const { v, doc, t } = await setup();
    t.setTool("measureLength");
    drag(t, v, [100, 100], [100 + pt(100), 103]);
    const m = last(doc) as MarkupOf<"measureLength">;
    expect(m.to[1]).toBeCloseTo(100, 6);
    expect(m.offset).toBe(0);
    expect(measurementLine(m)).toMatch(/^10\.00 m at 1:100/);
    drag(t, v, [100, 300], [100 + pt(100), 303], shift);
    expect((last(doc) as MarkupOf<"measureLength">).to[1]).toBeCloseTo(303, 6);
  });

  it("moves a length's value by its grip, and a double-click on the grip puts it back", async () => {
    const { v, doc, t } = await setup();
    t.setTool("measureLength");
    click(t, v, [100, 100]);
    click(t, v, [300, 100]);
    click(t, v, [200, 100]);
    t.setTool("select");
    const m0 = last(doc) as MarkupOf<"measureLength">;
    t.select([m0.id]);
    const grip = handles(m0).find((h) => h.id === "value")!.at;
    drag(t, v, grip, [grip[0] + 30, grip[1] - 10]);
    const moved = last(doc) as MarkupOf<"measureLength">;
    expect(moved.value![0]).toBeCloseTo(30, 6);
    expect(moved.value![1]).toBeCloseTo(10, 6); // along the line's normal, which is up the page here
    const at = handles(moved).find((h) => h.id === "value")!.at;
    click(t, v, at);
    click(t, v, at, 2);
    const back = last(doc) as MarkupOf<"measureLength">;
    expect(back.value).toBeUndefined();
    expect(handles(back).find((h) => h.id === "value")!.at).toEqual(grip);
  });

  it("takes the scale of the page a measurement is pasted onto (A14: paste goes through revalue)", async () => {
    const { v } = await openViewer([{ w: 1200, h: 800 }, { w: 1200, h: 800 }]);
    v.setZoom(1);
    v.centreOn(0, 600, 400);
    const doc = new MarkupDoc();
    const t = new MarkupTool(v, { styleFor: (k) => defaultStyle(k), textStyle: () => DEFAULT_TEXT, author: () => "Tester", onChange: () => {} });
    t.attach(doc);
    t.setTool("measureLength");
    drag(t, v, [100, 100], [100 + pt(100), 100]);
    expect(measurementLine(last(doc))).toMatch(/^10\.00 m at 1:100/);
    expect(t.copy()).toBe(true);
    v.gotoPage(1);
    expect(t.paste()).toBe(true);
    const pasted = last(doc);
    expect(pasted.page).toBe(1);
    // App.svelte re-values on every markup change; page 2 is at 1:50.
    const pageOf = (p: number) => ({ ratio: p === 1 ? 50 : 100, userUnit: 1 });
    const r = revalue(doc.markups, null, pageOf);
    expect(r.changed).toBe(1);
    expect(measurementLine(r.markups[1])).toMatch(/^5\.00 m at 1:50/);
    expect(measurementLine(r.markups[0])).toMatch(/^10\.00 m at 1:100/);
  });

  it("clicks out a polyline length, with the segment under the pointer while drawing", async () => {
    const { v, doc, t } = await setup();
    t.setTool("measurePath");
    click(t, v, [100, 100]);
    click(t, v, [100 + pt(30), 100]);
    hover(t, v, [100 + pt(30), 100 + pt(40)]);
    const live = t.drawingShape()!;
    expect(drawingLine(live.markup, live.segment)).toBe("7.00 m at 1:100, 70.0 mm on paper; this segment 4.00 m");
    click(t, v, [100 + pt(30), 100 + pt(40)]);
    click(t, v, [100 + pt(30), 100 + pt(40)], 2);
    const m = last(doc) as MarkupOf<"measurePath">;
    expect(m.vertices.length).toBe(3);
    expect(measurementLine(m)).toBe("7.00 m at 1:100, 70.0 mm on paper");
  });

  it("clicks out an area, closing on its first corner", async () => {
    const { v, doc, t } = await setup();
    t.setTool("measureArea");
    const s = pt(100);
    for (const p of [[100, 100], [100 + s, 100], [100 + s, 100 + s], [100, 100 + s]] as [number, number][]) click(t, v, p);
    click(t, v, [100, 100]);
    const m = last(doc) as MarkupOf<"measureArea">;
    expect(m.kind).toBe("measureArea");
    expect(measurementLine(m)).toBe("100.00 m², perimeter 40.00 m at 1:100, 10000.0 mm², perimeter 400.0 mm on paper");
  });

  it("measures an angle corner first: the first arm held level or upright, the second free", async () => {
    const { v, doc, t } = await setup();
    t.setTool("measureAngle");
    click(t, v, [100, 100]); // the corner
    click(t, v, [300, 110]); // the first arm, held level
    expect(t.drawingPoints).toBe(true);
    click(t, v, [200, 200]); // the second arm, free
    expect(t.drawingPoints).toBe(false);
    const m = last(doc) as MarkupOf<"measureAngle">;
    // Kept as before: one arm's end, the corner, the other's.
    const want = [[300, 100], [100, 100], [200, 200]];
    m.vertices.forEach((p, i) => [0, 1].forEach((k) => expect(p[k]).toBeCloseTo(want[i][k], 6)));
    expect(measurementLine(m)).toBe("45.0°");
  });

  it("snaps an angle's second arm to 15 degrees from the corner with Shift", async () => {
    const { v, doc, t } = await setup();
    t.setTool("measureAngle");
    click(t, v, [100, 100]);
    click(t, v, [300, 100]);
    click(t, v, [100 + 100, 100 + 103], 1, shift);
    expect(measurementLine(last(doc))).toBe("45.0°");
  });

  it("drops an angle dragged out as two points, when the app says so", async () => {
    const { v, doc, t } = await setup();
    t.keep = (m) => m.kind !== "measureAngle" || (m as MarkupOf<"measureAngle">).vertices.length === 3;
    t.setTool("measureAngle");
    drag(t, v, [100, 100], [300, 100]);
    expect(doc.markups.length).toBe(0);
    expect(doc.history.canUndo).toBe(false);
  });

  it("hands Calibrate's two points to the app and keeps nothing", async () => {
    const { v, doc, t } = await setup();
    const got: Markup[] = [];
    t.keep = (m) => {
      if (m.kind !== "measureCalibrate") return true;
      got.push(m);
      return false;
    };
    t.setTool("measureCalibrate");
    click(t, v, [100, 100]);
    hover(t, v, [100 + pt(42), 100]);
    expect(drawingLine(t.drawingShape()!.markup, null)).toBe("42.0 mm on paper: click the other end");
    click(t, v, [100 + pt(42), 100]);
    expect(got.length).toBe(1);
    expect(doc.markups.length).toBe(0);
    expect(doc.history.canUndo).toBe(false);
    expect(t.tool).toBe("measureCalibrate");
  });

  it("keeps picking points while the view zooms and pans between clicks", async () => {
    const { v, doc, t } = await setup();
    t.setTool("measurePath");
    click(t, v, [100, 100]);
    v.setZoom(4);
    v.centreOn(0, 100 + pt(30), 100);
    click(t, v, [100 + pt(30), 100]);
    v.setZoom(0.5);
    v.centreOn(0, 600, 400);
    click(t, v, [100 + pt(30), 100 + pt(40)]);
    t.finishPoints(true);
    const m = last(doc) as MarkupOf<"measurePath">;
    expect(isMeasurement(m)).toBe(true);
    expect(m.vertices[1][0]).toBeCloseTo(100 + pt(30), 3);
    expect(measurementLine(m)).toBe("7.00 m at 1:100, 70.0 mm on paper");
  });
});
