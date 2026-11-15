// Pen: freehand strokes, each smoothed through its points. Saved as an Ink annotation.

import { type MarkupBase, type Pt, LINE_STYLE } from "../base";
import { type Seg, add, mul, path, sub } from "../draw";
import { boxHandles, distToPolyline, dragBox, mapPoints, movePt, pointsBounds } from "../shape";
import { userPoints } from "../annotation";
import { defineKind } from "./kind";

export interface InkMarkup extends MarkupBase {
  kind: "ink";
  strokes: Pt[][];
}

declare module "../base" {
  interface MarkupKinds {
    ink: InkMarkup;
  }
}

export const ink = defineKind<InkMarkup>({
  kind: "ink",
  label: "Pen",
  defaultStyle: () => ({ ...LINE_STYLE, width: 2 }),
  controls: { fill: false, ends: false, text: false },
  draw: { gesture: "freehand", make: (strokes) => ({ strokes }) },
  ops(m) {
    // Each stroke smoothed with a Catmull-Rom spline through its points.
    const segs: Seg[] = [];
    for (const st of m.strokes) {
      if (!st.length) continue;
      segs.push(["M", st[0][0], st[0][1]]);
      if (st.length === 1) segs.push(["L", st[0][0] + 0.01, st[0][1]]); // a dot still shows
      for (let i = 0; i + 1 < st.length; i++) {
        const p0 = st[Math.max(0, i - 1)], p1 = st[i], p2 = st[i + 1], p3 = st[Math.min(st.length - 1, i + 2)];
        const c1 = add(p1, mul(sub(p2, p0), 1 / 6));
        const c2 = sub(p2, mul(sub(p3, p1), 1 / 6));
        segs.push(["C", c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]]);
      }
    }
    return [path(segs, m.style, null)];
  },
  spec(m, f, spec) {
    spec.subtype = "Ink";
    spec.ink = m.strokes.map((st) => userPoints(f, st));
    delete spec.interior;
  },
  bounds: (m) => pointsBounds(m.strokes.flat()),
  hits: (m, p, t) => m.strokes.some((s) => distToPolyline(p, s, false) <= t),
  // Ink scales from its corners only.
  handles: (m) => boxHandles(pointsBounds(m.strokes.flat()), true),
  dragHandle(m, h, p, constrain, minSize) {
    const old = pointsBounds(m.strokes.flat());
    const r = dragBox(old, h, p, constrain, minSize);
    return { ...m, strokes: m.strokes.map((s) => mapPoints(s, old, r)) };
  },
  moveBy: (m, dx, dy) => ({ ...m, strokes: m.strokes.map((s) => s.map((v) => movePt(v, dx, dy))) }),
});
