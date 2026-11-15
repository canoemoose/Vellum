// An annotation that came with the file whose type Vellum doesn't understand (a file
// attachment, a sound, another app's stamp or private type): it can be moved or deleted but
// not restyled, copied or redrawn (docs/editing-scope.md, "Existing annotations"). PDFium keeps
// drawing it, with its own appearance, until it's moved; from then until the save the overlay
// shows where it will go as a dashed box, and the save moves the annotation itself, appearance
// and all (Change "move"). Never made with a tool. Phase 7b.

import { type MarkupBase, type Pt, type Rect, LINE_STYLE, normRect } from "../base";
import { type Op, box } from "../draw";
import { insidePolygon, rectPts } from "../shape";
import { defineKind } from "./kind";

export interface ForeignMarkup extends MarkupBase {
  kind: "foreign";
  /** The annotation's subtype as the file names it ("FileAttachment"). */
  subtype: string;
  /** Its box on the page (where it is now). */
  rect: Rect;
  /** How far it has moved since it was read, page points: the save moves it by this. */
  moved: Pt;
  /** Its /Contents, for the markups list. */
  text: string;
}

declare module "../base" {
  interface MarkupKinds {
    foreign: ForeignMarkup;
  }
}

/** "FileAttachment" as "File attachment". */
export function subtypeLabel(subtype: string): string {
  const words = subtype.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : "Annotation";
}

export const foreign = defineKind<ForeignMarkup>({
  kind: "foreign",
  label: "Annotation",
  labelOf: (m) => subtypeLabel(m.subtype),
  defaultStyle: () => ({ ...LINE_STYLE, stroke: [0.4, 0.4, 0.4], width: 1, dash: [3, 2] }),
  controls: { fill: false, ends: false, text: false },
  // Never drawn with a tool (it has none); the gesture is only there to satisfy the type.
  draw: { gesture: "box", make: (r) => ({ subtype: "Square", rect: r, moved: [0, 0], text: "" }) },
  // Where it will be once saved: a dashed outline over a faint wash, until PDFium draws it there.
  ops(m): Op[] {
    const [x0, y0, x1, y1] = normRect(m.rect);
    return [{ t: "path", segs: box(x0, y0, x1, y1, 0), stroke: [0.35, 0.35, 0.35], fill: [0.5, 0.5, 0.5], width: 1, dash: [3, 2], strokeOpacity: 0.9, fillOpacity: 0.12 }];
  },
  // Never written from the model: the save moves the original instead (MarkupDoc.changes).
  spec(_m, _f, spec) {
    spec.subtype = "Square";
  },
  bounds: (m) => normRect(m.rect),
  hits(m, p, t) {
    const [x0, y0, x1, y1] = normRect(m.rect);
    return insidePolygon(p, rectPts([x0 - t, y0 - t, x1 + t, y1 + t]));
  },
  handles: () => [],
  dragHandle: (m) => m,
  moveBy: (m, dx, dy) => ({ ...m, rect: [m.rect[0] + dx, m.rect[1] + dy, m.rect[2] + dx, m.rect[3] + dy], moved: [m.moved[0] + dx, m.moved[1] + dy] }),
  lineless: true,
  fixed: true,
});
