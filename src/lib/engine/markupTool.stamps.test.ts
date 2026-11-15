// Stage 8 through the gestures (markupTool.ts): a stamp placed with the view turned comes out
// upright as viewed; its rotate grip turns it, Shift in 15 degree steps, with its own cursor;
// nothing armed places nothing. Every stamp here is a text stamp or a synthetic picture.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakes, openViewer } from "./testkit";
import { MarkupTool, type Mods } from "./markupTool";
import { MarkupDoc } from "./markupDoc";
import { type MarkupOf, defaultStyle, DEFAULT_TEXT } from "../markup/types";
import { ROTATE_GAP_PX, armStamp } from "../markup/kinds/stamp";
import { centreOf, rotateGripAt, turnPt } from "../markup/turn";
import { ROTATE_CURSOR } from "../markup/shape";
import type { Viewer } from "./viewer";
import type { Rotation } from "../view/rotation";

beforeEach(installFakes);
afterEach(() => {
  vi.useRealTimers();
  armStamp({ type: "text", label: "APPROVED", sub: null, colour: [0.1, 0.55, 0.2] }, false);
});

const none: Mods = { shift: false, ctrl: false, alt: false };
const shift: Mods = { ...none, shift: true };

async function setup(rotation: Rotation = 0) {
  const { v } = await openViewer([{ w: 600, h: 400 }]);
  v.setZoom(1);
  v.setRotation(rotation);
  v.centreOn(0, 300, 200);
  const doc = new MarkupDoc();
  const t = new MarkupTool(v, { styleFor: (k) => defaultStyle(k), textStyle: () => DEFAULT_TEXT, author: () => "Tester", onChange: () => {} });
  t.attach(doc);
  return { v, doc, t };
}

const scr = (v: Viewer, p: [number, number]): [number, number] => v.pageToScreen(0, p[0], p[1])!;

function click(t: MarkupTool, v: Viewer, p: [number, number], mods = none) {
  const [sx, sy] = scr(v, p);
  t.down(sx, sy, 1, mods);
  t.up(sx, sy, mods);
}

function drag(t: MarkupTool, v: Viewer, a: [number, number], b: [number, number], mods = none) {
  const [sx, sy] = scr(v, a);
  const [ex, ey] = scr(v, b);
  t.down(sx, sy, 1, mods);
  for (let k = 1; k <= 4; k++) t.move(sx + ((ex - sx) * k) / 4, sy + ((ey - sy) * k) / 4, mods);
  t.up(ex, ey, mods);
}

describe("stamps through the gestures", () => {
  it("come out upright as viewed at every quarter turn of the view", async () => {
    for (const [rot, angle] of [[0, undefined], [90, 270], [180, 180], [270, 90]] as const) {
      const { v, doc, t } = await setup(rot);
      armStamp({ type: "text", label: "APPROVED", sub: null, colour: [0, 0.5, 0] }, false);
      t.setTool("stamp");
      click(t, v, [300, 200]);
      const s = doc.markups[0] as MarkupOf<"stamp">;
      expect(s.angle, `view ${rot}`).toBe(angle);
      // Its top edge's middle shows above its centre on screen, whatever the view's turn.
      const top = scr(v, turnPt([(s.rect[0] + s.rect[2]) / 2, s.rect[1]], centreOf(s.rect), s.angle ?? 0));
      const mid = scr(v, centreOf(s.rect));
      expect(top[1]).toBeLessThan(mid[1]);
      expect(top[0]).toBeCloseTo(mid[0], 3);
    }
  });

  it("turn by the rotate grip, Shift in 15 degree steps, with the rotate cursor over it", async () => {
    const { v, doc, t } = await setup();
    armStamp({ type: "text", label: "APPROVED", sub: null, colour: [0, 0.5, 0] }, false);
    t.setTool("stamp");
    click(t, v, [300, 200]);
    t.setTool("select");
    const s = doc.markups[0] as MarkupOf<"stamp">;
    t.select([s.id]);
    const grip = rotateGripAt(s.rect, 0, ROTATE_GAP_PX / v.view.scale) as [number, number];
    const [gx, gy] = scr(v, grip);
    t.move(gx, gy, none);
    expect(t.cursor()).toBe(ROTATE_CURSOR);
    const c = centreOf(s.rect);
    drag(t, v, grip, turnPt([c[0], c[1] - 60], c, 52) as [number, number], shift);
    const turned = doc.markups[0] as MarkupOf<"stamp">;
    expect(turned.angle).toBe(45);
    expect(turned.rect).toEqual(s.rect);
    // One undo step back to upright.
    t.undo();
    expect((doc.markups[0] as MarkupOf<"stamp">).angle).toBeUndefined();
  });

  it("place nothing while nothing is chosen", async () => {
    const { v, doc, t } = await setup();
    armStamp(null);
    t.setTool("signature");
    click(t, v, [300, 200]);
    drag(t, v, [100, 100], [200, 160]);
    expect(doc.markups.length).toBe(0);
  });
});
