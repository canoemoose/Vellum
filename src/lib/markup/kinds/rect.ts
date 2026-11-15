// Rectangle: drag a box (Shift: square). Saved as a Square annotation.

import { type MarkupBase, type Rect, LINE_STYLE, normRect } from "../base";
import { box, filled } from "../draw";
import { boxHandles, distToPolyline, dragBox, insidePolygon, rectPts } from "../shape";
import { boxInset } from "../annotation";
import { rectToUser } from "../pdf";
import { defineKind } from "./kind";

export interface RectMarkup extends MarkupBase {
  kind: "rect";
  rect: Rect;
}

declare module "../base" {
  interface MarkupKinds {
    rect: RectMarkup;
  }
}

export const rect = defineKind<RectMarkup>({
  kind: "rect",
  label: "Rectangle",
  defaultStyle: () => ({ ...LINE_STYLE }),
  controls: { fill: true, ends: false, text: false },
  draw: { gesture: "box", make: (r) => ({ rect: r }) },
  ops(m) {
    const s = m.style;
    const [x0, y0, x1, y1] = normRect(m.rect);
    return filled(box(x0, y0, x1, y1, 0), () => box(x0, y0, x1, y1, s.width / 2), s);
  },
  spec(m, f, spec) {
    const s = m.style;
    const box = spec.rect;
    spec.subtype = "Square";
    // /RD: how far the drawn square (the outside of its stroke) sits inside /Rect.
    spec.inset = boxInset(rectToUser(f, normRect([m.rect[0] - s.width / 2, m.rect[1] - s.width / 2, m.rect[2] + s.width / 2, m.rect[3] + s.width / 2])), box);
  },
  bounds: (m) => normRect(m.rect),
  hits(m, p, t) {
    const r = normRect(m.rect);
    if (m.style.fill && insidePolygon(p, rectPts(r))) return true;
    return distToPolyline(p, rectPts(r), true) <= t;
  },
  handles: (m) => boxHandles(normRect(m.rect)),
  dragHandle: (m, h, p, constrain, minSize) => ({ ...m, rect: dragBox(normRect(m.rect), h, p, constrain, minSize) }),
  moveBy: (m, dx, dy) => ({ ...m, rect: [m.rect[0] + dx, m.rect[1] + dy, m.rect[2] + dx, m.rect[3] + dy] }),
});
