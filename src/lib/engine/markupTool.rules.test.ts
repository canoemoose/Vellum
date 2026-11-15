// The consistency rules (docs/editing-tool-consistency-brief.md), tested against the gestures
// rather than the kinds: every tool is found by the gesture it draws with, so a new kind can't
// opt out. Rule 1 (one gesture, one behaviour), rule 2 (Shift toggles the lock), rule 3 (typing
// tools end the same way), rule 4 (tooltips from the gesture).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakes, openViewer } from "./testkit";
import { MarkupTool, type Mods, lockTo } from "./markupTool";
import { MarkupDoc } from "./markupDoc";
import { type Markup, type MarkupOf, defaultStyle, DEFAULT_TEXT } from "../markup/types";
import { kindOf } from "../markup/kinds";
import type { KindDef } from "../markup/kinds/kind";
import { type ToolDef, TOOLS, gestureTip, toolHowTo } from "../markup/tools";
import { shapeBounds } from "../markup/geometry";
import type { Viewer } from "./viewer";

beforeEach(installFakes);
afterEach(() => {
  vi.useRealTimers();
});

const none: Mods = { shift: false, ctrl: false, alt: false };
const shift: Mods = { ...none, shift: true };

async function setup(style?: (k: Markup["kind"]) => Markup["style"]) {
  const { v } = await openViewer([{ w: 600, h: 400 }]);
  v.setZoom(1);
  v.centreOn(0, 300, 200);
  const doc = new MarkupDoc();
  const t = new MarkupTool(v, {
    styleFor: (k) => style?.(k) ?? defaultStyle(k),
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
  const took = t.down(sx, sy, clicks, mods);
  t.up(sx, sy, mods);
  return took;
}

const def = (t: ToolDef) => kindOf(t.kind!) as unknown as KindDef;
/** The drawing tools that draw with a gesture (stamps need something picked first). */
const drawing = TOOLS.filter((t) => t.kind && t.group !== "stamp");
const withGesture = (pred: (d: KindDef["draw"]) => boolean) => drawing.filter((t) => pred(def(t).draw));

describe("rule 1: one gesture, one behaviour", () => {
  const twoPoint = withGesture((d) => d.gesture === "points" && d.max === 2);
  it("covers Line and Arrow as well as Length", () => {
    expect(twoPoint.map((t) => t.id)).toEqual(expect.arrayContaining(["arrow", "line", "measureLength"]));
  });

  for (const tool of twoPoint) {
    it(`${tool.label}: clicks out from end to end, or drags`, async () => {
      const { v, doc, t } = await setup();
      t.setTool(tool.id);
      click(t, v, [100, 100]);
      expect(t.drawingPoints).toBe(true);
      click(t, v, [200, 160]);
      expect(t.drawingPoints).toBe(false);
      expect(doc.markups.length).toBe(1);
      drag(t, v, [100, 300], [220, 330]);
      expect(doc.markups.length).toBe(2);
    });
  }

  const boxes = withGesture((d) => d.gesture === "box" || (d.gesture === "points" && d.drag === "box"));
  for (const tool of boxes) {
    it(`${tool.label}: a dragged box under 4 px either way makes nothing`, async () => {
      const { v, doc, t } = await setup();
      t.setTool(tool.id);
      drag(t, v, [100, 100], [220, 102]);
      t.finishPoints(false); // a click-out tool takes a too-small drag as a click
      t.finishText();
      const d = def(tool).draw;
      // A kind that makes one at a click (the text box) makes that one; nothing else does.
      expect(doc.markups.length).toBe(d.gesture === "box" && d.click ? 1 : 0);
    });

    it(`${tool.label}: Shift squares a dragged box`, async () => {
      const { v, doc, t } = await setup();
      t.setTool(tool.id);
      drag(t, v, [100, 100], [220, 140], shift);
      t.finishText();
      const b = shapeBounds(doc.markups[0]);
      // A text box grows to fit its text, so only its width is the drag's.
      if (def(tool).typed) expect(b[2] - b[0]).toBeCloseTo(120, 0);
      else expect(b[2] - b[0]).toBeCloseTo(b[3] - b[1], 3);
    });
  }

  const clickOut = withGesture((d) => d.gesture === "points" && !d.max);
  for (const tool of clickOut) {
    it(`${tool.label}: Backspace takes back the last point, and the last one abandons the shape`, async () => {
      const { v, doc, t } = await setup();
      t.setTool(tool.id);
      click(t, v, [100, 100]);
      click(t, v, [200, 100]);
      click(t, v, [200, 200]);
      click(t, v, [100, 250]);
      expect(t.removeLastPoint()).toBe(true);
      t.finishPoints(true);
      const m = doc.markups[0] as MarkupOf<"polyline">;
      expect(m.vertices.length).toBe(3);
      click(t, v, [300, 300]);
      t.removeLastPoint();
      expect(t.drawingPoints).toBe(false);
      expect(t.removeLastPoint()).toBe(false);
    });

    it(`${tool.label}: can be finished only once it has enough points`, async () => {
      const { v, t } = await setup();
      t.setTool(tool.id);
      click(t, v, [100, 100]);
      expect(t.canFinishPoints).toBe(false);
      click(t, v, [200, 100]);
      click(t, v, [200, 200]);
      expect(t.canFinishPoints).toBe(true);
    });
  }
});

describe("rule 2: Shift toggles the lock", () => {
  it("snaps to 15 degrees with Shift, unless the kind starts ortho-locked, when Shift frees it", () => {
    const free = { gesture: "points", closed: false, min: 2, drag: "line", make: () => ({}) } as unknown as KindDef["draw"];
    const ortho = { ...free, lock: "ortho" } as unknown as KindDef["draw"];
    expect(lockTo(free, [0, 0], [100, 4], false)).toEqual([100, 4]);
    expect(lockTo(free, [0, 0], [100, 4], true)[1]).toBeCloseTo(0);
    expect(lockTo(ortho, [0, 0], [100, 30], false)).toEqual([100, 0]);
    expect(lockTo(ortho, [0, 0], [10, 30], false)).toEqual([0, 30]);
    expect(lockTo(ortho, [0, 0], [100, 30], true)).toEqual([100, 30]);
  });

  for (const tool of withGesture((d) => d.gesture === "freehand")) {
    it(`${tool.label}: Shift draws a straight line`, async () => {
      const { v, doc, t } = await setup();
      t.setTool(tool.id);
      const [sx, sy] = scr(v, 100, 100);
      t.down(sx, sy, 1, shift);
      for (const [x, y] of [[130, 140], [160, 90], [200, 120]]) t.move(...scr(v, x, y), shift);
      t.up(...scr(v, 200, 120), shift);
      const m = doc.markups[0] as MarkupOf<"ink">;
      expect(m.strokes[0].length).toBe(2);
    });
  }
});

describe("rule 3: typing tools end the same way", () => {
  it("a click away from a text box being typed ends the typing and makes nothing", async () => {
    const { v, doc, t } = await setup();
    t.setTool("text");
    drag(t, v, [100, 100], [250, 140]);
    t.setText("Hello");
    expect(t.editing).not.toBeNull();
    expect(click(t, v, [400, 300])).toBe(true);
    expect(t.editing).toBeNull();
    expect(doc.markups.length).toBe(1);
    // In Select too: the click doesn't go on to select or move anything.
    t.setTool("select");
    click(t, v, [120, 110], 2);
    expect(t.editing).not.toBeNull();
    doc.selection.clear();
    click(t, v, [120, 110]);
    expect(t.editing).toBeNull();
    expect(doc.selection.size).toBe(0);
  });

  it("a click away from typing elsewhere (a note's editor) ends it and places nothing", async () => {
    const { v, doc, t } = await setup();
    t.setTool("note");
    click(t, v, [100, 100]);
    expect(doc.markups.length).toBe(1);
    const ended = vi.fn();
    t.typingElsewhere = ended;
    expect(click(t, v, [300, 300])).toBe(true);
    expect(ended).toHaveBeenCalledOnce();
    expect(t.typingElsewhere).toBeNull();
    expect(doc.markups.length).toBe(1);
  });

  it("keeps an empty callout, and an empty text box only if something shows it", async () => {
    const plain = (k: Markup["kind"]) => (k === "text" ? { ...defaultStyle(k), width: 0, fill: null } : defaultStyle(k));
    {
      const { v, doc, t } = await setup();
      t.setTool("text");
      drag(t, v, [100, 100], [250, 140]);
      t.finishText();
      expect(doc.markups.length).toBe(1); // a border and a background
      t.setTool("callout");
      click(t, v, [300, 300]);
      click(t, v, [400, 250]);
      click(t, v, [400, 250], 2);
      t.finishText();
      expect(doc.markups.filter((m) => m.kind === "callout").length).toBe(1);
    }
    {
      const { v, doc, t } = await setup(plain);
      t.setTool("text");
      drag(t, v, [100, 100], [250, 140]);
      t.finishText();
      expect(doc.markups.length).toBe(0); // nothing would show it's there
    }
  });

  it("every kind typed into after drawing says what becomes of an empty one", () => {
    for (const tool of drawing) if (def(tool).typesAfter) expect(def(tool).keepEmpty, tool.id).toBeTypeOf("function");
  });
});

describe("rule 4: tooltips from the gesture", () => {
  it("no drawing tool writes its own how-to", () => {
    for (const t of TOOLS) if (t.kind) expect(t.tip, t.id).toBeUndefined();
  });

  it("tools that share a gesture read the same", () => {
    // A gesture's identity: its name and options (not the functions that make the geometry).
    const identity = (d: KindDef) => JSON.stringify([d.draw, !!d.typesAfter], (_k, v) => (typeof v === "function" ? true : v));
    const byGesture = new Map<string, Set<string>>();
    for (const t of TOOLS.filter((x) => x.kind)) {
      const id = identity(def(t));
      byGesture.set(id, (byGesture.get(id) ?? new Set()).add(gestureTip(def(t))));
    }
    for (const tips of byGesture.values()) expect(tips.size).toBe(1);
    // Each tool's tooltip is its gesture's, with only what it picks first or adds after.
    for (const t of TOOLS.filter((x) => x.kind)) expect(toolHowTo(t)).toContain(gestureTip(def(t)));
    expect(toolHowTo(TOOLS.find((t) => t.id === "line")!)).toBe(toolHowTo(TOOLS.find((t) => t.id === "arrow")!));
  });
});
