// Every kind through the registry, and the four plain shapes (line, ellipse, polyline,
// polygon): drawing operations, annotation spec, hit-testing, grips and resizing.

import { describe, expect, it } from "vitest";
import { type Markup, type MarkupKind, type MarkupOf, type Pt, defaultStyle } from "../types";
import { type PathOp, endedLine, opsBounds, opsFor } from "../ops";
import { toSpec } from "../spec";
import { dragHandle, handles, hits, moveBy, shapeBounds } from "../geometry";
import { sanitisePrefs } from "../prefs";
import type { Frame } from "../pdf";
import { KINDS, kindOf, labelOf } from ".";
import { insetPolygon } from "./polygon";

const A4: Frame = { quarterTurns: 0, bbox: [0, 0, 595, 842] };
const meta = { author: "Tester", created: "2026-11-15T10:00:00Z", modified: "2026-11-15T10:00:00Z" };

function mk<K extends MarkupKind>(kind: K, shape: Record<string, unknown>, style: Record<string, unknown> = {}): MarkupOf<K> {
  return { id: `t-${kind}`, page: 0, kind, style: { ...defaultStyle(kind), ...style }, meta, ...shape } as unknown as MarkupOf<K>;
}

/** A sample of each kind, for the checks every kind must pass. */
const SAMPLES: { [K in MarkupKind]: () => MarkupOf<K> } = {
  rect: () => mk("rect", { rect: [100, 100, 200, 150] }),
  arrow: () => mk("arrow", { from: [100, 100], to: [200, 150] }),
  cloud: () => mk("cloud", { vertices: [[100, 100], [200, 100], [200, 150], [100, 150]], intensity: 1 }),
  text: () => mk("text", { rect: [100, 100, 260, 130], text: "Note", textStyle: { size: 10, colour: [0, 0, 0] } }),
  ink: () => mk("ink", { strokes: [[[100, 100], [150, 130], [200, 150]]] }),
  ellipse: () => mk("ellipse", { rect: [100, 100, 200, 150] }),
  polyline: () => mk("polyline", { vertices: [[100, 100], [150, 150], [200, 100]] }),
  polygon: () => mk("polygon", { vertices: [[100, 100], [200, 100], [150, 150]] }),
  // Measuring
  measureLength: () => mk("measureLength", { from: [100, 100], to: [200, 150], scale: 100, userUnit: 1, fmt: { units: "auto", decimals: 2 }, labelSize: 8 }),
  measurePath: () => mk("measurePath", { vertices: [[100, 100], [150, 150], [200, 100]], scale: 100, userUnit: 1, fmt: { units: "auto", decimals: 2 }, labelSize: 8 }),
  measureArea: () => mk("measureArea", { vertices: [[100, 100], [200, 100], [150, 150]], scale: 100, userUnit: 1, fmt: { units: "auto", decimals: 2 }, labelSize: 8 }),
  measureAngle: () => mk("measureAngle", { vertices: [[200, 100], [100, 100], [150, 150]], scale: null, userUnit: 1, fmt: { units: "auto", decimals: 2 }, labelSize: 8 }),
  measureCalibrate: () => mk("measureCalibrate", { from: [100, 100], to: [200, 150], scale: null, userUnit: 1, fmt: { units: "auto", decimals: 2 }, labelSize: 8 }),
};

const paths = (m: Markup) => opsFor(m).filter((o): o is PathOp => o.t === "path");
const segKinds = (m: Markup) => paths(m).flatMap((o) => o.segs.map((s) => s[0]));

describe("the kind registry", () => {
  const kinds = Object.keys(KINDS) as MarkupKind[];

  it("has a definition named after its key, with a label and a gesture", () => {
    for (const k of kinds) {
      expect(kindOf(k).kind).toBe(k);
      expect(kindOf(k).label.length).toBeGreaterThan(0);
      expect(["line", "box", "points", "freehand", "place"]).toContain(kindOf(k).draw.gesture);
    }
    expect(() => kindOf("nonsense" as MarkupKind)).toThrow();
  });

  it("draws, saves, bounds, picks, grips and moves a sample of every kind", () => {
    for (const k of kinds) {
      const m = SAMPLES[k]();
      expect(opsFor(m).length, k).toBeGreaterThan(0);
      const spec = toSpec(m, A4);
      expect(spec.nm).toBe(m.id);
      expect(spec.subtype.length).toBeGreaterThan(0);
      const b = shapeBounds(m);
      expect(b[2]).toBeGreaterThan(b[0]);
      expect(handles(m).length, k).toBeGreaterThan(0);
      const moved = moveBy(m, 10, 5);
      const mb = shapeBounds(moved);
      expect(mb[0]).toBeCloseTo(b[0] + 10);
      expect(mb[1]).toBeCloseTo(b[1] + 5);
      // The first grip, dragged a little, keeps the kind.
      const h = handles(m)[0];
      expect(dragHandle(m, h.id, [h.at[0] - 5, h.at[1] - 5], false).kind).toBe(k);
    }
  });

  it("remembers each kind's style, keeping ends only where the kind has them", () => {
    const styles: Record<string, unknown> = {};
    for (const k of kinds) styles[k] = { ...defaultStyle(k), ends: ["dot", "bar"] };
    const p = sanitisePrefs({ styles });
    for (const k of kinds) {
      if (kindOf(k).controls.ends) expect(p.styles[k]?.ends).toEqual(["dot", "bar"]);
      else expect(p.styles[k]?.ends).toBeUndefined();
    }
  });
});

describe("line (an arrow with no ends)", () => {
  const line = () => mk("arrow", { from: [100, 100], to: [200, 100] }, { ends: ["none", "none"] });

  it("is called a line, draws one stroke and saves as a Line with no ends", () => {
    expect(labelOf(line())).toBe("Line");
    expect(labelOf(SAMPLES.arrow())).toBe("Arrow");
    expect(paths(line()).length).toBe(1);
    const spec = toSpec(line(), A4);
    expect(spec.subtype).toBe("Line");
    expect(spec.lineEnds).toEqual(["None", "None"]);
    expect(spec.interior).toBeUndefined();
  });
});

describe("ellipse", () => {
  it("draws four quarter curves inside its box", () => {
    const e = SAMPLES.ellipse();
    expect(segKinds(e).filter((s) => s === "C").length).toBe(4);
    const b = opsBounds(opsFor(e));
    // The outline's box plus half the line and the one-point margin.
    expect(b[0]).toBeGreaterThanOrEqual(97);
    expect(b[2]).toBeLessThanOrEqual(203);
  });

  it("fills inside the line's inner edge", () => {
    const e = mk("ellipse", { rect: [100, 100, 200, 150] }, { fill: [1, 1, 0], width: 4 });
    const [fill, line] = paths(e);
    expect(fill.fill).toEqual([1, 1, 0]);
    expect(fill.stroke).toBeNull();
    expect(line.stroke).not.toBeNull();
    // The fill's right-hand end sits half the weight in from the outline's.
    expect((fill.segs[0] as ["M", number, number])[1]).toBeCloseTo(198);
    expect((line.segs[0] as ["M", number, number])[1]).toBeCloseTo(200);
  });

  it("saves as a Circle with /RD to the drawn ellipse", () => {
    const spec = toSpec(SAMPLES.ellipse(), A4);
    expect(spec.subtype).toBe("Circle");
    expect(spec.inset?.every((v) => v >= 0 && v < 2)).toBe(true);
  });

  it("is picked on its outline, and inside only when filled", () => {
    const e = SAMPLES.ellipse();
    expect(hits(e, [200, 125], 2)).toBe(true); // the right-hand end
    expect(hits(e, [150, 100.5], 2)).toBe(true); // the top
    expect(hits(e, [150, 125], 2)).toBe(false); // the middle, unfilled
    expect(hits(e, [102, 102], 2)).toBe(false); // the box's corner is outside the ellipse
    expect(hits({ ...e, style: { ...e.style, fill: [1, 1, 1] } }, [150, 125], 2)).toBe(true);
  });

  it("resizes by its box's grips, Shift keeping its proportions", () => {
    const e = SAMPLES.ellipse();
    expect(handles(e).length).toBe(8);
    const r = dragHandle(e, "se", [300, 300], true) as MarkupOf<"ellipse">;
    expect((r.rect[2] - r.rect[0]) / (r.rect[3] - r.rect[1])).toBeCloseTo(2);
  });
});

describe("polyline", () => {
  it("draws one open stroke through its points", () => {
    const p = SAMPLES.polyline();
    const [op] = paths(p);
    expect(op.fill).toBeNull();
    expect(segKinds(p)).toEqual(["M", "L", "L"]);
    expect(segKinds(p)).not.toContain("Z");
  });

  it("draws its ends at the first and last points, facing outwards", () => {
    const p = mk("polyline", { vertices: [[100, 100], [150, 100], [150, 200]] }, { ends: ["none", "filled"] });
    const ops = paths(p);
    // A filled head: a solid triangle in the line's colour with its tip on the last point.
    const head = ops[1];
    expect(head.fill).toEqual(p.style.stroke);
    expect(head.segs[0]).toEqual(["M", 150, 200]);
    // The line stops short of the filled head.
    const last = ops[0].segs[ops[0].segs.length - 1] as ["L", number, number];
    expect(last[2]).toBeLessThan(200);
  });

  it("matches the arrow's drawing for two points", () => {
    const style = { ...defaultStyle("arrow"), ends: ["dot", "filled"] as ["dot", "filled"] };
    const a = mk("arrow", { from: [10, 20], to: [90, 70] }, style);
    expect(endedLine([[10, 20], [90, 70]], ["dot", "filled"], a.style)).toEqual(opsFor(a));
  });

  it("saves as a PolyLine with its vertices and ends", () => {
    const spec = toSpec(mk("polyline", { vertices: [[100, 100], [150, 150], [200, 100]] }, { ends: ["open", "dot"] }), A4);
    expect(spec.subtype).toBe("PolyLine");
    // y flips into user space on an unrotated page.
    expect(spec.vertices).toEqual([100, 742, 150, 692, 200, 742]);
    expect(spec.lineEnds).toEqual(["OpenArrow", "Circle"]);
    expect(spec.interior).toEqual([0.85, 0.1, 0.1]);
  });

  it("is picked on its segments only", () => {
    const p = SAMPLES.polyline();
    expect(hits(p, [125, 125], 2)).toBe(true);
    expect(hits(p, [150, 100], 2)).toBe(false); // between the ends, where a closed shape's edge would be
  });

  it("drags each point, Shift snapping it to 15 degrees from the one before", () => {
    const p = SAMPLES.polyline();
    expect(handles(p).map((h) => h.id)).toEqual(["v0", "v1", "v2"]);
    const moved = dragHandle(p, "v2", [250, 153], true) as MarkupOf<"polyline">;
    expect(moved.vertices[2][1]).toBeCloseTo(150); // level with v1
    const first = dragHandle(p, "v0", [100, 152], true) as MarkupOf<"polyline">;
    expect(first.vertices[0][1]).toBeCloseTo(150); // the first point snaps from the second
  });
});

describe("polygon", () => {
  const tri = () => SAMPLES.polygon();

  it("draws a closed outline and saves as a Polygon", () => {
    expect(segKinds(tri())).toContain("Z");
    const spec = toSpec(tri(), A4);
    expect(spec.subtype).toBe("Polygon");
    expect(spec.vertices?.length).toBe(6);
    expect(spec.intent).toBeUndefined();
    expect(spec.cloud).toBeUndefined();
  });

  it("fills inside the line and saves the fill as /IC", () => {
    const p = mk("polygon", { vertices: [[100, 100], [200, 100], [200, 200], [100, 200]] }, { fill: [0.9, 0.9, 0.9], width: 4 });
    const [fill] = paths(p);
    expect(fill.segs[0][1]).toBeCloseTo(102);
    expect(fill.segs[0][2]).toBeCloseTo(102);
    expect(toSpec(p, A4).interior).toEqual([0.9, 0.9, 0.9]);
  });

  it("insets either winding inwards, holding sharp corners", () => {
    const sq: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(insetPolygon(sq, 1)).toEqual([[1, 1], [9, 1], [9, 9], [1, 9]].map((p) => p.map((v) => expect.closeTo(v, 9))));
    const back = insetPolygon([...sq].reverse(), 1);
    expect(back[0][0]).toBeCloseTo(1);
    expect(back[0][1]).toBeCloseTo(9);
    // A needle: the corner moves at most 4 d.
    const needle: Pt[] = [[0, 0], [100, 1], [0, 2]];
    const tip = insetPolygon(needle, 1)[1];
    expect(Math.hypot(tip[0] - 100, tip[1] - 1)).toBeLessThanOrEqual(4.0001);
  });

  it("is picked on its edges, and inside when filled", () => {
    const p = tri();
    expect(hits(p, [150, 100], 2)).toBe(true);
    expect(hits(p, [150, 115], 2)).toBe(false);
    expect(hits({ ...p, style: { ...p.style, fill: [1, 1, 1] } }, [150, 115], 2)).toBe(true);
  });

  it("drags a corner, Shift snapping it from the corner before (the last, for the first)", () => {
    const p = mk("polygon", { vertices: [[100, 100], [200, 100], [200, 200]] });
    const m = dragHandle(p, "v0", [150, 203], true) as MarkupOf<"polygon">;
    expect(m.vertices[0][1]).toBeCloseTo(200);
  });
});
