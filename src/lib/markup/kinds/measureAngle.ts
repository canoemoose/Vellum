// Angle: three clicks, one arm's end, the corner, the other arm's end; Shift snaps each to 15
// degrees from the last. The two arms, an arc at the corner and the angle beside it. PDF has
// no angle dimension, so it's saved as a plain PolyLine with the value in /Contents.

import type { MarkupBase, Pt } from "../base";
import { type Seg, add, arc, len, mul, path, sub, unit } from "../draw";
import { userPoints } from "../annotation";
import { distToPolyline, dragPoint, movePt, pointsBounds, vertexHandles } from "../shape";
import { angleAt, formatAngle } from "../measure";
import { type MeasureFields, MEASURE_STYLE, labelAt, labelSize, newMeasure, settleMeasure } from "../dimension";
import { defineKind } from "./kind";

export interface MeasureAngleMarkup extends MarkupBase, MeasureFields {
  kind: "measureAngle";
  /** One arm's end, the corner, the other arm's end. */
  vertices: Pt[];
}

declare module "../base" {
  interface MarkupKinds {
    measureAngle: MeasureAngleMarkup;
  }
}

/** The angle in degrees (0 until it has its three points). */
export const angleOf = (m: MeasureAngleMarkup): number => (m.vertices.length < 3 ? 0 : angleAt(m.vertices[0], m.vertices[1], m.vertices[2]));

export const angleLabel = (m: MeasureAngleMarkup): string => formatAngle(angleOf(m));

/** The arc's radius: well inside the shorter arm, readable, never huge. */
export function arcRadius(a: Pt, c: Pt, b: Pt): number {
  const arm = Math.min(len(sub(a, c)), len(sub(b, c)));
  return Math.max(2, Math.min(arm * 0.4, 24));
}

export const measureAngle = defineKind<MeasureAngleMarkup>({
  kind: "measureAngle",
  label: "Angle",
  defaultStyle: () => ({ ...MEASURE_STYLE }),
  controls: { fill: false, ends: false, text: false },
  draw: { gesture: "points", make: (vertices) => ({ vertices, ...newMeasure() }), closed: false, min: 3, max: 3, drag: "line", say: "click one arm's end, the corner, then the other arm's end" },
  ops(m) {
    const v = m.vertices;
    const arms: Seg[] = v.map((p, i) => [i ? "L" : "M", p[0], p[1]] as Seg);
    if (v.length < 3) return [path(arms, m.style, null)];
    const [a, c, b] = v;
    const ua = unit(sub(a, c)), ub = unit(sub(b, c));
    // The bisector of the angle measured (under 180), or square to the arms when they're in line.
    let bis = add(ua, ub);
    bis = len(bis) < 1e-6 ? [-ua[1], ua[0]] : unit(bis);
    const r = arcRadius(a, c, b);
    const arcSegs = len(sub(a, c)) > 0 && len(sub(b, c)) > 0 ? arc(c, r, ua, ub, bis) : [];
    const start = add(c, mul(ua, r));
    const text = angleLabel(m);
    // Beside the arc, out along the bisector, far enough that the label's box clears it.
    const [w, h] = labelSize([text], m.labelSize);
    const out = r + 2 + Math.abs(bis[0]) * (w / 2) + Math.abs(bis[1]) * (h / 2);
    return [
      path(arms, m.style, null),
      ...(arcSegs.length ? [path([["M", start[0], start[1]], ...arcSegs], { ...m.style, dash: null }, null)] : []),
      labelAt([text], add(c, mul(bis, out)), m.labelSize, m.style.stroke),
    ];
  },
  spec(m, f, spec) {
    spec.subtype = "PolyLine";
    spec.vertices = userPoints(f, m.vertices);
    delete spec.interior;
    spec.contents = `Angle ${angleLabel(m)}`;
  },
  bounds: (m) => pointsBounds(m.vertices),
  hits: (m, p, t) => distToPolyline(p, m.vertices, false) <= t,
  handles: (m) => vertexHandles(m.vertices),
  dragHandle: (m, h, p, constrain) => dragPoint(m, h, p, constrain, false),
  moveBy: (m, dx, dy) => ({ ...m, vertices: m.vertices.map((v) => movePt(v, dx, dy)) }),
  finish: settleMeasure,
});
