// The markup tool on a viewer with a stub renderer: drawing each kind, selecting, moving,
// resizing, the marquee, undo, delete, nudge, copy and paste, text boxes; and the tab's
// MarkupDoc working out a save.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakes, openViewer } from "./testkit";
import { MarkupTool, type Mods } from "./markupTool";
import { MarkupDoc } from "./markupDoc";
import { defaultStyle, DEFAULT_TEXT, type Markup } from "../markup/types";
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
  const changes: number[] = [];
  const t = new MarkupTool(v, {
    styleFor: (k) => defaultStyle(k),
    textStyle: () => DEFAULT_TEXT,
    author: () => "Tester",
    onChange: () => changes.push(1),
  });
  t.attach(doc);
  return { v, doc, t, changes };
}

/** A page point on screen. */
const scr = (v: Viewer, x: number, y: number): [number, number] => v.pageToScreen(0, x, y)!;

/** Press at page a, drag through to page b, release. */
function drag(t: MarkupTool, v: Viewer, a: [number, number], b: [number, number], mods = none) {
  const [sx, sy] = scr(v, ...a);
  const [ex, ey] = scr(v, ...b);
  const took = t.down(sx, sy, 1, mods) || t.marqueeDown(sx, sy, mods);
  for (let k = 1; k <= 4; k++) t.move(sx + ((ex - sx) * k) / 4, sy + ((ey - sy) * k) / 4, mods);
  t.up(ex, ey, mods);
  return took;
}

function click(t: MarkupTool, v: Viewer, a: [number, number], clicks = 1, mods = none) {
  const [sx, sy] = scr(v, ...a);
  const took = t.down(sx, sy, clicks, mods);
  t.up(sx, sy, mods);
  return took;
}

const only = <K extends Markup["kind"]>(doc: MarkupDoc, kind: K) => doc.markups.find((m) => m.kind === kind) as Extract<Markup, { kind: K }>;

describe("drawing", () => {
  it("draws a rectangle by dragging, selects it, and stays in the tool", async () => {
    const { v, doc, t } = await setup();
    t.setTool("rect");
    drag(t, v, [100, 100], [200, 150]);
    const r = only(doc, "rect");
    expect(r.rect[0]).toBeCloseTo(100);
    expect(r.rect[3]).toBeCloseTo(150);
    expect(r.meta.author).toBe("Tester");
    expect(doc.selection.has(r.id)).toBe(true);
    expect(t.tool).toBe("rect");
    // A click without a drag makes nothing.
    click(t, v, [300, 300]);
    expect(doc.markups.length).toBe(1);
    // Shift makes it square.
    drag(t, v, [300, 100], [360, 120], shift);
    const sq = doc.markups[1] as Extract<Markup, { kind: "rect" }>;
    expect(sq.rect[2] - sq.rect[0]).toBeCloseTo(sq.rect[3] - sq.rect[1]);
  });

  it("draws an arrow, snapping to 15 degrees with Shift", async () => {
    const { v, doc, t } = await setup();
    t.setTool("arrow");
    drag(t, v, [100, 100], [200, 104], shift);
    const a = only(doc, "arrow");
    expect(a.to[1]).toBeCloseTo(100);
  });

  it("draws a cloud by clicking points and double-clicking, or by dragging a box", async () => {
    const { v, doc, t } = await setup();
    t.setTool("cloud");
    click(t, v, [100, 100]);
    click(t, v, [200, 100]);
    click(t, v, [200, 200]);
    expect(t.drawingCloud).toBe(true);
    click(t, v, [100, 200]);
    click(t, v, [100, 200], 2);
    const c = only(doc, "cloud");
    expect(c.vertices.length).toBe(4);
    drag(t, v, [300, 100], [400, 160]);
    expect((doc.markups[1] as Extract<Markup, { kind: "cloud" }>).vertices.length).toBe(4);
    // Esc while clicking one out abandons it.
    click(t, v, [10, 10]);
    t.finishCloud(false);
    expect(doc.markups.length).toBe(2);
  });

  it("draws ink and simplifies it", async () => {
    const { v, doc, t } = await setup();
    t.setTool("ink");
    const [sx, sy] = scr(v, 100, 100);
    t.down(sx, sy, 1, none);
    for (let i = 1; i <= 60; i++) t.move(sx + i * 2, sy + (i % 2) * 0.1, none);
    t.up(sx + 120, sy, none);
    const ink = only(doc, "ink");
    expect(ink.strokes[0].length).toBeLessThan(5);
  });

  it("makes a text box on a click, edits it, grows it, and drops it if left empty", async () => {
    const { v, doc, t } = await setup();
    t.setTool("text");
    click(t, v, [100, 100]);
    const box = only(doc, "text");
    expect(box.rect[2] - box.rect[0]).toBeCloseTo(160);
    expect(t.editingMarkup()?.id).toBe(box.id);
    t.setText("A long note that will need more than one line in a box this narrow, surely");
    const grown = only(doc, "text");
    expect(grown.rect[3] - grown.rect[1]).toBeGreaterThan(box.rect[3] - box.rect[1]);
    t.finishText();
    expect(only(doc, "text").text).toContain("A long note");
    // One undo removes the box and its text together.
    t.undo();
    expect(doc.markups.length).toBe(0);
    // A new box left empty disappears.
    click(t, v, [100, 300]);
    t.finishText();
    expect(doc.markups.length).toBe(0);
  });
});

describe("selecting and editing", () => {
  async function withRect() {
    const s = await setup();
    s.t.setTool("rect");
    drag(s.t, s.v, [100, 100], [200, 150]);
    s.t.setTool("select");
    s.t.clearSelection();
    return s;
  }

  it("selects with a click on the outline and moves with a drag, as one undo step", async () => {
    const { v, doc, t } = await withRect();
    expect(click(t, v, [100, 120])).toBe(true);
    expect(t.hasSelection).toBe(true);
    const id = doc.markups[0].id;
    drag(t, v, [100, 120], [130, 140]);
    const moved = only(doc, "rect");
    expect(moved.id).toBe(id);
    expect(moved.rect[0]).toBeCloseTo(130);
    t.undo();
    expect(only(doc, "rect").rect[0]).toBeCloseTo(100);
    t.redo();
    expect(only(doc, "rect").rect[0]).toBeCloseTo(130);
  });

  it("lets a press inside an unfilled rectangle through to the text tool and marquee", async () => {
    const { v, t } = await withRect();
    const [sx, sy] = scr(v, 150, 125);
    expect(t.down(sx, sy, 1, none)).toBe(false);
  });

  it("resizes from a handle", async () => {
    const { v, doc, t } = await withRect();
    click(t, v, [100, 120]);
    drag(t, v, [200, 150], [260, 200]);
    expect(only(doc, "rect").rect).toEqual([100, 100, 260, 200].map((x) => expect.closeTo(x, 5)));
  });

  it("selects with a marquee, deletes, nudges, copies and pastes", async () => {
    const { v, doc, t } = await withRect();
    t.setTool("arrow");
    drag(t, v, [300, 300], [400, 300]);
    t.setTool("select");
    expect(drag(t, v, [50, 50], [450, 350])).toBe(true);
    expect(doc.selection.size).toBe(2);
    expect(t.nudge(10, 0)).toBe(true);
    expect(only(doc, "rect").rect[0]).toBeCloseTo(107.5); // 10 px at 100% is 7.5 pt
    expect(t.copy()).toBe(true);
    expect(t.paste()).toBe(true);
    expect(doc.markups.length).toBe(4);
    expect(new Set(doc.markups.map((m) => m.id)).size).toBe(4);
    expect(t.deleteSelection()).toBe(true);
    expect(doc.markups.length).toBe(2);
  });

  it("restyles the selection", async () => {
    const { v, doc, t } = await withRect();
    click(t, v, [100, 120]);
    t.restyle({ stroke: [0, 0, 1], width: 3 });
    expect(only(doc, "rect").style.stroke).toEqual([0, 0, 1]);
    expect(only(doc, "rect").style.width).toBe(3);
  });

  it("paints without errors, selection and drafts included", async () => {
    const { v, t } = await withRect();
    click(t, v, [100, 120]);
    v.requestFrame();
    await vi.advanceTimersByTimeAsync(32);
    expect(true).toBe(true);
  });
});

describe("MarkupDoc", () => {
  it("is dirty after an edit and works out the changes a save makes", async () => {
    const { v, doc, t } = await setup();
    expect(doc.dirty).toBe(false);
    t.setTool("rect");
    drag(t, v, [100, 100], [200, 150]);
    expect(doc.dirty).toBe(true);
    expect(doc.pagesWithoutFrames()).toEqual([0]);
    doc.frames.set(0, { quarterTurns: 0, bbox: [0, 0, 600, 400] });
    const ch = doc.changes();
    expect(ch.length).toBe(1);
    expect(ch[0].op).toBe("add");
    doc.markSaved();
    expect(doc.dirty).toBe(false);
    expect(doc.savedIds(0)).toEqual([doc.markups[0].id]);
    t.setTool("select");
    click(t, v, [100, 120]);
    t.deleteSelection();
    expect(doc.changes()).toEqual([{ op: "delete", page: 0, nm: doc.saved[0].id }]);
  });
});
