// The drawing gestures (written once each in markupTool.ts) with the plain shapes: a box
// (ellipse), clicking points (polyline, polygon), dragging instead of clicking, and placing at
// a click (with a stand-in kind, as no kind uses it yet).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakes, openViewer } from "./testkit";
import { MarkupTool, type Mods, type Tool } from "./markupTool";
import { MarkupDoc } from "./markupDoc";
import { type Markup, type MarkupOf, defaultStyle, DEFAULT_TEXT, LINE_STYLE } from "../markup/types";
import { KINDS } from "../markup/kinds";
import { defineKind } from "../markup/kinds/kind";
import type { Viewer } from "./viewer";

beforeEach(installFakes);
afterEach(() => {
  vi.useRealTimers();
});

const none: Mods = { shift: false, ctrl: false, alt: false };
const shift: Mods = { ...none, shift: true };

async function setup() {
  const { v } = await openViewer([{ w: 600, h: 400 }]);
  v.setZoom(1);
  v.centreOn(0, 300, 200);
  const doc = new MarkupDoc();
  const t = new MarkupTool(v, {
    styleFor: (k) => defaultStyle(k),
    textStyle: () => DEFAULT_TEXT,
    author: () => "Tester",
    onChange: () => {},
  });
  t.attach(doc);
  return { v, doc, t };
}

const scr = (v: Viewer, x: number, y: number): [number, number] => v.pageToScreen(0, x, y)!;

function drag(t: MarkupTool, v: Viewer, a: [number, number], b: [number, number], mods = none) {
  const [sx, sy] = scr(v, ...a);
  const [ex, ey] = scr(v, ...b);
  t.down(sx, sy, 1, mods);
  for (let k = 1; k <= 4; k++) t.move(sx + ((ex - sx) * k) / 4, sy + ((ey - sy) * k) / 4, mods);
  t.up(ex, ey, mods);
}

function click(t: MarkupTool, v: Viewer, a: [number, number], clicks = 1, mods = none) {
  const [sx, sy] = scr(v, ...a);
  t.down(sx, sy, clicks, mods);
  t.up(sx, sy, mods);
}

const only = <K extends Markup["kind"]>(doc: MarkupDoc, kind: K) => doc.markups.find((m) => m.kind === kind) as MarkupOf<K>;

describe("box gesture", () => {
  it("draws an ellipse by dragging, a circle with Shift, and nothing on a click", async () => {
    const { v, doc, t } = await setup();
    t.setTool("ellipse");
    drag(t, v, [100, 100], [200, 150]);
    const e = only(doc, "ellipse");
    expect(e.rect).toEqual([100, 100, 200, 150].map((x) => expect.closeTo(x, 5)));
    expect(doc.selection.has(e.id)).toBe(true);
    drag(t, v, [300, 100], [360, 120], shift);
    const c = doc.markups[1] as MarkupOf<"ellipse">;
    expect(c.rect[2] - c.rect[0]).toBeCloseTo(c.rect[3] - c.rect[1]);
    click(t, v, [400, 300]);
    expect(doc.markups.length).toBe(2);
  });
});

describe("points gesture", () => {
  it("clicks out a polyline, finishing on a double-click, and needs two points", async () => {
    const { v, doc, t } = await setup();
    t.setTool("polyline");
    click(t, v, [100, 100]);
    click(t, v, [200, 100]);
    expect(t.drawingPoints).toBe(true);
    click(t, v, [200, 200]);
    click(t, v, [200, 200], 2);
    expect(t.drawingPoints).toBe(false);
    expect(only(doc, "polyline").vertices.length).toBe(3);
    // One point and Enter: nothing.
    click(t, v, [300, 300]);
    t.finishPoints(true);
    expect(doc.markups.length).toBe(1);
  });

  it("finishes on Enter, and abandons on Esc", async () => {
    const { v, doc, t } = await setup();
    t.setTool("polyline");
    click(t, v, [100, 100]);
    click(t, v, [200, 120]);
    t.finishPoints(true);
    expect(only(doc, "polyline").vertices.length).toBe(2);
    click(t, v, [100, 300]);
    click(t, v, [200, 300]);
    t.finishPoints(false);
    expect(doc.markups.length).toBe(1);
  });

  it("snaps each clicked point to 15 degrees from the last with Shift", async () => {
    const { v, doc, t } = await setup();
    t.setTool("polyline");
    click(t, v, [100, 100]);
    click(t, v, [200, 104], 1, shift);
    click(t, v, [204, 200], 1, shift);
    t.finishPoints(true);
    const p = only(doc, "polyline");
    expect(p.vertices[1][1]).toBeCloseTo(100);
    expect(p.vertices[2][0]).toBeCloseTo(p.vertices[1][0]);
  });

  it("draws a straight polyline when dragged instead", async () => {
    const { v, doc, t } = await setup();
    t.setTool("polyline");
    drag(t, v, [100, 100], [200, 150]);
    expect(only(doc, "polyline").vertices.length).toBe(2);
    expect(t.drawingPoints).toBe(false);
  });

  it("closes a polygon with a click on its first corner, and needs three", async () => {
    const { v, doc, t } = await setup();
    t.setTool("polygon");
    click(t, v, [100, 100]);
    click(t, v, [200, 100]);
    click(t, v, [200, 200]);
    // Three corners: a click on the first one finishes it.
    click(t, v, [101, 101]);
    expect(t.drawingPoints).toBe(false);
    expect(only(doc, "polygon").vertices.length).toBe(3);
    // Two corners: a click on the first one is just another point (too few to close).
    click(t, v, [300, 100]);
    click(t, v, [350, 100]);
    click(t, v, [301, 101]);
    expect(t.drawingPoints).toBe(true);
    t.finishPoints(false);
  });

  it("draws a rectangular polygon when a box is dragged, and nothing for a sliver", async () => {
    const { v, doc, t } = await setup();
    t.setTool("polygon");
    drag(t, v, [100, 100], [200, 160]);
    expect(only(doc, "polygon").vertices.length).toBe(4);
    drag(t, v, [300, 100], [400, 101]);
    expect(doc.markups.length).toBe(1);
  });

  it("abandons a shape being clicked out when the tool changes", async () => {
    const { v, doc, t } = await setup();
    t.setTool("polygon");
    click(t, v, [100, 100]);
    click(t, v, [200, 100]);
    click(t, v, [200, 200]);
    t.setTool("rect");
    expect(t.drawingPoints).toBe(false);
    expect(doc.markups.length).toBe(0);
  });
});

describe("line gesture", () => {
  it("draws nothing for a drag under 4 px", async () => {
    const { v, doc, t } = await setup();
    t.setTool("arrow");
    drag(t, v, [100, 100], [102, 101]);
    expect(doc.markups.length).toBe(0);
  });
});

describe("place gesture", () => {
  // A stand-in kind: a 20 pt square placed centred on the click, or sized by a drag.
  const dot = defineKind<MarkupOf<"rect">>({
    ...KINDS.rect,
    kind: "rect",
    label: "Dot",
    defaultStyle: () => ({ ...LINE_STYLE }),
    draw: { gesture: "place", make: (at) => ({ rect: [at[0] - 10, at[1] - 10, at[0] + 10, at[1] + 10] }), box: (r) => ({ rect: r }) },
  });
  const reg = KINDS as unknown as Record<string, unknown>;

  it("places at a click, centred on it, or sizes it by a drag", async () => {
    reg.dot = dot;
    try {
      const { v, doc, t } = await setup();
      t.setTool("dot" as Tool);
      click(t, v, [100, 100]);
      expect((doc.markups[0] as MarkupOf<"rect">).rect).toEqual([90, 90, 110, 110].map((x) => expect.closeTo(x, 5)));
      drag(t, v, [200, 200], [260, 240]);
      expect((doc.markups[1] as MarkupOf<"rect">).rect).toEqual([200, 200, 260, 240].map((x) => expect.closeTo(x, 5)));
      // The preview follows the pointer and draws without adding anything.
      const [sx, sy] = scr(v, 300, 300);
      t.move(sx, sy, none);
      expect(doc.markups.length).toBe(2);
    } finally {
      delete reg.dot;
    }
  });
});
