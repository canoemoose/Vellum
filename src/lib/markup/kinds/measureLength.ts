// Length: two clicks (or a drag) from end to end; Shift snaps to 15 degrees. A dimension line
// with its real-world length above it. Saved as a Line annotation with the LineDimension intent
// and a /Measure dictionary, so other apps treat it as a dimension.

import { type MarkupBase, type Pt, normRect } from "../base";
import { r3 } from "../annotation";
import { toUser } from "../pdf";
import { distToSegment, movePt, snapAngle } from "../shape";
import { formatLength, formatPaper, paperMm, realMm, uprightDir } from "../measure";
import { type MeasureFields, MEASURE_STYLE, barHalf, dimensionLine, labelAlong, measureSpec, newMeasure, pageMeasureOf, settleMeasure } from "../dimension";
import { defineKind } from "./kind";

export interface MeasureLengthMarkup extends MarkupBase, MeasureFields {
  kind: "measureLength";
  from: Pt;
  to: Pt;
}

declare module "../base" {
  interface MarkupKinds {
    measureLength: MeasureLengthMarkup;
  }
}

/** Its values: real-world (null with no scale) and on paper. */
export function lengthValues(m: MeasureLengthMarkup): { real: string | null; paper: string; realMm: number | null } {
  const pm = pageMeasureOf(m);
  const d = Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]);
  const r = realMm(d, pm);
  return { real: r === null ? null : formatLength(r, m.fmt), paper: formatPaper(paperMm(d, pm.userUnit)), realMm: r };
}

/** What its label reads: the real length, or with no scale, the paper length marked as such. */
export const lengthLabel = (m: MeasureLengthMarkup): string => {
  const v = lengthValues(m);
  return v.real ?? `${v.paper} (paper)`;
};

export const measureLength = defineKind<MeasureLengthMarkup>({
  kind: "measureLength",
  label: "Length",
  defaultStyle: () => ({ ...MEASURE_STYLE }),
  controls: { fill: false, ends: false, text: false },
  draw: { gesture: "points", make: (pts) => ({ from: pts[0], to: pts[pts.length - 1], ...newMeasure() }), closed: false, min: 2, max: 2, drag: "line" },
  ops(m) {
    const dir = uprightDir(m.from, m.to);
    return [...dimensionLine([m.from, m.to], m.style), labelAlong(lengthLabel(m), m.from, m.to, m.labelSize, m.style.stroke, barHalf(m.style.width) * 0.5 + 1, dir)];
  },
  spec(m, f, spec) {
    const v = lengthValues(m);
    spec.subtype = "Line";
    spec.line = [...toUser(f, m.from[0], m.from[1]), ...toUser(f, m.to[0], m.to[1])].map(r3) as [number, number, number, number];
    spec.lineEnds = ["Butt", "Butt"];
    delete spec.interior;
    spec.intent = "LineDimension";
    spec.contents = lengthLabel(m);
    spec.caption = true;
    spec.measure = measureSpec(pageMeasureOf(m), m.fmt, v.realMm ?? 0);
  },
  bounds: (m) => normRect([m.from[0], m.from[1], m.to[0], m.to[1]]),
  hits: (m, p, t) => distToSegment(p, m.from, m.to) <= t,
  handles: (m) => [{ id: "from", at: m.from }, { id: "to", at: m.to }],
  dragHandle(m, h, p, constrain) {
    if (h === "from") return { ...m, from: constrain ? snapAngle(m.to, p) : p };
    if (h === "to") return { ...m, to: constrain ? snapAngle(m.from, p) : p };
    return m;
  },
  moveBy: (m, dx, dy) => ({ ...m, from: movePt(m.from, dx, dy), to: movePt(m.to, dx, dy) }),
  finish: settleMeasure,
});
