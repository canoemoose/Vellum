// Highlighter: freehand, wide and see-through, multiplied into the drawing so it darkens what's
// under it rather than covering it. Saved as an Ink annotation whose appearance uses the
// Multiply blend mode. Shift draws a straight stroke (the freehand gesture, markupTool.ts).

import { type MarkupBase, type Pt, LINE_STYLE } from "../base";
import { type Seg, add, mul, path, sub } from "../draw";
import { boxHandles, distToPolyline, dragBox, mapPoints, movePt, pointsBounds } from "../shape";
import { userPoints } from "../annotation";
import { defineKind } from "./kind";

export interface HighlighterMarkup extends MarkupBase {
  kind: "highlighter";
  strokes: Pt[][];
}

declare module "../base" {
  interface MarkupKinds {
    highlighter: HighlighterMarkup;
  }
}

/** The properties bar's yellow, so its swatch shows as chosen. */
export const HIGHLIGHT_YELLOW: [number, number, number] = [0.95, 0.78, 0.0];

/** Each stroke smoothed with a Catmull-Rom spline through its points (as the pen draws). */
export function smoothStrokes(strokes: Pt[][]): Seg[] {
  const segs: Seg[] = [];
  for (const st of strokes) {
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
  return segs;
}

export const highlighter = defineKind<HighlighterMarkup>({
  kind: "highlighter",
  label: "Highlighter",
  defaultStyle: () => ({ ...LINE_STYLE, stroke: HIGHLIGHT_YELLOW, width: 12, opacity: 0.4 }),
  controls: { fill: false, ends: false, text: false },
  draw: { gesture: "freehand", make: (strokes) => ({ strokes }) },
  ops: (m) => [{ ...path(smoothStrokes(m.strokes), m.style, null), blend: "multiply" }],
  spec(m, f, spec) {
    spec.subtype = "Ink";
    spec.ink = m.strokes.map((st) => userPoints(f, st));
    spec.blend = "Multiply";
    delete spec.interior;
  },
  bounds: (m) => pointsBounds(m.strokes.flat()),
  hits: (m, p, t) => m.strokes.some((s) => distToPolyline(p, s, false) <= t),
  handles: (m) => boxHandles(pointsBounds(m.strokes.flat()), true),
  dragHandle(m, h, p, constrain, minSize) {
    const old = pointsBounds(m.strokes.flat());
    const r = dragBox(old, h, p, constrain, minSize);
    return { ...m, strokes: m.strokes.map((s) => mapPoints(s, old, r)) };
  },
  moveBy: (m, dx, dy) => ({ ...m, strokes: m.strokes.map((s) => s.map((v) => movePt(v, dx, dy))) }),
});
