// Phase 7b: annotations already in the file in a tab's model and on the canvas. Reading them in
// without an undo step, the lock (who may edit what), lifting (hidden in PDFium once changed),
// what a save writes for them, and finding them again after a save. Also phase 7a's leftovers
// in the tool: text markups aren't copied, and nudging one records nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakes, openViewer } from "./testkit";
import type { Viewer } from "./viewer";
import { MarkupTool, type Mods } from "./markupTool";
import { MarkupDoc } from "./markupDoc";
import { type Markup, type MarkupOf, DEFAULT_TEXT, defaultStyle } from "../markup/types";
import { toSpec } from "../markup/spec";
import type { Frame } from "../markup/pdf";
import { type FileAnnot, type FromFile, type PageAnnots, fromFile } from "../markup/fileAnnots";

beforeEach(installFakes);
afterEach(() => vi.useRealTimers());

const none: Mods = { shift: false, ctrl: false, alt: false };
const F: Frame = { quarterTurns: 0, bbox: [0, 0, 600, 400] };
const meta = (author: string) => ({ author, created: "2026-11-14T09:00:00.000Z", modified: "2026-11-14T09:00:00.000Z" });

const rect = (id: string, author: string, at = 100): Markup =>
  ({ id, page: 0, kind: "rect", rect: [at, 100, at + 50, 150], style: defaultStyle("rect"), meta: meta(author) }) as Markup;

/** As annot_read gives it back: Vellum's own (with its entry) or, with `vellum` false, another app's. */
function annot(m: Markup, index: number, vellum = true, nm: string | null = m.id): FileAnnot {
  const s = toSpec(m, F);
  return {
    index, subtype: s.subtype, nm, rect: s.rect, flags: 4, colour: s.colour ?? null, interior: s.interior ?? null, opacity: null,
    borderWidth: s.borderWidth ?? null, dash: null, cloud: null, line: s.line ?? null, lineEnds: s.lineEnds ?? null, vertices: s.vertices ?? null,
    ink: s.ink ?? null, quadPoints: s.quadPoints ?? null, callout: null, inset: s.inset ?? null, intent: null, contents: s.contents ?? null,
    author: s.author ?? null, modified: s.modified ?? null, created: s.created ?? null, defaultAppearance: null, defaultStyle: null,
    quadding: null, name: null, rotate: null, vellum: vellum ? (s.vellum ?? null) : null, measured: false,
  };
}

const read = (annots: FileAnnot[]): FromFile[] => fromFile({ page: 0, frame: F, annots } as PageAnnots, new Set());

async function setup(author = "Matt James") {
  const { v } = await openViewer([{ w: 600, h: 400 }]);
  v.setZoom(1);
  v.centreOn(0, 300, 200);
  const doc = new MarkupDoc();
  doc.author = author;
  doc.frames.set(0, F);
  const lifted: string[][] = [];
  const t = new MarkupTool(v, { styleFor: (k) => defaultStyle(k), textStyle: () => DEFAULT_TEXT, author: () => author, onChange: () => {}, onLift: (ids) => lifted.push(ids) });
  t.attach(doc);
  return { v, doc, t, lifted };
}

const scr = (v: Viewer, x: number, y: number): [number, number] => v.pageToScreen(0, x, y)!;
function drag(t: MarkupTool, v: Viewer, a: [number, number], b: [number, number]) {
  const [sx, sy] = scr(v, ...a), [ex, ey] = scr(v, ...b);
  t.down(sx, sy, 1, none);
  for (let k = 1; k <= 4; k++) t.move(sx + ((ex - sx) * k) / 4, sy + ((ey - sy) * k) / 4, none);
  t.up(ex, ey, none);
}
function click(t: MarkupTool, v: Viewer, a: [number, number]) {
  const [sx, sy] = scr(v, ...a);
  t.down(sx, sy, 1, none);
  t.up(sx, sy, none);
}

describe("reading the file in", () => {
  it("adds its annotations without an undo step, in every state of the history", async () => {
    const { doc, t, v } = await setup();
    t.setTool("rect");
    drag(t, v, [300, 300], [350, 350]);
    t.setTool("select");
    expect(doc.history.canUndo).toBe(true);
    doc.adoptFile(read([annot(rect("mine", "Matt James"), 0), annot(rect("theirs", "Pat", 200), 1, false)]));
    expect(doc.markups.map((m) => m.id).sort()).toEqual(["mine", "theirs", doc.markups.find((m) => !["mine", "theirs"].includes(m.id))!.id].sort());
    expect(doc.saved.map((m) => m.id)).toEqual(["mine", "theirs"]);
    // Undoing the drawn rectangle leaves the file's annotations where they are.
    t.undo();
    expect(doc.markups.map((m) => m.id)).toEqual(["mine", "theirs"]);
    expect(doc.dirty).toBe(false);
    expect(doc.changes()).toEqual([]);
  });

  it("leaves unchanged annotations to PDFium, and lifts Vellum's own notes at once", async () => {
    const { doc } = await setup();
    const note = { id: "n", page: 0, kind: "note", at: [400, 100], text: "Hi", style: defaultStyle("note"), meta: meta("Matt James") } as Markup;
    doc.adoptFile(read([annot(rect("r", "Pat"), 0, false), annot(note, 1)]));
    expect(doc.overlayDraws(doc.byId("r")!)).toBe(false);
    // A saved note is drawn by the overlay at a fixed size on screen, so it's lifted on reading.
    expect(doc.toLift()).toEqual([{ page: 0, nms: ["n"], indices: [] }]);
    expect(doc.overlayDraws(doc.byId("n")!)).toBe(true);
    expect(doc.toLift()).toEqual([]);
  });
});

describe("the lock", () => {
  it("lets you pick your own Vellum markups, and nothing else, while locked", async () => {
    const { doc, t, v } = await setup();
    doc.adoptFile(read([annot(rect("mine", "Matt James"), 0), annot(rect("theirs", "Pat", 200), 1), annot(rect("other app", "Matt James", 300), 2, false)]));
    click(t, v, [125, 100]);
    expect([...doc.selection]).toEqual(["mine"]);
    click(t, v, [225, 100]);
    expect([...doc.selection]).toEqual([]);
    click(t, v, [325, 100]);
    expect([...doc.selection]).toEqual([]);
    // Nor from the list, nor by deleting from it.
    t.select(["theirs", "mine"]);
    expect([...doc.selection]).toEqual(["mine"]);
    t.removeMarkup("theirs");
    expect(doc.byId("theirs")).toBeDefined();
    // Unlocked, everything is.
    doc.unlocked = true;
    click(t, v, [225, 100]);
    expect([...doc.selection]).toEqual(["theirs"]);
  });

  it("never covers what you made in this session, even once it's saved", async () => {
    const { doc, t, v } = await setup("");
    t.setTool("rect");
    drag(t, v, [300, 300], [350, 350]);
    t.setTool("select");
    const id = doc.markups[0].id;
    doc.hideAfterSave();
    doc.markSaved();
    doc.reread([{ page: 0, frame: F, annots: [annot(doc.byId(id)!, 0)] }]);
    expect(doc.files.get(id)).toMatchObject({ index: 0, nm: id, exact: true });
    t.clearSelection();
    click(t, v, [325, 300]);
    expect([...doc.selection]).toEqual([id]);
  });
});

describe("lifting", () => {
  it("hides one in PDFium as a drag starts, and draws it on the overlay from then on", async () => {
    const { doc, t, v, lifted } = await setup();
    doc.unlocked = true;
    doc.adoptFile(read([annot(rect("theirs", "Pat"), 3, false, null)]));
    const id = doc.markups[0].id;
    expect(id).toBe("file-p0-a3");
    click(t, v, [125, 100]);
    expect(lifted).toEqual([]); // merely selected: PDFium keeps drawing it
    drag(t, v, [125, 100], [145, 120]);
    expect(lifted).toEqual([[id]]);
    // The app lifts what onLift names: no /NM, so by position.
    expect(doc.toLift([id])).toEqual([{ page: 0, nms: [], indices: [3] }]);
    expect(doc.overlayDraws(doc.byId(id)!)).toBe(true);
    // Saving replaces it in place, found by position, and gives it an /NM.
    const [c] = doc.changes();
    expect(c).toMatchObject({ op: "replace", spec: { nm: id, at: 3 } });
  });

  it("hides whatever changed or went, after a restyle, a nudge or a delete", async () => {
    const { doc, t } = await setup();
    doc.unlocked = true;
    doc.adoptFile(read([annot(rect("a", "Pat"), 0, false), annot(rect("b", "Pat", 200), 1, false), annot(rect("c", "Pat", 300), 2, false)]));
    t.select(["a"]);
    t.restyle({ width: 4 });
    t.select(["b"]);
    t.nudge(5, 0);
    t.select(["c"]);
    t.deleteSelection();
    expect(doc.toLift()).toEqual([{ page: 0, nms: ["a", "b", "c"], indices: [] }]);
    expect(doc.changes().map((c) => c.op)).toEqual(["replace", "replace", "delete"]);
  });
});

describe("annotations Vellum can't redraw", () => {
  it("move, keeping their own look, and can't be restyled or copied", async () => {
    const { doc, t, v } = await setup();
    doc.unlocked = true;
    const att: FileAnnot = { ...annot(rect("x", "Pat"), 5, false, null), subtype: "FileAttachment", rect: [100, 250, 120, 300] };
    doc.adoptFile(read([att]));
    const m = doc.markups[0] as MarkupOf<"foreign">;
    expect(m.kind).toBe("foreign");
    drag(t, v, [110, 125], [140, 105]);
    const moved = doc.byId(m.id) as MarkupOf<"foreign">;
    expect(moved.moved).toEqual([30, -20]);
    t.restyle({ stroke: [0, 1, 0] });
    expect((doc.byId(m.id) as MarkupOf<"foreign">).style).toEqual(m.style);
    expect(t.copy()).toBe(false);
    // Moved 30 right and 20 up the page: in user space (y up) that's +30, +20.
    expect(doc.changes()).toEqual([{ op: "move", page: 0, nm: m.id, at: 5, dx: 30, dy: 20, modified: expect.any(String) }]);
    // Saved, then moved again: only the new distance.
    doc.hideAfterSave();
    doc.markSaved();
    doc.reread([{ page: 0, frame: F, annots: [{ ...att, rect: [130, 270, 150, 320] }] }]);
    expect(doc.hidden.has(m.id)).toBe(false);
    t.select([m.id]);
    t.nudge(10, 0);
    const again = (doc.byId(m.id) as MarkupOf<"foreign">).moved[0] - 30;
    expect(again).toBeGreaterThan(0);
    expect(doc.changes()).toMatchObject([{ op: "move", at: 5, dx: again, dy: 0 }]);
  });
});

describe("after a save", () => {
  it("keeps the overlay drawing what it drew, hidden again by /NM, and finds the rest by order", async () => {
    const { doc, t } = await setup();
    doc.unlocked = true;
    // Two without /NM; the first is deleted, the second left alone; a third (named) is changed.
    doc.adoptFile(read([annot(rect("p", "Pat"), 0, false, null), annot(rect("q", "Pat", 200), 2, false, null), annot(rect("r", "Pat", 300), 4, false)]));
    const [p, q] = ["file-p0-a0", "file-p0-a2"];
    t.select([p]);
    t.deleteSelection();
    t.select(["r"]);
    t.nudge(5, 0);
    doc.toLift();
    const hide = doc.hideAfterSave();
    // r was replaced with its id as /NM; q was never touched, so PDFium draws it.
    expect([...hide]).toEqual([[0, ["r"]]]);
    expect(doc.stale).toBe(true);
    // A save straight away must wait for the file to be read again: positions have moved.
    doc.markSaved();
    t.select([q]);
    t.nudge(5, 0);
    expect(() => doc.changes()).toThrow();
    doc.reread([{ page: 0, frame: F, annots: [{ ...annot(rect("q", "Pat", 200), 0, false, null) }, { ...annot(doc.byId("r")!, 1) }] }]);
    expect(doc.files.get(q)).toMatchObject({ index: 0, nm: null });
    expect(doc.files.get("r")).toMatchObject({ index: 1, nm: "r", exact: true });
    expect(doc.files.has(p)).toBe(false);
    expect(doc.changes()).toMatchObject([{ op: "replace", spec: { nm: q, at: 0 } }]);
  });
});

describe("phase 7a leftovers", () => {
  it("doesn't copy text markups, and nudging one records no undo step", async () => {
    const { doc, t } = await setup();
    const hl = { id: "h", page: 0, kind: "textmark", variant: "highlight", quads: [[[100, 100], [200, 100], [100, 110], [200, 110]]], text: "x", style: defaultStyle("textmark"), meta: meta("Matt James") } as Markup;
    t.addMarkups([hl]);
    const steps = () => (doc.history as unknown as { past: unknown[] }).past.length;
    const before = steps();
    expect(t.nudge(5, 0)).toBe(false);
    expect(steps()).toBe(before);
    expect(t.copy()).toBe(false);
    expect(t.canPaste).toBe(false);
  });
});
