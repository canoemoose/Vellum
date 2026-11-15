// Stamp: a box on the page holding a signature (its strokes, or its picture), an image (your own
// image stamp, or a picture from the Image tool or the clipboard), or a text stamp (APPROVED,
// FOR COMMENT, SUPERSEDED, your own wording). Placed with a click (a default size, centred on the
// pointer) or dragged to size; moved, resized with its aspect kept, and turned by its rotate grip
// (stage 8: Shift steps by 15 degrees; resizing works in its own, turned frame). A new one starts
// upright as viewed, whichever way the view is turned. Saved as a Stamp annotation (its /Rect
// holds the turned box; the appearance is drawn turned), or baked into the page (a signature, if
// the save is asked to; annot/bake.rs draws the same appearance).
//
// What the Stamp, Signature and Image tools place next is "armed" here (armStamp) by the
// context bar's pickers (or the popouts): the place gesture's make() has no other way to be told.
// Nothing armed (a signature still loading) places nothing.

import type { MarkupBase, Pt, Rect } from "../base";
import { LINE_STYLE, normRect } from "../base";
import type { Op } from "../draw";
import type { Handle } from "../shape";
import { type StampContent, aspectOf, contentOps, imageResName, naturalSize, stampName } from "../stamps";
import { CORNERS, angleTo, centreOf, insideTurned, resizeTurned, rotateGripAt, screenTopLeft, swapsSides, turnOps, turnedBounds, turnedCorners, uprightAngle } from "../turn";
import { defineKind } from "./kind";

const sameRgb = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

export interface StampMarkup extends MarkupBase {
  kind: "stamp";
  /** Its box as if it weren't turned (its own frame); `angle` turns it about the middle. */
  rect: Rect;
  /** Stage 8: degrees turned clockwise as seen on the page; none (stamps from before) is 0. */
  angle?: number;
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
/** CSS px from the middle of the top edge to the rotate grip. */
export const ROTATE_GAP_PX = 24;

/** What the stamp tools place next: nothing until something is chosen. */
let armed: { content: StampContent; signature: boolean } | null = {
  content: { type: "text", label: "APPROVED", sub: null, colour: [0.1, 0.55, 0.2] },
  signature: false,
};

/** Set what the next placed stamp holds (null: nothing to place yet). */
export function armStamp(content: StampContent | null, signature = false): void {
  armed = content ? { content, signature } : null;
}

/** What's armed (the pickers show it). */
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

/** `angle` only when it turns (so an upright stamp keeps the shape it always had). */
const turned = (angle: number): { angle?: number } => (angle ? { angle } : {});

/**
 * One placed at p, upright as viewed with the view turned `viewRotation` (A16): its default size,
 * centred on the pointer.
 */
export function placeAt(c: StampContent, signature: boolean, p: Pt, viewRotation = 0): Pick<StampMarkup, "rect" | "angle" | "content" | "signature"> {
  return { rect: boxAt(c, p, widthFor(signature, c)), ...turned(uprightAngle(viewRotation)), content: c, signature };
}

/**
 * A dragged box fitted to the content as it's seen (A16): with the view turned a quarter, the
 * stamp's width runs down the page. Fitted from the corner at the top left of the screen, as an
 * upright view fits from the page's top left. Null if the drag is too small.
 */
export function fitDragged(c: StampContent, r: Rect, viewRotation = 0): { rect: Rect; angle?: number } | null {
  const [x0, y0, x1, y1] = normRect(r);
  const swap = swapsSides(viewRotation);
  // The drag's width and height as seen.
  const sw = swap ? y1 - y0 : x1 - x0, sh = swap ? x1 - x0 : y1 - y0;
  const a = aspectOf(c);
  const w = Math.max(sw, sh * a);
  if (w < MIN_DRAG) return null;
  const h = w / a;
  // What it covers on the page, from the corner that shows at the top left.
  const pw = swap ? h : w, ph = swap ? w : h;
  const tl = screenTopLeft(r, viewRotation);
  const sx = tl[0] === x0 ? 1 : -1, sy = tl[1] === y0 ? 1 : -1;
  const cx = tl[0] + (sx * pw) / 2, cy = tl[1] + (sy * ph) / 2;
  return { rect: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], ...turned(uprightAngle(viewRotation)) };
}

const OPPOSITE: Record<string, string> = { nw: "se", ne: "sw", se: "nw", sw: "ne" };

/** Corner `h` dragged to p with the opposite corner fixed and the aspect kept (in the box's own frame). */
export function dragCorner(r: Rect, h: string, p: Pt, aspect: number, minWidth = MIN_WIDTH): Rect {
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

/** Operations made see-through by `o` (the stamp's opacity, stage 8). */
export function faded(ops: Op[], o: number): Op[] {
  if (!(o < 1)) return ops;
  return ops.map((op): Op => (op.t === "path" ? { ...op, strokeOpacity: o, fillOpacity: o } : { ...op, opacity: o }));
}

/**
 * The stamp holding other content (a different stamp picked for it, or its date line on or
 * off): same middle and turn. A text stamp swapped for another keeps its lettering's size (the
 * box grows or shrinks with the words); anything else keeps its width.
 */
export function withContent(m: StampMarkup, content: StampContent, signature = m.signature): StampMarkup {
  const r = normRect(m.rect);
  const [cx, cy] = centreOf(r);
  const k = (r[2] - r[0]) / naturalSize(m.content)[0];
  const w = m.content.type === "text" && content.type === "text" ? k * naturalSize(content)[0] : r[2] - r[0];
  const h = w / aspectOf(content);
  const style = content.type === "text" ? { ...m.style, stroke: content.colour } : m.style;
  return { ...m, style, content, signature, rect: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] };
}

/** What the context bar offers it: "text" (colour, date line, opacity), "signature" or "image" (opacity). */
export const stampVariant = (c: StampContent, signature: boolean): "text" | "signature" | "image" => (signature ? "signature" : c.type === "text" ? "text" : "image");

export const stamp = defineKind<StampMarkup>({
  kind: "stamp",
  label: "Stamp",
  labelOf: (m) => (m.signature ? "Signature" : m.content.type === "text" ? "Text stamp" : "Image"),
  defaultStyle: () => ({ ...LINE_STYLE, width: 0 }),
  controls: { fill: false, ends: false, text: false },
  // Stage 8: its own bar (rule 6): a picker, then only what its content takes. A text stamp has
  // a colour and a date line; every stamp has opacity.
  ownBar: (variant) => ({ colour: variant === "text", dateLine: variant === "text" }),
  variantOf: (m) => stampVariant(m.content, m.signature),
  draw: {
    gesture: "place",
    make: (at, ctx) => (armed ? placeAt(armed.content, armed.signature, at, ctx.viewRotation) : null),
    box: (r, ctx) => {
      if (!armed) return null;
      const { content: c, signature } = armed;
      const fit = fitDragged(c, r, ctx.viewRotation);
      return fit ? { ...fit, content: c, signature } : placeAt(c, signature, [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], ctx.viewRotation);
    },
  },
  ops: (m) => {
    const r = normRect(m.rect);
    return faded(turnOps(contentOps(m.content, r), centreOf(r), m.angle ?? 0), m.style.opacity);
  },
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
  bounds: (m) => turnedBounds(m.rect, m.angle ?? 0),
  hits: (m, p, t) => insideTurned(p, m.rect, m.angle ?? 0, t),
  // Corner grips at its (turned) corners, and the rotate grip above the middle of its top edge.
  handles: (m, ptPerPx = 1): Handle[] => {
    const a = m.angle ?? 0;
    const corners = turnedCorners(m.rect, a);
    return [...CORNERS.map((id, i) => ({ id, at: corners[i] })), { id: "rotate", at: rotateGripAt(m.rect, a, ROTATE_GAP_PX * ptPerPx) }];
  },
  turn: (m) => m.angle ?? 0,
  dragHandle: (m, h, p, constrain, minSize) => {
    const a = m.angle ?? 0;
    // Rule 2: Shift steps by 15 degrees.
    if (h === "rotate") return { ...m, angle: angleTo(m.rect, p, constrain) };
    const aspect = aspectOf(m.content);
    return { ...m, rect: resizeTurned(m.rect, a, p, (own, q) => dragCorner(own, h, q, aspect, Math.max(MIN_WIDTH, minSize))) };
  },
  moveBy: (m, dx, dy) => ({ ...m, rect: [m.rect[0] + dx, m.rect[1] + dy, m.rect[2] + dx, m.rect[3] + dy] }),
  // Stage 8: a text stamp's colour is its lettering's; the bar's colour sets it.
  finish: (m) => (m.content.type === "text" ? { ...m, style: { ...m.style, stroke: m.content.colour } } : m),
  restyled: (before, after) =>
    after.content.type === "text" && !sameRgb(before.style.stroke, after.style.stroke) ? { ...after, content: { ...after.content, colour: after.style.stroke } } : after,
  // The private copy refers to an image by its hash: the picture is in the file once already.
  saved: (m) => (m.content.type === "image" ? { ...m, content: { type: "image", hash: m.content.hash, w: m.content.w, h: m.content.h } } : m),
});
