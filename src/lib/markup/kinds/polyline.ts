// Polyline: click points, double-click or Enter to finish (or drag a straight line), with a
// style for each end. Saved as a PolyLine annotation.

import { type MarkupBase, type Pt, LINE_STYLE, arrowEnds } from "../base";
import { endedLine } from "../draw";
import { distToPolyline, dragPointGrip, movePt, pointGrips, pointsBounds } from "../shape";
import { lineEndsSpec, userPoints } from "../annotation";
import { defineKind } from "./kind";

export interface PolylineMarkup extends MarkupBase {
  kind: "polyline";
  vertices: Pt[];
}

declare module "../base" {
  interface MarkupKinds {
    polyline: PolylineMarkup;
  }
}

export const polyline = defineKind<PolylineMarkup>({
  kind: "polyline",
  label: "Polyline",
  defaultStyle: () => ({ ...LINE_STYLE, ends: ["none", "none"] }),
  controls: { fill: false, ends: true, text: false },
  draw: { gesture: "points", make: (vertices) => ({ vertices }), closed: false, min: 2, drag: "line" },
  ops: (m) => endedLine(m.vertices, arrowEnds(m.style), m.style),
  spec(m, f, spec) {
    spec.subtype = "PolyLine";
    spec.vertices = userPoints(f, m.vertices);
    lineEndsSpec(spec, m.style);
  },
  bounds: (m) => pointsBounds(m.vertices),
  hits: (m, p, t) => distToPolyline(p, m.vertices, false) <= t,
  handles: (m) => pointGrips(m.vertices),
  dragHandle: (m, h, p, constrain, minSize) => dragPointGrip(m, h, p, constrain, minSize, false),
  moveBy: (m, dx, dy) => ({ ...m, vertices: m.vertices.map((v) => movePt(v, dx, dy)) }),
});
