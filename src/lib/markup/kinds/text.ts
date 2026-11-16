// Text box: drag a box or click for a default-width one, then type; it grows to fit its text.
// Saved as a FreeText annotation. The box's drawing, keys and sizing are in ../textbox.ts,
// shared with the callout.

import { boxHandles, distToPolyline, insidePolygon, rectPts } from "../shape";
import { type MarkupBase, type Rect, type TextStyle, LINE_STYLE, WHITE, normRect } from "../base";
import { dragTextBox, fitText, refitText, textBoxSpec, textOps } from "../textbox";
import { defineKind } from "./kind";

export interface TextMarkup extends MarkupBase {
  kind: "text";
  rect: Rect;
  text: string;
  textStyle: TextStyle;
}

declare module "../base" {
  interface MarkupKinds {
    text: TextMarkup;
  }
}

/** A new text box clicked rather than dragged is this wide (points on paper). */
const TEXT_WIDTH = 160;

export const text = defineKind<TextMarkup>({
  kind: "text",
  label: "Text box",
  defaultStyle: () => ({ ...LINE_STYLE, width: 1, fill: WHITE }),
  controls: { fill: true, ends: false, text: true },
  draw: {
    gesture: "box",
    make: (rect, ctx) => ({ rect, text: "", textStyle: ctx.textStyle }),
    // A click: a default-width box at the point.
    click: (a, ctx) => ({ rect: [a[0], a[1], a[0] + TEXT_WIDTH, a[1] + 20], text: "", textStyle: ctx.textStyle }),
  },
  ops: (m) => textOps(m.rect, m.text, m.textStyle, m.style),
  spec: (m, f, spec) => textBoxSpec(m, f, spec),
  bounds: (m) => normRect(m.rect),
  hits: (m, p, t) => insidePolygon(p, rectPts(normRect(m.rect))) || distToPolyline(p, rectPts(normRect(m.rect)), true) <= t,
  handles: (m) => boxHandles(normRect(m.rect)),
  dragHandle: (m, h, p, constrain, minSize) => ({ ...m, rect: dragTextBox(m, h, p, constrain, minSize) }),
  moveBy: (m, dx, dy) => ({ ...m, rect: [m.rect[0] + dx, m.rect[1] + dy, m.rect[2] + dx, m.rect[3] + dy] }),
  finish: (m) => fitText(m),
  settle: (m) => fitText(m),
  restyled: (before, after) => refitText(before, after),
  typed: true,
  typesAfter: true,
  // Empty, it stays only if a border or a background shows it's there (rule 3).
  keepEmpty: (m) => (m.style.width > 0 && m.style.opacity > 0) || m.style.fill !== null,
});

