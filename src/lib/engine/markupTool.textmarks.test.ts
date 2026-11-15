// Phase 7a's gestures against the stub viewer: the highlighter (Shift for a straight stroke),
// the callout (tip first, then the box), notes placed at a click, and text markups added from
// outside a gesture.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StubRenderer, doc as stubDoc, installFakes, openViewer, stubCanvas } from "./testkit";
import { Viewer } from "./viewer";
import { TextTool, selectionEnd, selectionLines } from "./textTool";
import type { TextLayer } from "../text/layer";
import { textMarkStyle, textMarksFrom } from "../markup/kinds/textmark";
import { MarkupTool, type Mods } from "./markupTool";
import { MarkupDoc } from "./markupDoc";
import { type Markup, type MarkupOf, defaultStyle, DEFAULT_TEXT } from "../markup/types";

beforeEach(installFakes);
afterEach(() => {
  vi.useRealTimers();
});

const none: Mods = { shift: false, ctrl: false, alt: false };
const shift: Mods = { ...none, shift: true };

export async function setup() {
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

function drag(t: MarkupTool, v: Viewer, pts: [number, number][], mods = none) {
  const s = pts.map((p) => scr(v, ...p));
  t.down(s[0][0], s[0][1], 1, mods);
  for (let i = 1; i < s.length; i++) for (let k = 1; k <= 4; k++) t.move(s[i - 1][0] + ((s[i][0] - s[i - 1][0]) * k) / 4, s[i - 1][1] + ((s[i][1] - s[i - 1][1]) * k) / 4, mods);
  const e = s[s.length - 1];
  t.up(e[0], e[1], mods);
}

function click(t: MarkupTool, v: Viewer, a: [number, number], clicks = 1, mods = none) {
  const [sx, sy] = scr(v, ...a);
  t.down(sx, sy, clicks, mods);
  t.up(sx, sy, mods);
}

const only = <K extends Markup["kind"]>(doc: MarkupDoc, kind: K) => doc.markups.find((m) => m.kind === kind) as MarkupOf<K>;

describe("highlighter", () => {
  it("draws freehand, and straight from the press with Shift", async () => {
    const { v, doc, t } = await setup();
    t.setTool("highlighter");
    drag(t, v, [[100, 100], [150, 140], [200, 100]]);
    const free = only(doc, "highlighter");
    expect(free.strokes[0].length).toBeGreaterThan(2);
    expect(free.style.width).toBe(12);

    drag(t, v, [[100, 200], [150, 240], [300, 200]], shift);
    const straight = doc.markups[1] as MarkupOf<"highlighter">;
    expect(straight.strokes[0]).toHaveLength(2);
    expect(straight.strokes[0][0][0]).toBeCloseTo(100, 0);
    expect(straight.strokes[0][1][0]).toBeCloseTo(300, 0);
    expect(straight.strokes[0][1][1]).toBeCloseTo(200, 0);
  });
});

describe("callout", () => {
  it("drags from the tip to where the box goes, then types", async () => {
    const { v, doc, t } = await setup();
    t.setTool("callout");
    drag(t, v, [[100, 100], [200, 150]]);
    const m = only(doc, "callout");
    expect(m.tip[0]).toBeCloseTo(100, 0);
    expect(m.elbow).toBeNull();
    // The box starts at the release point, on the far side from the tip.
    expect(m.rect[0]).toBeCloseTo(200, 0);
    expect((m.rect[1] + m.rect[3]) / 2).toBeCloseTo(150, 0);
    expect(t.editingMarkup()?.id).toBe(m.id);
    t.setText("Loose bolt");
    t.finishText();
    expect(only(doc, "callout").text).toBe("Loose bolt");
    expect(doc.history.canUndo).toBe(true);
  });

  it("clicks the tip, an elbow and the box; or the tip and a double-click for the box", async () => {
    const { v, doc, t } = await setup();
    t.setTool("callout");
    click(t, v, [100, 100]);
    click(t, v, [140, 60]);
    click(t, v, [180, 60]);
    const m = only(doc, "callout");
    expect(m.elbow![0]).toBeCloseTo(140, 0);
    expect(m.rect[0]).toBeCloseTo(180, 0);
    expect(t.editingMarkup()?.id).toBe(m.id);
    t.setText("A");
    t.finishText();

    click(t, v, [300, 300]);
    click(t, v, [250, 250]);
    click(t, v, [250, 250], 2);
    const second = doc.markups[1] as MarkupOf<"callout">;
    expect(second.elbow).toBeNull();
    // Left of the tip: the box sits to the left of the point.
    expect(second.rect[2]).toBeCloseTo(250, 0);
  });

  it("stays if nothing is typed, to be filled in later", async () => {
    const { v, doc, t } = await setup();
    t.setTool("callout");
    drag(t, v, [[100, 100], [200, 150]]);
    t.finishText();
    expect(doc.markups).toHaveLength(1);
  });

  it("keeps its tip when the box is dragged", async () => {
    const { v, doc, t } = await setup();
    t.setTool("callout");
    drag(t, v, [[100, 100], [200, 150]]);
    t.setText("Here");
    t.finishText();
    t.setTool("select");
    const m = only(doc, "callout");
    drag(t, v, [[m.rect[0] + 20, (m.rect[1] + m.rect[3]) / 2], [m.rect[0] + 60, (m.rect[1] + m.rect[3]) / 2 + 30]]);
    const moved = only(doc, "callout");
    expect(moved.tip).toEqual(m.tip);
    expect(moved.rect[0]).toBeCloseTo(m.rect[0] + 40, 0);
  });
});

describe("text markups from a selection", () => {
  /** One line of text per page at (100, 100), 6 x 10 pt per character. */
  function lineLayer(text: string): TextLayer {
    const n = text.length;
    const boxes = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) boxes.set([100 + 6 * i, 100, 106 + 6 * i, 110], i * 4);
    return { n, codes: Uint32Array.from([...text].map((c) => c.codePointAt(0)!)), boxes, flags: new Uint8Array(n).fill(2), links: [] };
  }
  class TextRenderer extends StubRenderer {
    constructor(private pages: string[]) {
      super(stubDoc(pages.map(() => ({ w: 600, h: 400 }))));
      this.auto = true;
    }
    async textLayer(_docId: number, page: number): Promise<TextLayer> {
      return lineLayer(this.pages[page]);
    }
  }
  async function withText(pages: string[]) {
    const r = new TextRenderer(pages);
    const v = new Viewer(stubCanvas(), {}, r);
    v.resize(800, 600, 1);
    await v.open("C:/x/doc.pdf", undefined, r);
    v.setZoom(1);
    v.centreOn(0, 150, 105);
    const tt = new TextTool(v, { openUrl: () => {} });
    const doc = new MarkupDoc();
    const t = new MarkupTool(v, { styleFor: (k) => defaultStyle(k), textStyle: () => DEFAULT_TEXT, author: () => "Tester", onChange: () => {} });
    t.attach(doc);
    return { v, tt, t, doc };
  }

  it("makes one markup per page from the selection's lines, with its text", async () => {
    const { tt, t, doc } = await withText(["Stage left rigging", "Truss and motors"]);
    tt.selection = { anchor: { page: 0, index: 6 }, focus: { page: 1, index: 5 } };
    const lines = await selectionLines(tt);
    expect(lines.map((l) => l.page)).toEqual([0, 1]);
    expect(lines[0].text).toBe("left rigging");
    expect(lines[0].quads[0][0]).toEqual([136, 100]);
    expect(lines[1].text).toBe("Truss");
    t.addMarkups(textMarksFrom(lines, "underline", textMarkStyle("underline"), "Tester"));
    expect(doc.markups.map((m) => [m.kind, m.page])).toEqual([["textmark", 0], ["textmark", 1]]);
    expect(t.selected()).toHaveLength(2);
    // One undo step for the lot.
    t.undo();
    expect(doc.markups).toHaveLength(0);
    // Where the bar goes: the end of the last line.
    tt.selection = { anchor: { page: 0, index: 0 }, focus: { page: 0, index: 5 } };
    expect((await selectionEnd(tt))?.quad[3]).toEqual([130, 110]);
  });

  it("selects a text markup on a press and leaves the press to text selection; it never moves", async () => {
    const { v, tt, t, doc } = await withText(["Stage left rigging"]);
    tt.selection = { anchor: { page: 0, index: 0 }, focus: { page: 0, index: 5 } };
    t.addMarkups(textMarksFrom(await selectionLines(tt), "highlight", textMarkStyle("highlight"), "Tester"));
    t.clearSelection();
    const m = doc.markups[0];
    const [sx, sy] = v.pageToScreen(0, 110, 105)!;
    expect(t.down(sx, sy, 1, none)).toBe(false);
    expect(t.selected().map((x) => x.id)).toEqual([m.id]);
    t.move(sx + 20, sy, none);
    t.up(sx + 20, sy, none);
    expect(doc.markups[0]).toBe(m);
    // Over it, the markup tool leaves the cursor to the text tool.
    t.move(sx, sy, none);
    expect(t.cursor()).toBeNull();
    // Nudging and Delete: it stays put, and goes.
    t.nudge(10, 0);
    expect((doc.markups[0] as MarkupOf<"textmark">).quads).toEqual((m as MarkupOf<"textmark">).quads);
    t.deleteSelection();
    expect(doc.markups).toHaveLength(0);
  });
});

describe("note", () => {
  it("places a note centred on a click, selected, and keeps it when empty", async () => {
    const { v, doc, t } = await setup();
    t.setTool("note");
    click(t, v, [200, 150]);
    const m = only(doc, "note");
    expect(m.at[0]).toBeCloseTo(190, 0);
    expect(m.at[1]).toBeCloseTo(140, 0);
    expect(m.text).toBe("");
    expect(t.selected().map((x) => x.id)).toEqual([m.id]);
    // Its wording, set by the note editor, is one undo step.
    t.updateMarkup({ ...m, text: "Check" });
    expect(only(doc, "note").text).toBe("Check");
    t.undo();
    expect(only(doc, "note").text).toBe("");
  });

  // Stage 7: pinned open or not, as the note editor and the pinned box set it.
  it("starts unpinned; pinning and unpinning are each one undo step on that note", async () => {
    const { v, doc, t } = await setup();
    t.setTool("note");
    click(t, v, [200, 150]);
    click(t, v, [300, 250]);
    const [a, b] = doc.markups.filter((x): x is MarkupOf<"note"> => x.kind === "note");
    expect(a.pinned).toBeFalsy();
    t.updateMarkup({ ...a, pinned: true });
    expect((doc.byId(a.id) as MarkupOf<"note">).pinned).toBe(true);
    expect((doc.byId(b.id) as MarkupOf<"note">).pinned).toBeFalsy();
    t.updateMarkup({ ...(doc.byId(a.id) as MarkupOf<"note">), pinned: false });
    expect((doc.byId(a.id) as MarkupOf<"note">).pinned).toBe(false);
    t.undo();
    expect((doc.byId(a.id) as MarkupOf<"note">).pinned).toBe(true);
    t.undo();
    expect((doc.byId(a.id) as MarkupOf<"note">).pinned).toBeFalsy();
    expect(doc.markups.filter((x) => x.kind === "note")).toHaveLength(2);
  });

  it("is dragged by its icon in Select", async () => {
    const { v, doc, t } = await setup();
    t.setTool("note");
    click(t, v, [200, 150]);
    t.setTool("select");
    drag(t, v, [[200, 150], [260, 170]]);
    expect(only(doc, "note").at[0]).toBeCloseTo(250, 0);
  });
});
