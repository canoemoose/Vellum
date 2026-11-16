// Arrow: drag from tail to head, or click each (Shift: 15 degree steps), with a style for each end. Saved as a
// Line annotation. The Line tool is this kind with both ends "none" (a preset in ../tools.ts).

import { type MarkupBase, type Pt, DEFAULT_ENDS, LINE_STYLE, arrowEnds, normRect } from "../base";
import { endedLine } from "../draw";
import { distToSegment, movePt, snapAngle } from "../shape";
import { lineEndsSpec, r3 } from "../annotation";
import { toUser } from "../pdf";
import { defineKind } from "./kind";

export interface ArrowMarkup extends MarkupBase {
  kind: "arrow";
  /** Tail and head. */
  from: Pt;
  to: Pt;
}

declare module "../base" {
  interface MarkupKinds {
    arrow: ArrowMarkup;
  }
}

export const arrow = defineKind<ArrowMarkup>({
  kind: "arrow",
  label: "Arrow",
  labelOf: (m) => (arrowEnds(m.style).every((e) => e === "none") ? "Line" : "Arrow"),
  defaultStyle: () => ({ ...LINE_STYLE, ends: [...DEFAULT_ENDS] }),
  controls: { fill: false, ends: true, text: false },
  draw: { gesture: "points", make: (pts) => ({ from: pts[0], to: pts[pts.length - 1] }), closed: false, min: 2, max: 2, drag: "line" },
  ops: (m) => endedLine([m.from, m.to], arrowEnds(m.style), m.style),
  spec(m, f, spec) {
    const s = m.style;
    spec.subtype = "Line";
    spec.line = [...toUser(f, m.from[0], m.from[1]), ...toUser(f, m.to[0], m.to[1])].map(r3) as [number, number, number, number];
    lineEndsSpec(spec, s);
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
});
