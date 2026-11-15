// Stamp: a box on the page holding a signature (its strokes, or its picture), an image of your
// own, or a text stamp (APPROVED, FOR COMMENT, SUPERSEDED, your own wording). Placed with a
// click (a default size, centred on the pointer) or dragged to size; moved and resized with its
// aspect kept; no rotation. Saved as a Stamp annotation, or baked into the page (a signature,
// if the save is asked to; annot/bake.rs).
//
// What the Stamp and Signature tools place next is "armed" here (armStamp) by the stamp picker
// and the signature popover: the place gesture's make() has no other way to be told, and it
// keeps the shared gesture code (engine/markupTool.ts) unchanged.

import type { MarkupBase, Pt, Rect } from "../base";
import { LINE_STYLE, normRect } from "../base";
import { type Handle, type HandleId, boxHandles, insidePolygon, rectPts } from "../shape";
import { type StampContent, aspectOf, contentOps, imageResName, stampName } from "../stamps";
import { defineKind } from "./kind";

export interface StampMarkup extends MarkupBase {
  kind: "stamp";
  rect: Rect;
  content: StampContent;
  /**
   * A signature: the first save after placing one asks whether to bake it in. Signature data
   * never goes into logs or settings; recovery records holding it are encrypted.
   */
  signature: boolean;
}

declare module "../base" {
  interface MarkupKinds {
    stamp: StampMarkup;
  }
}

/** Points per millimetre. */
const MM = 72 / 25.4;
/** Default placed widths (Assumed 2 in docs/editing-phase5-scope.md). */
export const SIGNATURE_WIDTH = 50 * MM;
export const STAMP_WIDTH = 60 * MM;
/** A drag narrower than this places at the default size instead. */
const MIN_DRAG = 10;
/** Never resized smaller than this wide, points. */
const MIN_WIDTH = 8;

/** What the stamp tools place next. */
let armed: { content: StampContent; signature: boolean } = {
  content: { type: "text", label: "APPROVED", sub: null, colour: [0.1, 0.55, 0.2] },
  signature: false,
};

/** Set what the next placed stamp holds. */
export function armStamp(content: StampContent, signature: boolean): void {
  armed = { content, signature };
}

/** What's armed (the picker shows it). */
export const armedStamp = () => armed;

const widthFor = (signature: boolean, c: StampContent) => (signature || c.type !== "text" ? SIGNATURE_WIDTH : STAMP_WIDTH);

/** A box of the content's aspect, `w` wide, centred on p. */
export function boxAt(c: StampContent, p: Pt, w: number): Rect {
  const h = w / aspectOf(c);
  return [p[0] - w / 2, p[1] - h / 2, p[0] + w / 2, p[1] + h / 2];
}

/** The content's aspect fitted to a dragged box: as wide as the drag, or as tall, whichever is larger, from its top left. */
export function fitBox(c: StampContent, r: Rect): Rect | null {
  const [x0, y0, x1, y1] = normRect(r);
  const a = aspectOf(c);
  const w = Math.max(x1 - x0, (y1 - y0) * a);
  if (w < MIN_DRAG) return null;
  return [x0, y0, x0 + w, y0 + w / a];
}

const OPPOSITE: Record<string, HandleId> = { nw: "se", ne: "sw", se: "nw", sw: "ne" };

/** Corner `h` dragged to p with the opposite corner fixed and the aspect kept. */
export function dragCorner(r: Rect, h: HandleId, p: Pt, aspect: number, minWidth = MIN_WIDTH): Rect {
  const o = OPPOSITE[h];
  if (!o) return r;
  const fx = o.includes("w") ? r[0] : r[2];
  const fy = o.includes("n") ? r[1] : r[3];
  // Which way the dragged corner lies from the fixed one.
  const sx = h.includes("w") ? -1 : 1;
  const sy = h.includes("n") ? -1 : 1;
  // The larger of the two sizes the pointer asks for, as a width.
  const w = Math.max(minWidth, sx * (p[0] - fx), sy * (p[1] - fy) * aspect);
  const hgt = w / aspect;
  return normRect([fx, fy, fx + sx * w, fy + sy * hgt]);
}

export const stamp = defineKind<StampMarkup>({
  kind: "stamp",
  label: "Stamp",
  labelOf: (m) => (m.signature ? "Signature" : m.content.type === "text" ? "Text stamp" : "Image stamp"),
  defaultStyle: () => ({ ...LINE_STYLE, width: 0 }),
  controls: { fill: false, ends: false, text: false },
  draw: {
    gesture: "place",
    make: (at) => ({ rect: boxAt(armed.content, at, widthFor(armed.signature, armed.content)), content: armed.content, signature: armed.signature }),
    box: (r) => {
      const c = armed.content;
      const rect = fitBox(c, r) ?? boxAt(c, [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], widthFor(armed.signature, c));
      return { rect, content: c, signature: armed.signature };
    },
  },
  ops: (m) => contentOps(m.content, normRect(m.rect)),
  spec(m, _f, spec) {
    const c = m.content;
    spec.subtype = "Stamp";
    spec.stampName = stampName(c, m.signature);
    // A stamp has no border: the appearance is the whole of it.
    delete spec.borderWidth;
    delete spec.dash;
    delete spec.interior;
    if (c.type === "text") {
      spec.colour = c.colour;
      spec.contents = c.sub ? `${c.label.toUpperCase()}\n${c.sub}` : c.label.toUpperCase();
    } else {
      delete spec.colour;
      spec.contents = m.signature ? "Signature" : "Image";
    }
    if (c.type === "image") spec.appearance.images = { [imageResName(c.hash)]: { hash: c.hash, png: c.png } };
  },
  bounds: (m) => normRect(m.rect),
  hits: (m, p, t) => {
    const [x0, y0, x1, y1] = normRect(m.rect);
    return insidePolygon(p, rectPts([x0 - t, y0 - t, x1 + t, y1 + t]));
  },
  handles: (m): Handle[] => boxHandles(normRect(m.rect), true),
  dragHandle: (m, h, p, _constrain, minSize) => ({ ...m, rect: dragCorner(normRect(m.rect), h, p, aspectOf(m.content), Math.max(MIN_WIDTH, minSize)) }),
  moveBy: (m, dx, dy) => ({ ...m, rect: [m.rect[0] + dx, m.rect[1] + dy, m.rect[2] + dx, m.rect[3] + dy] }),
  // The private copy refers to an image by its hash: the picture is in the file once already.
  saved: (m) => (m.content.type === "image" ? { ...m, content: { type: "image", hash: m.content.hash, w: m.content.w, h: m.content.h } } : m),
});
