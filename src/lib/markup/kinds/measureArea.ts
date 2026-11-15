// Area: click the corners, then click the first again, double-click or press Enter (or drag a
// box). The outline with its area and perimeter centred inside it. Saved as a Polygon
// annotation with the PolygonDimension intent and a /Measure dictionary.

import type { MarkupBase, Pt } from "../base";
import { type Seg, filled } from "../draw";
import { userPoints } from "../annotation";
import { distToPolyline, dragPointGrip, insidePolygon, movePt, pointGrips, pointsBounds } from "../shape";
import { formatArea, formatLength, formatPaper, formatPaperArea, labelPoint, paperMm, paperMm2, pathLength, polygonArea, realMm, realMm2, selfCrossing } from "../measure";
import { type MeasureFields, MEASURE_STYLE, labelAt, measureSpec, newMeasure, pageMeasureOf, settleMeasure } from "../dimension";
import { defineKind } from "./kind";

export interface MeasureAreaMarkup extends MarkupBase, MeasureFields {
  kind: "measureArea";
  vertices: Pt[];
}

declare module "../base" {
  interface MarkupKinds {
    measureArea: MeasureAreaMarkup;
  }
}

export interface AreaValues {
  /** "12.40 m²", or null with no scale. */
  real: string | null;
  realPerimeter: string | null;
  paper: string;
  paperPerimeter: string;
  /** The outline crosses itself: the area nets its lobes against each other. */
  crosses: boolean;
  realPerimeterMm: number | null;
}

export function areaValues(m: MeasureAreaMarkup): AreaValues {
  const pm = pageMeasureOf(m);
  const a = polygonArea(m.vertices), p = pathLength(m.vertices, true);
  const ra = realMm2(a, pm), rp = realMm(p, pm);
  return {
    real: ra === null ? null : formatArea(ra, m.fmt),
    realPerimeter: rp === null ? null : formatLength(rp, m.fmt),
    paper: formatPaperArea(paperMm2(a, pm.userUnit)),
    paperPerimeter: formatPaper(paperMm(p, pm.userUnit)),
    crosses: selfCrossing(m.vertices),
    realPerimeterMm: rp,
  };
}

/** Its label's lines: the area, then the perimeter (paper values, marked, with no scale). */
export function areaLabel(m: MeasureAreaMarkup): string[] {
  const v = areaValues(m);
  const lines = v.real !== null ? [v.real, `Perimeter ${v.realPerimeter}`] : [`${v.paper} (paper)`, `Perimeter ${v.paperPerimeter}`];
  if (v.crosses) lines.push("Outline crosses itself");
  return lines;
}

const closedPath = (v: Pt[]): Seg[] => [["M", v[0][0], v[0][1]], ...v.slice(1).map((p) => ["L", p[0], p[1]] as Seg), ["Z"]];

export const measureArea = defineKind<MeasureAreaMarkup>({
  kind: "measureArea",
  label: "Area",
  defaultStyle: () => ({ ...MEASURE_STYLE }),
  controls: { fill: true, ends: false, text: false },
  draw: { gesture: "points", make: (vertices) => ({ vertices, ...newMeasure() }), closed: true, min: 3, drag: "box" },
  ops(m) {
    if (m.vertices.length < 2) return [];
    const outline = closedPath(m.vertices);
    return [...filled(outline, () => outline, m.style), labelAt(areaLabel(m), labelPoint(m.vertices), m.labelSize, m.style.stroke)];
  },
  spec(m, f, spec) {
    spec.subtype = "Polygon";
    spec.vertices = userPoints(f, m.vertices);
    spec.intent = "PolygonDimension";
    spec.contents = areaLabel(m).join(", ");
    // Areas are written in m² unless always-mm is chosen (formatArea), so the unit is too.
    spec.measure = measureSpec(pageMeasureOf(m), m.fmt, Infinity);
  },
  bounds: (m) => pointsBounds(m.vertices),
  hits(m, p, t) {
    if (m.style.fill && insidePolygon(p, m.vertices)) return true;
    return distToPolyline(p, m.vertices, true) <= t;
  },
  handles: (m) => pointGrips(m.vertices),
  dragHandle: (m, h, p, constrain, minSize) => dragPointGrip(m, h, p, constrain, minSize, true),
  moveBy: (m, dx, dy) => ({ ...m, vertices: m.vertices.map((v) => movePt(v, dx, dy)) }),
  finish: settleMeasure,
});
