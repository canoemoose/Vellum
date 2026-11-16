// Tool consistency stage 7: notes can stay open. The pin, the Popup annotation it's saved as
// (beside the icon, /Open when pinned, written closed for an unpinned note too), and where the
// pinned box and the editor go on screen at any view rotation.

import { describe, expect, it } from "vitest";
import { type MarkupOf, defaultStyle } from "../types";
import { toSpec } from "../spec";
import { type Frame, toPage } from "../pdf";
import { readReedit } from "../reedit";
import { NOTE_SIZE, POPUP_H, POPUP_W, besideIcon, frameSize, popupRect } from "./note";

const A4: Frame = { quarterTurns: 0, bbox: [0, 0, 595, 842] };
const meta = { author: "Tester", created: "2026-11-15T10:00:00Z", modified: "2026-11-15T10:00:00Z" };
const nt = (shape: Record<string, unknown> = {}): MarkupOf<"note"> =>
  ({ id: "n1", page: 0, kind: "note", style: defaultStyle("note"), meta, at: [100, 100], text: "Check the fixing", ...shape }) as unknown as MarkupOf<"note">;

describe("a note's pop-up in the file", () => {
  it("is open when pinned and closed when not", () => {
    expect(toSpec(nt({ pinned: true }), A4).popup?.open).toBe(true);
    expect(toSpec(nt({ pinned: false }), A4).popup?.open).toBe(false);
  });

  it("is written closed for a note saved before pins (no pinned field)", () => {
    const spec = toSpec(nt(), A4);
    expect(spec.popup).toBeDefined();
    expect(spec.popup!.open).toBe(false);
  });

  it("sits beside the icon on its right, its top level with the icon's, in user space", () => {
    const spec = toSpec(nt({ pinned: true }), A4);
    const [x0, y0, x1, y1] = spec.popup!.rect;
    expect(x1 - x0).toBeCloseTo(POPUP_W);
    expect(y1 - y0).toBeCloseTo(POPUP_H);
    // The icon is 100..120 across, 100..120 down the page: user space 722..742 up.
    expect(x0).toBeGreaterThanOrEqual(100 + NOTE_SIZE);
    expect(x0).toBeLessThan(100 + NOTE_SIZE + 10);
    expect(y1).toBeCloseTo(842 - 100);
    // It doesn't overlap the note's own box.
    expect(x0).toBeGreaterThanOrEqual(spec.rect[2] - 0.01);
  });

  it("goes on the icon's left where the page has no room on its right, and stays on the page", () => {
    const r = popupRect(nt({ at: [500, 830] }), [595, 842]);
    expect(r[2]).toBeLessThanOrEqual(500);
    expect(r[0]).toBeGreaterThanOrEqual(0);
    expect(r[3]).toBeLessThanOrEqual(842);
    expect(r[1]).toBeCloseTo(842 - POPUP_H);
  });

  it("sits beside the icon as the page is drawn on a turned page", () => {
    for (const quarterTurns of [1, 2, 3]) {
      const f: Frame = { quarterTurns, bbox: [10, 20, 605, 862] };
      const spec = toSpec(nt({ pinned: true }), f);
      // Back on the page (y down, rotation applied), it's right of the icon, top level.
      const a = toPage(f, spec.popup!.rect[0], spec.popup!.rect[1]);
      const b = toPage(f, spec.popup!.rect[2], spec.popup!.rect[3]);
      const page = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      expect(page[0], `${quarterTurns}`).toBeGreaterThanOrEqual(120);
      expect(page[1], `${quarterTurns}`).toBeCloseTo(100);
      expect(page[2] - page[0]).toBeCloseTo(POPUP_W);
    }
  });

  it("frameSize swaps width and height on a quarter turn", () => {
    expect(frameSize(A4)).toEqual([595, 842]);
    expect(frameSize({ quarterTurns: 1, bbox: [0, 0, 595, 842] })).toEqual([842, 595]);
    expect(frameSize({ quarterTurns: 2, bbox: [10, 20, 605, 862] })).toEqual([595, 842]);
  });

  it("keeps the pin in Vellum's own copy", () => {
    const spec = toSpec(nt({ pinned: true }), A4);
    expect(readReedit(spec.vellum, spec.modified)).toMatchObject({ kind: "note", pinned: true });
  });
});

describe("the box beside the icon on screen", () => {
  // The icon's corners on screen, 20 px square at (100, 50).
  const icon = (x: number, y: number) =>
    [
      [x, y],
      [x + 20, y],
      [x + 20, y + 20],
      [x, y + 20],
    ] as [number, number][];

  it("goes right of the icon, its top level with the icon's", () => {
    expect(besideIcon(icon(100, 50), 200, 100, { w: 1000, h: 800 })).toEqual({ x: 126, y: 50 });
  });

  it("is placed from the icon's extent whatever corner order a view rotation gives", () => {
    // Turned a quarter: the page's top-left corner is on the screen's top right.
    const turned = [
      [120, 50],
      [120, 70],
      [100, 70],
      [100, 50],
    ] as [number, number][];
    expect(besideIcon(turned, 200, 100, { w: 1000, h: 800 })).toEqual({ x: 126, y: 50 });
    expect(besideIcon(turned, 200, 100, null)).toEqual({ x: 126, y: 50 });
  });

  it("goes left of the icon where the right has no room, and stays inside the area", () => {
    expect(besideIcon(icon(900, 50), 200, 100, { w: 1000, h: 800 })).toEqual({ x: 694, y: 50 });
    // Near the bottom: lifted to fit.
    expect(besideIcon(icon(100, 780), 200, 100, { w: 1000, h: 800 }).y).toBe(694);
    // No room either side: kept inside, overlapping the icon if it must.
    expect(besideIcon(icon(150, 50), 400, 100, { w: 500, h: 800 }).x).toBe(94);
  });

  it("travels with the icon, off screen too, when there's no area to keep it in (a pinned note)", () => {
    expect(besideIcon(icon(-300, -40), 200, 100, null)).toEqual({ x: -274, y: -40 });
    expect(besideIcon(icon(990, 50), 200, 100, null)).toEqual({ x: 1016, y: 50 });
  });
});
