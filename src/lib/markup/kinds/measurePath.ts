// Polyline length: click points, double-click or Enter to finish (or drag a straight run);
// Shift snaps each point to 15 degrees. A dimension line through the points with the total
// length above its longest segment. Saved as a PolyLine annotation with the PolyLineDimension
// intent and a /Measure dictionary.

import type { MarkupBase, Pt } from "../base";
import { userPoints } from "../annotation";
import { distToPolyline, dragPointGrip, movePt, pointGrips, pointsBounds } from "../shape";
import { formatLength, formatPaper, paperMm, pathLength, realMm, uprightDir } from "../measure";
import { type MeasureFields, MEASURE_STYLE, barHalf, dimensionLine, labelAlong, measureSpec, newMeasure, pageMeasureOf, settleMeasure } from "../dimension";
import { defineKind } from "./kind";

export interface MeasurePathMarkup extends MarkupBase, MeasureFields {
  kind: "measurePath";
  vertices: Pt[];
}

declare module "../base" {
  interface MarkupKinds {
    measurePath: MeasurePathMarkup;
  }
}

/** Its values: the whole run's length, real-world (null with no scale) and on paper. */
export function pathValues(m: MeasurePathMarkup): { real: string | null; paper: string; realMm: number | null } {
  const pm = pageMeasureOf(m);
  const d = pathLength(m.vertices);
  const r = realMm(d, pm);
  return { real: r === null ? null : formatLength(r, m.fmt), paper: formatPaper(paperMm(d, pm.userUnit)), realMm: r };
}

export const pathLabel = (m: MeasurePathMarkup): string => {
  const v = pathValues(m);
  return v.real ?? `${v.paper} (paper)`;
};

/** The longest segment's index (where the label goes). */
function longest(v: Pt[]): number {
  let best = 0, d = -1;
  for (let i = 0; i + 1 < v.length; i++) {
    const l = Math.hypot(v[i + 1][0] - v[i][0], v[i + 1][1] - v[i][1]);
    if (l > d + 1e-9) {
      d = l;
      best = i;
    }
  }
  return best;
}

export const measurePath = defineKind<MeasurePathMarkup>({
  kind: "measurePath",
  label: "Polyline length",
  defaultStyle: () => ({ ...MEASURE_STYLE }),
  controls: { fill: false, ends: false, text: false },
  draw: { gesture: "points", make: (vertices) => ({ vertices, ...newMeasure() }), closed: false, min: 2, drag: "line" },
  ops(m) {
    if (m.vertices.length < 2) return [];
    const i = longest(m.vertices);
    const a = m.vertices[i], b = m.vertices[i + 1];
    return [...dimensionLine(m.vertices, m.style), labelAlong(pathLabel(m), a, b, m.labelSize, m.style.stroke, barHalf(m.style.width) * 0.5 + 1, uprightDir(a, b))];
  },
  spec(m, f, spec) {
    spec.subtype = "PolyLine";
    spec.vertices = userPoints(f, m.vertices);
    delete spec.interior;
    spec.intent = "PolyLineDimension";
    spec.contents = pathLabel(m);
    spec.measure = measureSpec(pageMeasureOf(m), m.fmt, pathValues(m).realMm ?? 0);
  },
  bounds: (m) => pointsBounds(m.vertices),
  hits: (m, p, t) => distToPolyline(p, m.vertices, false) <= t,
  handles: (m) => pointGrips(m.vertices),
  dragHandle: (m, h, p, constrain, minSize) => dragPointGrip(m, h, p, constrain, minSize, false),
  moveBy: (m, dx, dy) => ({ ...m, vertices: m.vertices.map((v) => movePt(v, dx, dy)) }),
  finish: settleMeasure,
});
