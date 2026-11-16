// Stage 8 through the gestures (markupTool.ts): a stamp placed with the view turned comes out
// upright as viewed; its rotate grip turns it, Shift in 15 degree steps, with its own cursor;
// nothing armed places nothing. Every stamp here is a text stamp or a synthetic picture.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakes, openViewer } from "./testkit";
import { MarkupTool, type Mods } from "./markupTool";
import { MarkupDoc } from "./markupDoc";
import { type MarkupOf, defaultStyle, DEFAULT_TEXT } from "../markup/types";
import { ROTATE_GAP_PX, armStamp, setStampFields } from "../markup/kinds/stamp";
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

describe("[ and ] turn what's selected or about to be placed (Matt's review)", () => {
  it("turn a selected stamp a quarter in one undo step, and Shift's 15 degrees", async () => {
    const { v, doc, t } = await setup();
    armStamp({ type: "text", label: "APPROVED", sub: null, colour: [0, 0.5, 0] }, false);
    t.setTool("stamp");
    click(t, v, [300, 200]);
    t.setTool("select");
    t.select([doc.markups[0].id]);
    expect(t.turnBy(90)).toBe(true);
    expect((doc.markups[0] as MarkupOf<"stamp">).angle).toBe(90);
    expect(t.turnBy(-15)).toBe(true);
    expect((doc.markups[0] as MarkupOf<"stamp">).angle).toBe(75);
    t.undo();
    expect((doc.markups[0] as MarkupOf<"stamp">).angle).toBe(90);
  });

  it("leave a selection with anything that can't turn as it is, and say the key was used", async () => {
    const { v, doc, t } = await setup();
    t.setTool("rect");
    drag(t, v, [100, 100], [200, 160]);
    t.setTool("select");
    t.select([doc.markups[0].id]);
    const before = doc.markups[0];
    expect(t.turnBy(90)).toBe(true);
    expect(doc.markups[0]).toBe(before);
  });

  it("with nothing selected and no stamp tool out, leave it to the view", async () => {
    const { t } = await setup();
    t.setTool("select");
    expect(t.turnBy(90)).toBe(false);
  });

  it("with a stamp tool out, turn the next one placed, until the tool changes", async () => {
    const { v, doc, t } = await setup();
    armStamp({ type: "text", label: "APPROVED", sub: null, colour: [0, 0.5, 0] }, false);
    t.setTool("stamp");
    expect(t.turnBy(90)).toBe(true);
    click(t, v, [300, 200]);
    expect((doc.markups[0] as MarkupOf<"stamp">).angle).toBe(90);
    t.setTool("select");
    t.setTool("stamp");
    t.select([]);
    click(t, v, [300, 300]);
    expect((doc.markups[1] as MarkupOf<"stamp">).angle).toBeUndefined();
  });
});

describe("the Image tool places one picture (Matt's review)", () => {
  it("says so once a picture is placed, clicked or dragged, and the Stamp tool doesn't", async () => {
    const { v, doc } = await setup();
    let done = 0;
    const t = new MarkupTool(v, { styleFor: (k) => defaultStyle(k), textStyle: () => DEFAULT_TEXT, author: () => "Tester", onChange: () => {}, placedOnce: () => done++ });
    t.attach(doc);
    armStamp({ type: "image", png: "AAAA", hash: "abcdef0123456789abcd", w: 200, h: 100 }, false);
    t.setTool("image");
    click(t, v, [300, 200]);
    expect(done).toBe(1);
    expect(t.selected().map((m) => m.id)).toEqual([doc.markups[0].id]);
    drag(t, v, [100, 100], [200, 160]);
    expect(done).toBe(2);
    t.setTool("stamp");
    click(t, v, [300, 300]);
    expect(done).toBe(2);
  });
});

describe("cropping a picture in the tool (Matt's review)", () => {
  it("crops by the grips while on, one undo step a drag, and stops on a click elsewhere", async () => {
    const { v, doc, t } = await setup();
    armStamp({ type: "image", png: "AAAA", hash: "abcdef0123456789abcd", w: 200, h: 100 }, false);
    t.setTool("image");
    drag(t, v, [100, 100], [300, 200]);
    t.setTool("select");
    const id = doc.markups[0].id;
    t.select([id]);
    expect(t.croppable).toBe(true);
    t.setCropping(true);
    expect(t.cropping).toBe(true);
    const m0 = doc.markups[0] as MarkupOf<"stamp">;
    const r = m0.rect;
    // The right-hand edge's grip, dragged in: cropped, not resized (the height stays).
    drag(t, v, [r[2], (r[1] + r[3]) / 2], [r[2] - 50, (r[1] + r[3]) / 2]);
    const m1 = doc.markups[0] as MarkupOf<"stamp">;
    expect(m1.rect[3] - m1.rect[1]).toBeCloseTo(r[3] - r[1], 6);
    expect(m1.content.type === "image" && m1.content.crop![2]).toBeCloseTo(0.75, 6);
    t.undo();
    expect((doc.markups[0] as MarkupOf<"stamp">).content).toEqual(m0.content);
    t.redo();
    // A click away from the picture: no longer cropping (the grips resize again).
    click(t, v, [500, 350]);
    expect(t.cropping).toBe(false);
  });
});

describe("a text stamp's fields (Matt's review)", () => {
  it("are filled in when it's placed, for the page it lands on, and its wording is kept", async () => {
    const { v, doc, t } = await setup();
    setStampFields((page) => ({ author: "Tester", now: new Date(2026, 10, 15, 9, 5), file: "GA-101.pdf", page }));
    armStamp({ type: "text", label: "CHECKED {FILE}", sub: "{author}, {date}, p{page}", colour: [0, 0.5, 0] }, false);
    t.setTool("stamp");
    click(t, v, [300, 200]);
    const s = doc.markups[0] as MarkupOf<"stamp">;
    expect(s.content).toMatchObject({ label: "CHECKED GA-101.PDF", sub: "Tester, 15 Nov 2026, p1", fields: { label: "CHECKED {FILE}", sub: "{author}, {date}, p{page}" } });
    setStampFields((page) => ({ author: "", now: new Date(), file: "", page }));
  });
});
