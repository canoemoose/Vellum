// Polygon: click the corners, double-click, Enter or a click on the first corner to finish (or
// drag a box). Saved as a Polygon annotation.

import { type MarkupBase, type Pt, LINE_STYLE } from "../base";
import { type Seg, add, filled, len, mul, signedArea, sub, unit } from "../draw";
import { distToPolyline, dragPoint, insidePolygon, movePt, pointsBounds, vertexHandles } from "../shape";
import { userPoints } from "../annotation";
import { defineKind } from "./kind";

export interface PolygonMarkup extends MarkupBase {
  kind: "polygon";
  vertices: Pt[];
}

declare module "../base" {
  interface MarkupKinds {
    polygon: PolygonMarkup;
  }
}

export const polygon = defineKind<PolygonMarkup>({
  kind: "polygon",
  label: "Polygon",
  defaultStyle: () => ({ ...LINE_STYLE }),
  controls: { fill: true, ends: false, text: false },
  draw: { gesture: "points", make: (vertices) => ({ vertices }), closed: true, min: 3, drag: "box" },
  ops: (m) => (m.vertices.length < 2 ? [] : filled(closedPath(m.vertices), () => closedPath(insetPolygon(m.vertices, m.style.width / 2)), m.style)),
  spec(m, f, spec) {
    spec.subtype = "Polygon";
    spec.vertices = userPoints(f, m.vertices);
  },
  bounds: (m) => pointsBounds(m.vertices),
  hits(m, p, t) {
    if (m.style.fill && insidePolygon(p, m.vertices)) return true;
    return distToPolyline(p, m.vertices, true) <= t;
  },
  handles: (m) => vertexHandles(m.vertices),
  dragHandle: (m, h, p, constrain) => dragPoint(m, h, p, constrain, true),
  moveBy: (m, dx, dy) => ({ ...m, vertices: m.vertices.map((v) => movePt(v, dx, dy)) }),
});

const closedPath = (v: Pt[]): Seg[] => [["M", v[0][0], v[0][1]], ...v.slice(1).map((p) => ["L", p[0], p[1]] as Seg), ["Z"]];

/**
 * The outline moved inwards by d (the line's inner edge, where the fill stops): each corner
 * moved along its bisector so both edges move d. Very sharp corners are held to 4 d, as a line
 * join would be, so they can't shoot across the shape.
 */
export function insetPolygon(v: Pt[], d: number): Pt[] {
  if (d <= 0 || v.length < 3) return v.slice();
  // Inwards is to the right of travel for one winding, the left for the other.
  const s = signedArea(v) > 0 ? 1 : -1;
  const n = v.length;
  return v.map((p, i) => {
    const a = unit(sub(p, v[(i - 1 + n) % n]));
    const b = unit(sub(v[(i + 1) % n], p));
    const na: Pt = [-a[1] * s, a[0] * s];
    const nb: Pt = [-b[1] * s, b[0] * s];
    const bis = add(na, nb);
    const bl = len(bis);
    if (bl < 1e-9) return add(p, mul(na, d));
    const cos = bl / 2; // the bisector against either edge's normal
    return add(p, mul(bis, Math.min(d / cos, 4 * d) / bl));
  });
}
