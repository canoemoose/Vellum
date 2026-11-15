// Stage 9 (docs/editing-tool-consistency-brief.md): cut, select all, paste at the pointer, and
// the system clipboard: one clipboard for markups and pictures, and a signature never on it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakes, openViewer } from "./testkit";
import { type ClipRead, MarkupTool, type Mods } from "./markupTool";
import { MarkupDoc } from "./markupDoc";
import { type Markup, defaultStyle, DEFAULT_TEXT } from "../markup/types";
import { boundsOf, centredOn, fromClip, toClip } from "../markup/clip";
import type { Viewer } from "./viewer";

beforeEach(installFakes);
afterEach(() => {
  vi.useRealTimers();
});

const none: Mods = { shift: false, ctrl: false, alt: false };
const meta = { author: "", created: "2026-11-15T10:00:00Z", modified: "2026-11-15T10:00:00Z" };
const rect = (id: string, r: [number, number, number, number], page = 0): Markup => ({ id, page, kind: "rect", rect: r, style: defaultStyle("rect"), meta }) as Markup;
const signature = (id: string): Markup =>
  ({ id, page: 0, kind: "stamp", rect: [300, 300, 400, 340], signature: true, content: { type: "strokes", strokes: [[0, 0, 10, 10]], pen: 2, colour: [0, 0, 0] }, style: defaultStyle("stamp"), meta }) as unknown as Markup;

/** A system clipboard shared by tools (two windows), or each tool's own memory. */
function systemClipboard() {
  let held: ClipRead = { kind: "none" };
  return {
    write: async (json: string) => void (held = { kind: "markups", json }),
    read: async () => held,
    set: (c: ClipRead) => void (held = c),
    get json() {
      return held.kind === "markups" ? held.json : "";
    },
  };
}

async function setup(clip?: ReturnType<typeof systemClipboard>, extra: Partial<ConstructorParameters<typeof MarkupTool>[1]> = {}) {
  const { v } = await openViewer([{ w: 600, h: 400 }, { w: 600, h: 400 }]);
  v.setZoom(1);
  v.centreOn(0, 300, 200);
  const doc = new MarkupDoc();
  const t = new MarkupTool(v, {
    styleFor: (k) => defaultStyle(k),
    textStyle: () => DEFAULT_TEXT,
    author: () => "Tester",
    onChange: () => {},
    clipboard: clip,
    ...extra,
  });
  t.attach(doc);
  return { v, doc, t };
}

const scr = (v: Viewer, x: number, y: number): [number, number] => v.pageToScreen(0, x, y)!;
const mid = (m: Markup) => {
  const b = boundsOf([m]);
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
};

describe("the clipboard's contents", () => {
  it("never carries a signature's picture or strokes, only a reference", () => {
    const { json, held } = toClip([rect("r", [0, 0, 10, 10]), signature("s")], "run1");
    expect(json).not.toContain("strokes");
    expect(json).not.toContain("content");
    expect(held.size).toBe(1);
    // The run that copied it gets it back; another run (another window) skips it.
    expect(fromClip(json, "run1", held)!.markups.map((m) => m.kind)).toEqual(["rect", "stamp"]);
    const other = fromClip(json, "run2", new Map())!;
    expect(other.markups.map((m) => m.kind)).toEqual(["rect"]);
    expect(other.skipped).toBe(1);
  });

  it("isn't fooled by another app's writing: unknown kinds and broken markups are skipped", () => {
    expect(fromClip("not json", "x", new Map())).toBeNull();
    expect(fromClip(JSON.stringify({ app: "Other", v: 1, items: [] }), "x", new Map())).toBeNull();
    const bad = JSON.stringify({ app: "Vellum", v: 1, session: "x", items: [{ markup: { kind: "nope", page: 0 } }, { markup: { ...rect("r", [0, 0, 1, 1]), style: null } }, { markup: { ...signature("s") } }] });
    const r = fromClip(bad, "x", new Map())!;
    expect(r.markups).toEqual([]);
    expect(r.skipped).toBe(3);
  });

  it("centres several markups on a point together", () => {
    const ms = centredOn([rect("a", [0, 0, 10, 10]), rect("b", [20, 0, 30, 10])], [100, 100]);
    expect(boundsOf(ms)).toEqual([85, 95, 115, 105]);
  });
});

describe("cut, select all and paste", () => {
  it("cuts as one undo step", async () => {
    const { doc, t } = await setup();
    t.addMarkups([rect("a", [100, 100, 150, 150]), rect("b", [200, 100, 250, 150])]);
    t.select(["a"]);
    expect(t.cut()).toBe(true);
    expect(doc.markups.map((m) => m.id)).toEqual(["b"]);
    t.undo();
    expect(doc.markups.length).toBe(2);
    expect(await t.paste("centre")).toBe(true);
    expect(doc.markups.length).toBe(3);
  });

  it("selects every markup on a page, and only that page", async () => {
    const { doc, t } = await setup();
    t.addMarkups([rect("a", [100, 100, 150, 150]), rect("b", [200, 100, 250, 150]), rect("c", [10, 10, 20, 20], 1)]);
    t.clearSelection();
    expect(t.selectAllOnPage(0)).toBe(true);
    expect([...doc.selection].sort()).toEqual(["a", "b"]);
    expect(t.selectAllOnPage(1)).toBe(true);
    expect([...doc.selection]).toEqual(["c"]);
  });

  it("pastes the middle of the copied markups on the pointer, else the middle of the view", async () => {
    const { v, doc, t } = await setup();
    t.addMarkups([rect("a", [100, 100, 140, 140])]);
    t.copy();
    t.move(...scr(v, 400, 300), none);
    expect(await t.paste("pointer")).toBe(true);
    expect(mid(doc.markups[1])).toEqual([expect.closeTo(400, 3), expect.closeTo(300, 3)]);
    // From the menu (or with the pointer off the drawing): the middle of the view.
    expect(await t.paste("centre")).toBe(true);
    const view = v.pagePointAt(v.vw / 2, v.vh / 2)!;
    expect(mid(doc.markups[2])).toEqual([expect.closeTo(view.x, 3), expect.closeTo(view.y, 3)]);
    t.leave();
    expect(await t.paste("pointer")).toBe(true);
    expect(mid(doc.markups[3])).toEqual([expect.closeTo(view.x, 3), expect.closeTo(view.y, 3)]);
  });

  it("pastes markups copied in another window, but not its signatures", async () => {
    const clip = systemClipboard();
    const notes: string[] = [];
    const a = await setup(clip);
    const b = await setup(clip, { notify: (s) => notes.push(s) });
    a.t.addMarkups([rect("r", [100, 100, 140, 140]), signature("s")]);
    a.t.select(["r", "s"]);
    a.t.copy();
    await Promise.resolve();
    expect(clip.json).not.toContain("strokes");
    expect(await b.t.paste("centre")).toBe(true);
    expect(b.doc.markups.map((m) => m.kind)).toEqual(["rect"]);
    expect(notes[0]).toMatch(/signature/i);
    // In the window that copied it, the signature pastes too.
    expect(await a.t.paste("centre")).toBe(true);
    expect(a.doc.markups.filter((m) => m.kind === "stamp").length).toBe(2);
  });

  it("pastes a picture through the Image tool's hook, wherever it was copied", async () => {
    const clip = systemClipboard();
    const got: unknown[] = [];
    const { t } = await setup(clip, { onPicture: (pic, page, at) => got.push([pic.w, page, at.length]) });
    clip.set({ kind: "picture", png: "AAAA", w: 20, h: 10 });
    expect(await t.paste("centre")).toBe(true);
    expect(got).toEqual([[20, 0, 2]]);
    clip.set({ kind: "none" });
    expect(await t.paste("centre")).toBe(false);
  });
});
