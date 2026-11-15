// Area: click the corners, then click the first again, double-click or press Enter (or drag a
// box); each corner starts level or upright with the one before and Shift frees it. The outline
// with its area and perimeter centred inside it; the value's grip moves it, a double-click on
// the grip puts it back. Saved as a Polygon
// annotation with the PolygonDimension intent and a /Measure dictionary.

import type { MarkupBase, Pt } from "../base";
import { type Seg, add, filled, sub } from "../draw";
import { userPoints } from "../annotation";
import { distToPolyline, dragPointGrip, insidePolygon, movePt, pointGrips, pointsBounds } from "../shape";
import { formatArea, formatLength, formatPaper, formatPaperArea, labelPoint, paperMm, paperMm2, pathLength, polygonArea, realMm, realMm2, selfCrossing } from "../measure";
import { type MeasureFields, MEASURE_STYLE, faceOf, labelAt, labelSize, measureSpec, newMeasure, onLabel, pageMeasureOf, settleMeasure } from "../dimension";
import { defineKind } from "./kind";

export interface MeasureAreaMarkup extends MarkupBase, MeasureFields {
  kind: "measureArea";
  vertices: Pt[];
  /** Stage 5: how far the value has been moved from its place, page points (undefined: not moved). */
  value?: Pt;
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

/** Where its value is: centred in the shape, plus any move (stage 5); and its home. */
export function areaValueAt(m: MeasureAreaMarkup): { centre: Pt; home: Pt } {
  const home = labelPoint(m.vertices);
  return { centre: add(home, m.value ?? [0, 0]), home };
}

export const measureArea = defineKind<MeasureAreaMarkup>({
  kind: "measureArea",
  label: "Area",
  defaultStyle: () => ({ ...MEASURE_STYLE }),
  controls: { fill: true, ends: false, text: false },
  // Stage 5: each corner starts level or upright with the one before (a dimension); Shift frees it.
  draw: { gesture: "points", make: (vertices) => ({ vertices, ...newMeasure() }), closed: true, min: 3, drag: "box", lock: "ortho", preview: true },
  ops(m) {
    if (m.vertices.length < 2) return [];
    const outline = closedPath(m.vertices);
    return [...filled(outline, () => outline, m.style), labelAt(areaLabel(m), areaValueAt(m).centre, m.labelSize, m.style.stroke, faceOf(m.font))];
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
    if (distToPolyline(p, m.vertices, true) <= t) return true;
    // Its value, wherever it's been moved to.
    return m.vertices.length >= 2 && onLabel(p, areaValueAt(m).centre, labelSize(areaLabel(m), m.labelSize, faceOf(m.font)), [1, 0], t);
  },
  // Corners and its box (stage 6), and its value (stage 5).
  handles: (m) => [...pointGrips(m.vertices), ...(m.vertices.length >= 3 ? [{ id: "value" as const, at: areaValueAt(m).centre }] : [])],
  dragHandle(m, h, p, constrain, minSize) {
    if (h === "value") return { ...m, value: sub(p, areaValueAt(m).home) };
    return dragPointGrip(m, h, p, constrain, minSize, true);
  },
  resetHandle(m, h) {
    if (h !== "value" || !m.value) return null;
    const { value: _, ...rest } = m;
    return rest;
  },
  moveBy: (m, dx, dy) => ({ ...m, vertices: m.vertices.map((v) => movePt(v, dx, dy)) }),
  finish: settleMeasure,
});
