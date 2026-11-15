// Phase 7a's gestures against the stub viewer: the highlighter (Shift for a straight stroke),
// the callout (tip first, then the box), notes placed at a click, and text markups added from
// outside a gesture.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakes, openViewer } from "./testkit";
import { MarkupTool, type Mods } from "./markupTool";
import { MarkupDoc } from "./markupDoc";
import { type Markup, type MarkupOf, defaultStyle, DEFAULT_TEXT } from "../markup/types";
import type { Viewer } from "./viewer";

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

