// Calibrate: two clicks (or a drag) along a dimension whose real length you know, then type it
// in (App.svelte's calibrate dialog). Shift snaps to 15 degrees. Never kept as a markup: the
// drawing tool hands it to the app (MarkupTool.keep), which sets the scale from it. A kind so
// that it's drawn with the same gesture, preview and snapping as the measurements.

import { type MarkupBase, type Pt, normRect } from "../base";
import { r3 } from "../annotation";
import { toUser } from "../pdf";
import { distToSegment, movePt } from "../shape";
import { formatPaper, paperMm, uprightDir } from "../measure";
import { type MeasureFields, MEASURE_STYLE, barHalf, dimensionLine, labelAlong, newMeasure, pageMeasureOf, settleMeasure } from "../dimension";
import { defineKind } from "./kind";

export interface MeasureCalibrateMarkup extends MarkupBase, MeasureFields {
  kind: "measureCalibrate";
  from: Pt;
  to: Pt;
}

declare module "../base" {
  interface MarkupKinds {
    measureCalibrate: MeasureCalibrateMarkup;
  }
}

/** The picked distance on paper, mm. */
export function calibratePaperMm(m: MeasureCalibrateMarkup): number {
  return paperMm(Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]), pageMeasureOf(m).userUnit);
}

export const measureCalibrate = defineKind<MeasureCalibrateMarkup>({
  kind: "measureCalibrate",
  label: "Calibrate",
  defaultStyle: () => ({ ...MEASURE_STYLE, dash: [3, 2] }),
  controls: { fill: false, ends: false, text: false },
  // It's never kept, so nothing in the bar does anything for it.
  noBar: true,
  draw: { gesture: "points", make: (pts) => ({ from: pts[0], to: pts[pts.length - 1], ...newMeasure() }), closed: false, min: 2, max: 2, drag: "line" },
  ops: (m) => [
    ...dimensionLine([m.from, m.to], m.style),
    labelAlong(`${formatPaper(calibratePaperMm(m))} on paper`, m.from, m.to, m.labelSize, m.style.stroke, barHalf(m.style.width) * 0.5 + 1, uprightDir(m.from, m.to)),
  ],
  // Never saved; written as a plain line should it ever be.
  spec(m, f, spec) {
    spec.subtype = "Line";
    spec.line = [...toUser(f, m.from[0], m.from[1]), ...toUser(f, m.to[0], m.to[1])].map(r3) as [number, number, number, number];
  },
  bounds: (m) => normRect([m.from[0], m.from[1], m.to[0], m.to[1]]),
  hits: (m, p, t) => distToSegment(p, m.from, m.to) <= t,
  handles: (m) => [{ id: "from", at: m.from }, { id: "to", at: m.to }],
  dragHandle: (m, h, p) => (h === "from" ? { ...m, from: p } : h === "to" ? { ...m, to: p } : m),
  moveBy: (m, dx, dy) => ({ ...m, from: movePt(m.from, dx, dy), to: movePt(m.to, dx, dy) }),
  finish: settleMeasure,
});
