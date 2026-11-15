// Phase 7a's kinds (docs/editing-phase7-scope.md): the highlighter, the callout, text markups
// and notes. Drawing operations, annotation spec, hit-testing, grips and moving.

import { describe, expect, it } from "vitest";
import { type MarkupKind, type MarkupOf, defaultStyle } from "../types";
import { type PathOp, opsFor } from "../ops";
import { toSpec } from "../spec";
import { toContent } from "../pdf";
import type { Frame } from "../pdf";
import { dragHandle, handles, hits, moveBy } from "../geometry";
import { attachPoint, leader } from "./callout";
import { fitText } from "./text";

const A4: Frame = { quarterTurns: 0, bbox: [0, 0, 595, 842] };
const meta = { author: "Tester", created: "2026-11-15T10:00:00Z", modified: "2026-11-15T10:00:00Z" };

export function mk<K extends MarkupKind>(kind: K, shape: Record<string, unknown>, style: Record<string, unknown> = {}): MarkupOf<K> {
  return { id: `t-${kind}`, page: 0, kind, style: { ...defaultStyle(kind), ...style }, meta, ...shape } as unknown as MarkupOf<K>;
}

const paths = (ops: ReturnType<typeof opsFor>) => ops.filter((o): o is PathOp => o.t === "path");

describe("highlighter", () => {
  const hl = () => mk("highlighter", { strokes: [[[100, 100], [150, 110], [200, 100]]] });

  it("starts yellow, 12 pt, 40% see-through", () => {
    const s = defaultStyle("highlighter");
    expect(s.width).toBe(12);
    expect(s.opacity).toBeCloseTo(0.4);
    expect(s.stroke[0]).toBeGreaterThan(0.9);
    expect(s.stroke[2]).toBeLessThan(0.1);
  });

  it("draws one multiplied stroke", () => {
    const ops = paths(opsFor(hl()));
    expect(ops).toHaveLength(1);
    expect(ops[0].blend).toBe("multiply");
    expect(ops[0].width).toBe(12);
  });

  it("saves as Ink with the multiply blend mode in its graphics state", () => {
    const spec = toSpec(hl(), A4);
    expect(spec.subtype).toBe("Ink");
    expect(spec.blend).toBe("Multiply");
    expect(spec.ink?.[0]).toHaveLength(6);
    expect(spec.appearance.ops).toContain("/GS0 gs");
    expect(spec.appearance.opacity).toBeCloseTo(0.4);
    expect(spec.interior).toBeUndefined();
  });

  it("names /GS0 for a blended path even when it isn't see-through", () => {
    const op: PathOp = { t: "path", segs: [["M", 0, 0], ["L", 10, 0]], stroke: [1, 1, 0], fill: null, width: 2, dash: null, strokeOpacity: 1, fillOpacity: 1, blend: "multiply" };
    const c = toContent(A4, [op]);
    expect(c.ops.match(/\/GS0 gs/g)).toHaveLength(1);
    expect(c.opacity).toBe(1);
    expect(c.fillOpacity).toBe(1);
    // Without a blend, an opaque path names nothing.
    expect(toContent(A4, [{ ...op, blend: undefined }]).opacity).toBeNull();
  });
});

describe("callout", () => {
  const co = (shape: Record<string, unknown> = {}) =>
    mk("callout", { tip: [50, 50], elbow: null, rect: [150, 90, 270, 110], text: "Check", textStyle: { size: 10, colour: [0, 0, 0] }, ...shape });

  it("meets the box at the middle of the side facing the leader", () => {
    expect(attachPoint([100, 100, 200, 140], [50, 120])).toEqual([100, 120]);
    expect(attachPoint([100, 100, 200, 140], [260, 90])).toEqual([200, 120]);
    expect(attachPoint([100, 100, 200, 140], [150, 20])).toEqual([150, 100]);
    expect(attachPoint([100, 100, 200, 140], [150, 300])).toEqual([150, 140]);
    expect(attachPoint([100, 100, 200, 140], [150, 120])).toBeNull();
    expect(leader(co())).toEqual([[50, 50], [150, 100]]);
    expect(leader(co({ elbow: [100, 100] }))).toEqual([[50, 50], [100, 100], [150, 100]]);
  });

  it("draws the leader with its head at the tip, then the box over it", () => {
    const ops = opsFor(co());
    const p = paths(ops);
    // The open head's wings meet at the tip.
    expect(p[0].segs.some((s) => s[0] === "L" && Math.abs(s[1] - 50) < 1e-6 && Math.abs(s[2] - 50) < 1e-6)).toBe(true);
    expect(ops[ops.length - 1].t).toBe("text");
  });

  it("saves as a FreeText callout: /IT, /CL from tip to box, one /LE, and /RD for the box", () => {
    const spec = toSpec(co({ elbow: [100, 100] }), A4);
    expect(spec.subtype).toBe("FreeText");
    expect(spec.intent).toBe("FreeTextCallout");
    expect(spec.contents).toBe("Check");
    // User space, y up: the tip at (50, 842 - 50).
    expect(spec.callout).toEqual([50, 792, 100, 742, 150, 742]);
    expect(spec.lineEnds).toEqual(["OpenArrow"]);
    // The box sits at the top right of /Rect, which reaches down and left to the tip.
    const [l, b, r, t] = spec.inset!;
    expect(spec.rect[0] + l).toBeCloseTo(150, 0);
    expect(spec.rect[2] - r).toBeCloseTo(270, 0);
    expect(spec.rect[3] - t).toBeCloseTo(842 - 90, 0);
    expect(spec.rect[1] + b).toBeCloseTo(842 - 110, 0);
    expect(spec.defaultAppearance).toContain("Tf");
  });

  it("follows the page's rotation into user space", () => {
    const f: Frame = { quarterTurns: 1, bbox: [0, 0, 595, 842] };
    const spec = toSpec(co(), f);
    // toUser for a quarter turn: (x, y) -> (y, x).
    expect(spec.callout!.slice(0, 2)).toEqual([50, 50]);
    expect(spec.rotate).toBe(90);
  });

  it("moves its box and elbow, never its tip", () => {
    const m = moveBy(co({ elbow: [100, 100] }), 10, 5) as MarkupOf<"callout">;
    expect(m.tip).toEqual([50, 50]);
    expect(m.elbow).toEqual([110, 105]);
    expect(m.rect).toEqual([160, 95, 280, 115]);
  });

  it("has grips for the box, the tip and the elbow; the middle grip makes an elbow", () => {
    const m = co();
    const hs = handles(m);
    expect(hs.find((h) => h.id === "from")?.at).toEqual([50, 50]);
    expect(hs.find((h) => h.id === "to")?.at).toEqual([100, 75]);
    const bent = dragHandle(m, "to", [60, 120], false) as MarkupOf<"callout">;
    expect(bent.elbow).toEqual([60, 120]);
    const moved = dragHandle(m, "from", [20, 20], false) as MarkupOf<"callout">;
    expect(moved.tip).toEqual([20, 20]);
    expect(moved.rect).toEqual(m.rect);
    const wider = dragHandle(m, "e", [300, 100], false) as MarkupOf<"callout">;
    expect(wider.rect[2]).toBeCloseTo(300);
    expect(wider.tip).toEqual([50, 50]);
  });

  it("is picked on its box and its leader", () => {
    const m = co();
    expect(hits(m, [200, 100], 1)).toBe(true);
    expect(hits(m, [100, 75], 1)).toBe(true);
    expect(hits(m, [100, 40], 1)).toBe(false);
  });

  it("grows to fit its text, as a text box does", () => {
    const m = fitText(co({ text: "A much longer note that wraps over several lines in a box this narrow" }));
    expect(m.rect[3] - m.rect[1]).toBeGreaterThan(30);
  });
});
