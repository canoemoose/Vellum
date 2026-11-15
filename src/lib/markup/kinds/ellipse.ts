// Ellipse: drag a box (Shift: circle). Saved as a Circle annotation.

import { type MarkupBase, type Pt, type Rect, LINE_STYLE, normRect } from "../base";
import { type Seg, filled } from "../draw";
import { boxHandles, distToPolyline, dragBox } from "../shape";
import { boxInset } from "../annotation";
import { rectToUser } from "../pdf";
import { defineKind } from "./kind";

export interface EllipseMarkup extends MarkupBase {
  kind: "ellipse";
  /** The box it fills. */
  rect: Rect;
}

declare module "../base" {
  interface MarkupKinds {
    ellipse: EllipseMarkup;
  }
}

export const ellipse = defineKind<EllipseMarkup>({
  kind: "ellipse",
  label: "Ellipse",
  defaultStyle: () => ({ ...LINE_STYLE }),
  controls: { fill: true, ends: false, text: false },
  draw: { gesture: "box", make: (r) => ({ rect: r }) },
  ops(m) {
    const s = m.style;
    const [x0, y0, x1, y1] = normRect(m.rect);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    return filled(ellipseSegs(cx, cy, rx, ry), () => ellipseSegs(cx, cy, Math.max(0, rx - s.width / 2), Math.max(0, ry - s.width / 2)), s);
  },
  spec(m, f, spec) {
    const s = m.style;
    spec.subtype = "Circle";
    // /RD: how far the drawn ellipse (the outside of its line) sits inside /Rect.
    spec.inset = boxInset(rectToUser(f, normRect([m.rect[0] - s.width / 2, m.rect[1] - s.width / 2, m.rect[2] + s.width / 2, m.rect[3] + s.width / 2])), spec.rect);
  },
  bounds: (m) => normRect(m.rect),
  hits(m, p, t) {
    const [x0, y0, x1, y1] = normRect(m.rect);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    if (m.style.fill && rx > 0 && ry > 0 && ((p[0] - cx) / rx) ** 2 + ((p[1] - cy) / ry) ** 2 <= 1) return true;
    return distToPolyline(p, ellipsePoints(cx, cy, rx, ry), true) <= t;
  },
  handles: (m) => boxHandles(normRect(m.rect)),
  dragHandle: (m, h, p, constrain, minSize) => ({ ...m, rect: dragBox(normRect(m.rect), h, p, constrain, minSize) }),
  moveBy: (m, dx, dy) => ({ ...m, rect: [m.rect[0] + dx, m.rect[1] + dy, m.rect[2] + dx, m.rect[3] + dy] }),
});

/** Bezier quarter arcs: this far along the tangent puts the curve within 0.03% of a true ellipse. */
const KAPPA = 0.5522847498;

/** An ellipse as four Bezier quarters, clockwise on the page from the right-hand end. */
export function ellipseSegs(cx: number, cy: number, rx: number, ry: number): Seg[] {
  const kx = KAPPA * rx, ky = KAPPA * ry;
  return [
    ["M", cx + rx, cy],
    ["C", cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ["C", cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ["C", cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ["C", cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ["Z"],
  ];
}

/** Points round an ellipse, close enough for picking it. */
function ellipsePoints(cx: number, cy: number, rx: number, ry: number, n = 72): Pt[] {
  return Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((2 * Math.PI * i) / n), cy + ry * Math.sin((2 * Math.PI * i) / n)] as Pt);
}
