// Phase 7a's kinds (docs/editing-phase7-scope.md): the highlighter, the callout, text markups
// and notes. Drawing operations, annotation spec, hit-testing, grips and moving.

import { describe, expect, it } from "vitest";
import { type MarkupKind, type MarkupOf, defaultStyle } from "../types";
import { type PathOp, opsFor } from "../ops";
import { toSpec } from "../spec";
import { toContent } from "../pdf";
import type { Frame } from "../pdf";

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

