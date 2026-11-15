// Polyline length: click points, double-click or Enter to finish (or drag a straight run). Each
// point starts level or upright with the one before and Shift frees it (stage 5: dimensions
// start locked). A dimension line through the points with the total length above its longest
// segment; the value's grip moves it and a double-click on the grip puts it back. Saved as a
// PolyLine annotation with the PolyLineDimension intent and a /Measure dictionary.

import type { MarkupBase, Pt } from "../base";
import { add, sub } from "../draw";
import { userPoints } from "../annotation";
import { distToPolyline, dragPointGrip, movePt, pointGrips, pointsBounds } from "../shape";
import { formatLength, formatPaper, paperMm, pathLength, realMm, uprightDir } from "../measure";
import {
  type MeasureFields,
  MEASURE_STYLE,
  dimensionEndsSpec,
  dimensionLine,
  faceOf,
  labelAt,
  labelSize,
  measureSpec,
  newMeasure,
  onLabel,
  pageMeasureOf,
  settleMeasure,
  valueGap,
  valueHome,
} from "../dimension";
import { defineKind } from "./kind";

export interface MeasurePathMarkup extends MarkupBase, MeasureFields {
  kind: "measurePath";
  vertices: Pt[];
  /** Stage 5: how far the value has been moved from its place, page points (undefined: not moved). */
  value?: Pt;
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

/** Where its value is: centred above its longest segment, plus any move; its reading direction and size. */
export function pathValueAt(m: MeasurePathMarkup): { centre: Pt; home: Pt; dir: Pt; size: [number, number] } {
  const i = longest(m.vertices);
  const a = m.vertices[i], b = m.vertices[i + 1] ?? a;
  const dir = uprightDir(a, b);
  const size = labelSize([pathLabel(m)], m.labelSize, faceOf(m.font));
  const home = valueHome(a, b, dir, size[1], valueGap(m.style.width), false);
  return { centre: add(home, m.value ?? [0, 0]), home, dir, size };
}

export const measurePath = defineKind<MeasurePathMarkup>({
  kind: "measurePath",
  label: "Polyline length",
  defaultStyle: () => ({ ...MEASURE_STYLE }),
  controls: { fill: false, ends: false, text: false },
  draw: { gesture: "points", make: (vertices) => ({ vertices, ...newMeasure() }), closed: false, min: 2, drag: "line", lock: "ortho", preview: true },
  ops(m) {
    if (m.vertices.length < 2) return [];
    const { centre, dir } = pathValueAt(m);
    return [...dimensionLine(m.vertices, m.style, m.ends ?? "bar"), labelAt([pathLabel(m)], centre, m.labelSize, m.style.stroke, faceOf(m.font), dir)];
  },
  spec(m, f, spec) {
    spec.subtype = "PolyLine";
    spec.vertices = userPoints(f, m.vertices);
    dimensionEndsSpec(spec, m.ends, m.style);
    spec.intent = "PolyLineDimension";
    spec.contents = pathLabel(m);
    spec.measure = measureSpec(pageMeasureOf(m), m.fmt, pathValues(m).realMm ?? 0);
  },
  bounds: (m) => pointsBounds(m.vertices),
  hits(m, p, t) {
    if (distToPolyline(p, m.vertices, false) <= t) return true;
    if (m.vertices.length < 2) return false;
    const { centre, dir, size } = pathValueAt(m);
    return onLabel(p, centre, size, dir, t);
  },
  // Corners and its box (stage 6), and its value (stage 5).
  handles: (m) => [...pointGrips(m.vertices), ...(m.vertices.length >= 2 ? [{ id: "value" as const, at: pathValueAt(m).centre }] : [])],
  dragHandle(m, h, p, constrain, minSize) {
    if (h === "value") return { ...m, value: sub(p, pathValueAt(m).home) };
    return dragPointGrip(m, h, p, constrain, minSize, false);
  },
  resetHandle(m, h) {
    if (h !== "value" || !m.value) return null;
    const { value: _, ...rest } = m;
    return rest;
  },
  moveBy: (m, dx, dy) => ({ ...m, vertices: m.vertices.map((v) => movePt(v, dx, dy)) }),
  finish: settleMeasure,
});
