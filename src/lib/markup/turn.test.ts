// Stage 8: turning stamps, signatures and images (docs/editing-tool-consistency-brief.md). The
// maths in turn.ts, then the stamp kind built on it: its turned box, picking, grips, resizing in
// its own frame, 15 degree steps, the saved /Rect and appearance, opacity, and a new one upright
// as viewed at every quarter turn of the view. Every signature here is synthetic.

import { describe, expect, it } from "vitest";
import type { Markup, Pt, Rect } from "./types";
import { type ImageOp, type PathOp, type TextOp, opsBounds, opsFor } from "./ops";
import { toSpec } from "./spec";
import { toContent, type Frame } from "./pdf";
import { reeditEntry } from "./reedit";
import { dragHandle, handleAt, handles, hits, insideMarquee, moveBy, shapeBounds, turnOf } from "./geometry";
import { handleCursor, ROTATE_CURSOR } from "./shape";
import { type ImageContent, type StrokesContent, type TextContent, aspectOf, naturalSize } from "./stamps";
import {
  ROTATE_GAP_PX, SIGNATURE_WIDTH, type StampMarkup, armStamp, canCrop, cropHandles, dragCrop, faded, fitDragged, placeAt, stamp as stampKind, uncropped, wholeBox, withContent,
} from "./kinds/stamp";
import {
  angleTo, centreOf, insideTurned, normDeg, snapTurn, resizeTurned, rotateGripAt, screenTopLeft, swapsSides, turnOps, turnPt, turnedBounds, turnedCorners, uprightAngle,
} from "./turn";
import { rotatePoint, type Rotation } from "../view/rotation";
import { kindOf } from "./kinds";
import { regularVertices as regularVerticesOf } from "./regular";

const A4: Frame = { quarterTurns: 0, bbox: [0, 0, 595, 842] };
const meta = { author: "Tester", created: "2026-11-15T10:00:00Z", modified: "2026-11-15T10:00:00Z" };
const approved: TextContent = { type: "text", label: "APPROVED", sub: null, colour: [0.1, 0.55, 0.2] };
const zigzag: StrokesContent = { type: "strokes", strokes: [[0, 20, 10, 0, 20, 20, 30, 0], [40, 10]], pen: 2, colour: [0, 0, 0.5] };
const picture: ImageContent = { type: "image", png: "AAAA", hash: "abcdef0123456789abcd", w: 200, h: 100 };

const close = (a: Pt, b: Pt, d = 6) => {
  expect(a[0]).toBeCloseTo(b[0], d);
  expect(a[1]).toBeCloseTo(b[1], d);
};

function mk(content: StampMarkup["content"], rect: Rect, angle?: number, signature = false): StampMarkup {
  return { id: "s1", page: 0, kind: "stamp", rect, ...(angle !== undefined ? { angle } : {}), content, signature, style: stampKind.defaultStyle(), meta };
}

describe("turning a box", () => {
  it("turns clockwise as seen on the page (y down)", () => {
    close(turnPt([10, 0], [0, 0], 90), [0, 10]);
    close(turnPt([10, 0], [0, 0], -90), [0, -10]);
    close(turnPt([5, 5], [5, 5], 37), [5, 5]);
    expect(normDeg(-90)).toBe(270);
    expect(normDeg(720 + 15)).toBe(15);
    expect(normDeg(-1e-12)).toBe(0);
  });

  it("finds a turned box's corners and the upright box holding them", () => {
    const r: Rect = [0, 0, 100, 50];
    // A quarter turn: same middle, sides swapped.
    const b = turnedBounds(r, 90);
    close([b[0], b[1]], [25, -25]);
    close([b[2], b[3]], [75, 75]);
    // Its own top left goes to the top right of what's seen.
    close(turnedCorners(r, 90)[0], [75, -25]);
    // At 45 degrees: as wide as the diagonal's projection, both ways.
    const d = turnedBounds(r, 45);
    expect(d[2] - d[0]).toBeCloseTo(150 / Math.SQRT2);
    expect(d[3] - d[1]).toBeCloseTo(150 / Math.SQRT2);
    expect(turnedBounds(r, 0)).toEqual(r);
  });

  it("picks inside the turned box, not the upright one", () => {
    const r: Rect = [0, 0, 100, 20];
    // Turned a quarter, it's a 20 x 100 bar standing on (50, 10).
    expect(insideTurned([50, -30], r, 90, 0)).toBe(true);
    expect(insideTurned([5, 10], r, 90, 0)).toBe(false);
    expect(insideTurned([5, 10], r, 0, 0)).toBe(true);
    // The tolerance reaches out from every side.
    expect(insideTurned([61, 10], r, 90, 2)).toBe(true);
    expect(insideTurned([63, 10], r, 90, 2)).toBe(false);
  });

  it("takes its angle from the rotate grip, Shift in 15 degree steps (rule 2)", () => {
    const r: Rect = [0, 0, 100, 100];
    expect(angleTo(r, [50, -100], false)).toBe(0);
    expect(angleTo(r, [200, 50], false)).toBe(90);
    expect(angleTo(r, [50, 200], false)).toBe(180);
    expect(angleTo(r, [-100, 50], false)).toBe(270);
    const at = (deg: number): Pt => turnPt([50, -50], [50, 50], deg);
    expect(angleTo(r, at(37), false)).toBeCloseTo(37);
    expect(angleTo(r, at(37), true)).toBe(30);
    expect(angleTo(r, at(38), true)).toBe(45);
    expect(angleTo(r, at(-7), true)).toBe(0);
    expect(angleTo(r, at(-8), true)).toBe(345);
    for (let d = 0; d < 360; d += 5) expect(angleTo(r, at(d + 3), true) % 15).toBe(0);
  });

  it("puts the rotate grip above the middle of the top edge, in the box's own frame", () => {
    const r: Rect = [0, 0, 100, 40];
    close(rotateGripAt(r, 0, 24), [50, -24]);
    // Turned a quarter: its top faces right.
    close(rotateGripAt(r, 90, 24), [50 + 20 + 24, 20]);
  });

  it("resizes in its own frame, the opposite corner staying put on the page", () => {
    const r: Rect = [100, 100, 200, 150];
    const grow = (own: Rect, q: Pt): Rect => [own[0], own[1], q[0], own[1] + (q[0] - own[0]) / 2];
    for (const deg of [0, 30, 90, 200]) {
      const fixed = turnedCorners(r, deg)[0];
      const se = turnedCorners(r, deg)[2];
      // Pull the far corner out along the box's own diagonal.
      const p = turnPt([se[0] + 50, se[1] + 25], se, deg);
      const out = resizeTurned(r, deg, p, grow);
      close(turnedCorners(out, deg)[0], fixed);
      expect(out[2] - out[0]).toBeCloseTo(150);
      expect(out[3] - out[1]).toBeCloseTo(75);
    }
  });

  it("knows which way is up as viewed at each quarter turn", () => {
    const size = { w: 595, h: 842 };
    for (const v of [0, 90, 180, 270] as Rotation[]) {
      const a = uprightAngle(v);
      // The stamp's own right and down, through the turn and then the view, read right and down on screen.
      const o = rotatePoint(300, 400, size, v);
      const right = turnPt([301, 400], [300, 400], a), down = turnPt([300, 401], [300, 400], a);
      const rs = rotatePoint(right[0], right[1], size, v), ds = rotatePoint(down[0], down[1], size, v);
      close([rs[0] - o[0], rs[1] - o[1]], [1, 0]);
      close([ds[0] - o[0], ds[1] - o[1]], [0, 1]);
      // And the corner shown at the top left of a page box is the one the view puts there.
      const r: Rect = [10, 20, 110, 70];
      const tl = screenTopLeft(r, v);
      const shown = turnedCorners(r, 0).map((p) => rotatePoint(p[0], p[1], size, v));
      const min = shown.reduce((m, p) => (p[0] + p[1] < m[0] + m[1] ? p : m));
      close(rotatePoint(tl[0], tl[1], size, v) as Pt, min as Pt);
      expect(swapsSides(v)).toBe(v === 90 || v === 270);
    }
  });

  it("turns drawing operations with their box: paths, text along its direction, pictures about their middle", () => {
    const c: Pt = [50, 50];
    const path: PathOp = { t: "path", segs: [["M", 60, 50], ["L", 70, 50], ["C", 50, 60, 50, 60, 50, 60], ["Z"]], stroke: [0, 0, 0], fill: null, width: 1, dash: null, strokeOpacity: 1, fillOpacity: 1 };
    const text: TextOp = { t: "text", lines: ["A"], origin: [60, 50], dir: [1, 0], size: 10, leading: 10, colour: [0, 0, 0], clip: null, face: { family: "helvetica", bold: true, italic: false }, offsets: [0] };
    const img: ImageOp = { t: "image", rect: [60, 40, 80, 60], png: "", hash: "h" };
    const [p, t, i] = turnOps([path, text, img], c, 90) as [PathOp, TextOp, ImageOp];
    close([p.segs[0][1] as number, p.segs[0][2] as number], [50, 60]);
    close(t.origin, [50, 60]);
    close(t.dir, [0, 1]);
    expect(i.angle).toBe(90);
    close(centreOf(i.rect), [50, 70]);
    expect(i.rect[2] - i.rect[0]).toBeCloseTo(20);
    expect(turnOps([path], c, 0)[0]).toBe(path);
  });
});

describe("a turned stamp", () => {
  it("is picked, bounded and caught by the marquee as its turned box", () => {
    const m = mk(approved, [100, 100, 300, 140], 90) as Markup;
    expect(turnOf(m)).toBe(90);
    // A quarter turn: a 40 x 200 bar on (200, 120).
    expect(hits(m, [200, 30], 1)).toBe(true);
    expect(hits(m, [110, 120], 1)).toBe(false);
    const b = shapeBounds(m);
    close([b[0], b[1]], [180, 20]);
    close([b[2], b[3]], [220, 220]);
    expect(insideMarquee(m, [170, 10, 230, 230])).toBe(true);
    expect(insideMarquee(m, [90, 90, 310, 150])).toBe(false);
    // Moving keeps the turn.
    const moved = moveBy(m, 10, 0) as StampMarkup;
    expect(moved.angle).toBe(90);
    expect(moved.rect).toEqual([110, 100, 310, 140]);
  });

  it("loads at 0 degrees when saved before it could turn", () => {
    const old = mk(approved, [100, 100, 300, 140]) as Markup;
    expect(turnOf(old)).toBe(0);
    expect(shapeBounds(old)).toEqual([100, 100, 300, 140]);
  });

  it("shows corner grips at its turned corners and a rotate grip a fixed distance off on screen", () => {
    const m = mk(approved, [100, 100, 300, 140], 90) as Markup;
    const hs = handles(m, 0.5);
    expect(hs.map((h) => h.id)).toEqual(["nw", "ne", "se", "sw", "rotate"]);
    close(hs[0].at, [220, 20]);
    // 24 CSS px at 2 px a point: 12 points out from its top edge, which faces right.
    close(hs[4].at, [220 + ROTATE_GAP_PX * 0.5, 120]);
    expect(handleAt(m, [232, 120], 2, 0.5)).toBe("rotate");
  });

  it("turns by its rotate grip, Shift stepping 15 degrees", () => {
    const m = mk(approved, [100, 100, 300, 140], 0) as Markup;
    const c = centreOf([100, 100, 300, 140]);
    const p = turnPt([c[0], c[1] - 80], c, 52);
    expect((dragHandle(m, "rotate", p, false) as StampMarkup).angle).toBeCloseTo(52);
    expect((dragHandle(m, "rotate", p, true) as StampMarkup).angle).toBe(45);
    // The box itself doesn't change.
    expect((dragHandle(m, "rotate", p, true) as StampMarkup).rect).toEqual([100, 100, 300, 140]);
  });

  it("resizes from a corner in its own frame, aspect kept, the opposite corner fixed", () => {
    const m = mk(approved, [100, 100, 300, 140], 30);
    const a = aspectOf(approved);
    const box: Rect = [100, 100, 100 + 200, 100 + 200 / a];
    const t = { ...m, rect: box };
    const fixed = turnedCorners(box, 30)[0];
    const se = turnedCorners(box, 30)[2];
    const out = dragHandle(t as Markup, "se", turnPt([se[0] + 100, se[1]], se, 30), false) as StampMarkup;
    const w = out.rect[2] - out.rect[0], h = out.rect[3] - out.rect[1];
    expect(w / h).toBeCloseTo(a);
    expect(w).toBeCloseTo(300);
    close(turnedCorners(out.rect, 30)[0], fixed);
    expect(out.angle).toBe(30);
  });

  it("points its grips' cursors the way they face on screen", () => {
    expect(handleCursor("se", 0, 0)).toBe("nwse-resize");
    expect(handleCursor("se", 0, 90)).toBe("nesw-resize");
    expect(handleCursor("se", 90, 0)).toBe("nesw-resize");
    expect(handleCursor("se", 0, 45)).toBe("ns-resize");
    expect(handleCursor("e", 0, 40)).toBe("nwse-resize");
    expect(handleCursor("n", 90, 0)).toBe("ew-resize");
    expect(handleCursor("rotate", 0, 0)).toBe(ROTATE_CURSOR);
    expect(ROTATE_CURSOR).toMatch(/^url\("data:image\/svg\+xml,[^"]+"\) 12 12, crosshair$/);
    expect(handleCursor("v3", 0, 0)).toBe("move");
  });

  it("saves its turned box as /Rect and draws its appearance turned", () => {
    const upright = toSpec(mk(picture, [100, 100, 300, 200]) as Markup, A4);
    expect(upright.rect).toEqual([100, 642, 300, 742]);
    const m = mk(picture, [100, 100, 300, 200], 90) as Markup;
    const spec = toSpec(m, A4);
    // A quarter turn: 100 wide, 200 tall, same middle (200, 150) = user (200, 692).
    expect(spec.rect).toEqual([150, 592, 250, 792]);
    expect(spec.appearance.bbox).toEqual(spec.rect);
    // The picture's unit square goes onto its turned corners: its bottom left (page 150, 50)
    // at user (150, 792); its x runs down the page, its y to the right.
    expect(spec.appearance.ops).toContain("0 -200 100 0 150 792 cm");
    // At 45 degrees the box holding it is the turned box's bounds.
    const d = toSpec(mk(picture, [100, 100, 300, 200], 45) as Markup, A4);
    const tb = turnedBounds([100, 100, 300, 200], 45);
    expect(d.rect[2] - d.rect[0]).toBeCloseTo(Math.ceil(tb[2]) - Math.floor(tb[0]), 0);
    // A text stamp's lettering runs along its turn, in the appearance as on screen.
    const txt = opsFor(mk(approved, [100, 100, 300, 140], 90) as Markup).find((o) => o.t === "text") as TextOp;
    close(txt.dir, [0, 1]);
    // Vellum's own copy keeps the angle.
    expect(JSON.parse(reeditEntry(m)).markup.angle).toBe(90);
  });

  it("is see-through by its opacity, on screen and in the file", () => {
    const m = { ...mk(approved, [100, 100, 300, 140]), style: { ...stampKind.defaultStyle(), opacity: 0.5 } } as Markup;
    const ops = opsFor(m);
    expect(ops.every((o) => (o.t === "path" ? o.strokeOpacity === 0.5 : o.t === "text" ? o.opacity === 0.5 : true))).toBe(true);
    const spec = toSpec(m, A4);
    expect(spec.appearance.opacity).toBe(0.5);
    expect(spec.appearance.fillOpacity).toBe(0.5);
    expect(spec.appearance.ops).toContain("/GS0 gs");
    const pic = toContent(A4, faded([{ t: "image", rect: [0, 0, 10, 10], png: "", hash: "abcd" }], 0.25));
    expect(pic.fillOpacity).toBe(0.25);
    expect(pic.ops).toContain("/GS0 gs");
    // Opaque: nothing changes.
    const solid = opsFor(mk(approved, [100, 100, 300, 140]) as Markup);
    expect(solid.some((o) => o.t === "text" && o.opacity !== undefined)).toBe(false);
    expect(toSpec(mk(approved, [100, 100, 300, 140]) as Markup, A4).appearance.opacity).toBeNull();
  });

  it("covers its turned picture in the operations' bounds", () => {
    const op: ImageOp = { t: "image", rect: [0, 0, 100, 50], png: "", hash: "h", angle: 90 };
    expect(opsBounds([op])).toEqual([25, -25, 75, 75]);
  });
});

describe("a new one starts upright as viewed (A16)", () => {
  const ctx = (viewRotation: number) => ({ textStyle: { size: 10, colour: [0, 0, 0] as [number, number, number] }, viewRotation });
  const draw = stampKind.draw;
  if (draw.gesture !== "place") throw new Error("stamps are placed");

  it("turns back by the view's turn when clicked", () => {
    armStamp(approved, false);
    for (const [v, a] of [[0, undefined], [90, 270], [180, 180], [270, 90]] as const) {
      const s = draw.make([300, 400], ctx(v))!;
      expect(s.angle).toBe(a);
      close(centreOf(s.rect), [300, 400]);
    }
    // The same goes for a pasted picture (placeAt).
    expect(placeAt(picture, false, [10, 10], 90).angle).toBe(270);
    expect(placeAt(picture, false, [10, 10], 90).rect[2] - placeAt(picture, false, [10, 10], 90).rect[0]).toBeCloseTo(SIGNATURE_WIDTH);
  });

  it("fits a dragged box as it's seen, from the corner at the top left of the screen", () => {
    const size = { w: 595, h: 842 };
    const a = aspectOf(picture); // 2:1
    for (const v of [0, 90, 180, 270] as Rotation[]) {
      // A drag 200 wide and 40 tall on screen.
      const sw = 200, sh = 40;
      const page: Rect = swapsSides(v) ? [100, 100, 100 + sh, 100 + sw] : [100, 100, 100 + sw, 100 + sh];
      const fit = fitDragged(picture, page, v)!;
      expect(fit.rect[2] - fit.rect[0]).toBeCloseTo(200);
      expect(fit.rect[3] - fit.rect[1]).toBeCloseTo(200 / a);
      expect(fit.angle ?? 0).toBe(uprightAngle(v));
      // Its own top left shows at the drag's top left on screen.
      const own = turnedCorners(fit.rect, fit.angle ?? 0)[0];
      const tl = screenTopLeft(page, v);
      close(rotatePoint(own[0], own[1], size, v) as Pt, rotatePoint(tl[0], tl[1], size, v) as Pt);
    }
    expect(fitDragged(picture, [0, 0, 4, 3], 90)).toBeNull();
  });

  it("places nothing until something is chosen", () => {
    armStamp(null);
    expect(draw.make([0, 0], ctx(0))).toBeNull();
    expect(draw.box?.([0, 0, 100, 100], ctx(0))).toBeNull();
    armStamp(approved, false);
  });
});

describe("changing what a placed stamp holds", () => {
  it("keeps its middle and turn; text keeps its lettering's size, anything else its width", () => {
    const m = mk(approved, [100, 100, 300, 160], 30);
    const k = 200 / naturalSize(approved)[0];
    const withSub = withContent(m, { ...approved, sub: "Tester, 15 Nov 2026" });
    expect(withSub.angle).toBe(30);
    close(centreOf(withSub.rect), centreOf(m.rect));
    expect((withSub.rect[2] - withSub.rect[0]) / naturalSize(withSub.content)[0]).toBeCloseTo(k);
    const longer = withContent(m, { ...approved, label: "FOR COMMENT" });
    expect(longer.rect[2] - longer.rect[0]).toBeGreaterThan(200);
    const sig = withContent(m, zigzag, true);
    expect(sig.signature).toBe(true);
    expect(sig.rect[2] - sig.rect[0]).toBeCloseTo(200);
    expect((sig.rect[2] - sig.rect[0]) / (sig.rect[3] - sig.rect[1])).toBeCloseTo(aspectOf(zigzag));
  });

  it("takes a text stamp's colour from the bar, and shows it there", () => {
    const def = kindOf("stamp");
    const m = def.finish!(mk(approved, [0, 0, 100, 30]));
    expect(m.style.stroke).toEqual(approved.colour);
    const red = { ...m, style: { ...m.style, stroke: [1, 0, 0] as [number, number, number] } };
    expect((def.restyled!(m, red).content as TextContent).colour).toEqual([1, 0, 0]);
    // Only opacity changed: the colour stays the lettering's.
    const faint = { ...m, style: { ...m.style, opacity: 0.4 } };
    expect((def.restyled!(m, faint).content as TextContent).colour).toEqual(approved.colour);
    // A signature has no colour to change.
    const s = mk(zigzag, [0, 0, 100, 30], 0, true);
    expect(def.restyled!(s, { ...s, style: { ...s.style, stroke: [1, 0, 0] } }).content).toEqual(zigzag);
  });
});

describe("the rotate grip's snaps, and turning polygons and clouds (Matt's review)", () => {
  it("draws the grip to a multiple of 45 degrees within 4, and Shift steps by 15", () => {
    expect(snapTurn(3.5, false)).toBe(0);
    expect(snapTurn(-3, false)).toBe(0);
    expect(snapTurn(42, false)).toBe(45);
    expect(snapTurn(93, false)).toBe(90);
    expect(snapTurn(30, false)).toBe(30);
    expect(snapTurn(52, true)).toBe(45);
    expect(snapTurn(53, true)).toBe(60);
  });

  const poly = (extra: Record<string, unknown> = {}): Markup =>
    ({ id: "p1", page: 0, kind: "polygon", vertices: [[100, 100], [200, 100], [200, 150], [100, 150]], style: kindOf("polygon").defaultStyle(), meta, ...extra }) as Markup;
  const cloudM = (): Markup =>
    ({ id: "c1", page: 0, kind: "cloud", vertices: [[100, 100], [200, 100], [200, 150], [100, 150]], intensity: 1, style: kindOf("cloud").defaultStyle(), meta }) as Markup;

  for (const make of [poly, cloudM]) {
    const name = make().kind;
    it(`${name}: turns a quarter about the middle of its box, and back`, () => {
      const m = make();
      const def = kindOf(m.kind);
      const q = def.turnBy!(m as never, 90) as Markup & { vertices: Pt[] };
      const b = shapeBounds(q);
      // 100 by 50 becomes 50 by 100, same middle.
      close([b[2] - b[0], b[3] - b[1]], [50, 100]);
      close(centreOf(b), [150, 125]);
      const back = def.turnBy!(q as never, -90) as Markup & { vertices: Pt[] };
      back.vertices.forEach((p, i) => close(p, (m as Markup & { vertices: Pt[] }).vertices[i]));
    });

    it(`${name}: has a rotate grip above its box, and turns by it`, () => {
      const m = make();
      const hs = handles(m, 1);
      const grip = hs.find((h) => h.id === "rotate")!;
      close(grip.at, [150, 100 - ROTATE_GAP_PX]);
      // Dragged round to the right of the middle: a quarter turn clockwise (snapped from 88).
      const p = turnPt([150, 0], [150, 125], 88);
      const q = dragHandle(m, "rotate", p, false) as Markup & { vertices: Pt[] };
      const b = shapeBounds(q);
      close([b[2] - b[0], b[3] - b[1]], [50, 100]);
    });
  }

  for (const make of [poly, cloudM]) {
    it(`${make().kind}: the rotate grip goes round with it, and dragging it back up undoes the turn`, () => {
      const m = make();
      const q = kindOf(m.kind).turnBy!(m as never, 90) as Markup & { angle?: number };
      expect(q.angle).toBe(90);
      // Its own top now faces right: the grip sits right of the middle, half its height (25) plus the gap away.
      const g = handles(q, 1).find((h) => h.id === "rotate")!;
      close(g.at, [150 + 25 + ROTATE_GAP_PX, 125]);
      close(g.stem!, [175, 125]);
      // Dragged straight up again: upright, as it was.
      const back = dragHandle(q, "rotate", [150, 0], false) as Markup & { vertices: Pt[]; angle?: number };
      expect(back.angle).toBeUndefined();
      back.vertices.forEach((p, i) => close(p, (m as Markup & { vertices: Pt[] }).vertices[i]));
    });
  }

  for (const make of [poly, cloudM]) {
    it(`${make().kind}: its box grips turn with it, and resize it along its own sides`, () => {
      const m = make();
      const def = kindOf(m.kind);
      // Turned 30 degrees: the east grip sits on its own right side, 50 out from the middle.
      const q = def.turnBy!(m as never, 30) as Markup & { vertices: Pt[]; angle?: number };
      const e = handles(q, 1).find((h) => h.id === "e")!;
      close(e.at, turnPt([200, 125], [150, 125], 30));
      expect(turnOf(q)).toBe(30);
      // Dragged 20 further out along its own width: 120 by 50 in its own frame, still turned 30.
      const r = dragHandle(q, "e", turnPt([220, 125], [150, 125], 30), false) as Markup & { vertices: Pt[]; angle?: number };
      expect(r.angle).toBe(30);
      const own = r.vertices.map((p) => turnPt(p, [0, 0], -30));
      const xs = own.map((p) => p[0]), ys = own.map((p) => p[1]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(120, 6);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(50, 6);
    });
  }

  it("a regular polygon stays regular when turned, so Sides still works", () => {
    const def = kindOf("polygon");
    const reg = { centre: [150, 150] as Pt, radius: 50, angle: 0, sides: 6 };
    const m = poly({ vertices: regularVerticesOf(reg), regular: reg });
    const q = def.turnBy!(m as never, 30) as Markup;
    expect(def.sides!(q as never)).toBe(6);
    expect(def.sides!(def.withSides!(q as never, 5) as never)).toBe(5);
  });
});

describe("a picture's border (Matt's review)", () => {
  it("draws a border round a picture only with a weight, turned with it, and never round a signature", () => {
    const strokes = (m: StampMarkup) => (opsFor(m).filter((o) => o.t === "path") as PathOp[]).filter((o) => o.stroke);
    const pic = mk(picture, [100, 100, 300, 200]);
    expect(strokes(pic)).toEqual([]);
    const framed = { ...pic, style: { ...pic.style, width: 2, stroke: [1, 0, 0] as [number, number, number] } };
    const [b] = strokes(framed);
    expect(b.width).toBe(2);
    expect(b.stroke).toEqual([1, 0, 0]);
    // Turned a quarter, the border's corners go round with the picture.
    const turned = strokes({ ...framed, angle: 90 })[0];
    const first = turned.segs[0] as ["M", number, number];
    close([first[1], first[2]], turnPt([100, 100], [200, 150], 90));
    const sig = { ...mk(zigzag, [0, 0, 100, 30], 0, true), style: { ...framed.style } };
    expect(strokes(sig).filter((o) => o.width === 2)).toEqual([]);
  });
});

describe("cropping a picture (Matt's review)", () => {
  // 200 by 100 pixels, shown 200 by 100 points.
  const pic = () => mk(picture, [100, 100, 300, 200]);

  it("trims an edge to the pointer, keeps the others where they are, and remembers which part shows", () => {
    const m = dragCrop(pic(), "e", [250, 150]);
    expect(m.rect).toEqual([100, 100, 250, 200].map((v) => expect.closeTo(v, 6)));
    expect((m.content as ImageContent).crop).toEqual([0, 0, 0.75, 1].map((v) => expect.closeTo(v, 6)));
    // Its shape follows: three quarters as wide, so a resize keeps that.
    expect(aspectOf(m.content)).toBeCloseTo(1.5, 6);
    // A corner trims two edges.
    const c = dragCrop(m, "nw", [120, 125]);
    expect((c.content as ImageContent).crop).toEqual([0.1, 0.25, 0.75, 1].map((v) => expect.closeTo(v, 6)));
    expect(c.rect).toEqual([120, 125, 250, 200].map((v) => expect.closeTo(v, 6)));
  });

  it("goes no further out than the picture, and no smaller than its minimum", () => {
    const m = dragCrop(pic(), "e", [250, 150]);
    // Dragged back out past the picture's edge: all of it again, no more.
    const back = dragCrop(m, "e", [400, 150]);
    expect(back.rect[2]).toBeCloseTo(300, 6);
    expect((back.content as ImageContent).crop).toBeUndefined();
    const tiny = dragCrop(pic(), "w", [299, 150], 8);
    expect(tiny.rect[2] - tiny.rect[0]).toBeCloseTo(8, 6);
  });

  it("crops in its own frame when turned, the far edges staying put on the page", () => {
    const m = mk(picture, [100, 100, 300, 200], 90);
    const before = turnedCorners(m.rect, 90);
    // Turned a quarter, its own right-hand edge faces down the page: drag it up by 50.
    const e = cropHandles(m).find((h) => h.id === "e")!;
    const c = dragCrop(m, "e", [e.at[0], e.at[1] - 50]);
    expect((c.content as ImageContent).crop![2]).toBeCloseTo(0.75, 6);
    const after = turnedCorners(c.rect, 90);
    // Its own left edge (top left and bottom left) hasn't moved.
    close(after[0], before[0]);
    close(after[3], before[3]);
  });

  it("draws only what shows, on screen and in the file (the whole picture clipped to its box), and saves the crop", () => {
    const m = dragCrop(pic(), "w", [150, 150]);
    const op = opsFor(m).find((o) => o.t === "image") as ImageOp;
    expect(op.rect).toEqual(m.rect);
    expect(op.crop).toEqual([0.25, 0, 1, 1].map((v) => expect.closeTo(v, 6)));
    const ops = toSpec(m, A4).appearance.ops;
    expect(ops).toContain("W n");
    // The whole picture is 200 wide, its left edge 50 points left of the box.
    expect(ops).toContain("200 0 0 100 100 642 cm");
    expect(JSON.parse(reeditEntry(m)).markup.content.crop).toEqual(op.crop);
  });

  it("puts the whole picture back round what showed", () => {
    const m = dragCrop(dragCrop(pic(), "w", [150, 150]), "s", [200, 180]);
    const u = uncropped(m);
    expect((u.content as ImageContent).crop).toBeUndefined();
    expect(u.rect).toEqual([100, 100, 300, 200].map((v) => expect.closeTo(v, 6)));
    expect(wholeBox(m)).toEqual([100, 100, 300, 200].map((v) => expect.closeTo(v, 6)));
  });

  it("isn't offered for a signature or a text stamp", () => {
    expect(canCrop(pic())).toBe(true);
    expect(canCrop(mk(zigzag, [0, 0, 100, 30], 0, true))).toBe(false);
    expect(canCrop(mk(approved, [0, 0, 100, 30]))).toBe(false);
  });
});
