// What a kind of markup is: one definition per kind, in its own file beside this one, listed in
// index.ts. Everything that differs by kind (drawing, the annotation it saves as, hit-testing,
// grips, moving, its starting style, the properties it takes, the gesture that draws it) is
// here, so adding a kind is one new file, one line in index.ts and one in ../tools.ts.
// The gestures themselves are written once each, in engine/markupTool.ts. Pure.

import type { Markup, Pt, Rect, Style, TextStyle } from "../base";
import type { Op } from "../draw";
import type { Handle, HandleId } from "../shape";
import type { AnnotSpec } from "../annotation";
import type { Frame } from "../pdf";
import type { Regular } from "../regular";

/** The geometry a gesture gives a new markup: everything but what every markup has. */
export type Shape<M extends Markup> = Omit<M, "id" | "page" | "style" | "meta" | "kind">;

export interface DrawContext {
  /** The text style new text takes (the properties bar's). */
  textStyle: TextStyle;
  /** Stage 6: dragged out as a regular polygon (`drag: "regular"`): its centre, size, turn and sides. */
  regular?: Regular;
  // Dimensions (stage 5)
  /** Page points the pointer may be off and still be "on" a point (a grip's reach). */
  pick?: number;
  /** Stage 8: the view's turn, degrees clockwise (quarter turns): a new stamp starts upright as viewed. */
  viewRotation?: number;
  /** Shift is held (rule 2: it frees what starts locked; a Length pulled out measures straight). */
  free?: boolean;
  /** The page it's being drawn on (from 0), where known: a stamp's {page} field. */
  page?: number;
}

// Dimensions (stage 5)
/**
 * A clicked point's lock (rule 2): "snap" starts free and Shift snaps it to 15 degree steps;
 * "ortho" starts held horizontal or vertical on the page and Shift frees it; "none" is never
 * locked (a dimension's offset, which only its distance from the line matters for).
 */
export type Lock = "snap" | "ortho" | "none";
/** One point's lock, and which earlier point (by index) it's taken from: the one before, if not given. */
export type PointLock = Lock | { lock: Lock; from: number };
/** The lock on the point at `index` (from 1) and the index of the point it's taken from. */
export function pointLock(lock: Lock | PointLock[] | undefined, index: number): { lock: Lock; from: number } {
  const l = Array.isArray(lock) ? lock[Math.min(index, lock.length) - 1] : lock;
  if (l === undefined) return { lock: "snap", from: index - 1 };
  return typeof l === "string" ? { lock: l, from: index - 1 } : l;
}

/**
 * The gesture that draws a kind, and how its result becomes the kind's geometry. Rule 1 (docs/
 * editing-tool-consistency-brief.md): tools that share a gesture behave identically in it, so
 * a kind picks a gesture and its options here; it never adjusts how the gesture behaves.
 *
 * Every dragged box is under MIN_BOX_PX either way makes nothing (or, with `click`, the clicked
 * one). Shift toggles the lock (rule 2): 15 degree steps for a line or a clicked point, square
 * for a box being drawn; a kind with `lock: "ortho"` starts locked to horizontal and vertical on
 * the page and Shift frees it. `lock` may instead give each point after the first its own
 * (PointLock, by index from 1; the last carries on), as the angle's arms and a dimension's
 * offset need.
 */
export type Draw<M extends Markup> =
  /**
   * Drag a box corner to corner; Shift makes it square. Under the minimum either way makes
   * nothing, unless `click` is given: then a click, or a drag under the minimum, makes one at
   * the point.
   */
  | { gesture: "box"; make(r: Rect, ctx: DrawContext): Shape<M>; click?(a: Pt, ctx: DrawContext): Shape<M> }
  /**
   * Click points; double-click or Enter finishes, Esc abandons, Backspace (or Ctrl+Z) takes back
   * the last point, and a right-click offers all three. Shift toggles the lock on each point from
   * the last. `closed`: a shape (the rubber band shows the closing edge, and a click on the first
   * point also finishes). `min`: the fewest points it takes. Pressing and dragging instead makes
   * one in a go: `drag` "box" a rectangle of points (Shift squares it), "line" two points,
   * "regular" (stage 6) a regular polygon from the centre out, a corner on the pointer (Shift
   * puts a flat side at the bottom as viewed), handed to `make` as its corners with
   * `ctx.regular`.
   * `max`: it finishes by itself on that many points (a line's two, an angle's three).
   * `say`: how its points read in the tooltip, where `max` gives them meanings ("click the
   * corner, then each arm's end"). `preview`: while it's clicked out, the shape itself is drawn
   * as it would be made with the pointer's point (a dimension and its value), not a rubber band.
   */
  | { gesture: "points"; make(pts: Pt[], ctx: DrawContext): Shape<M>; closed: boolean; min: number; max?: number; drag: "box" | "line" | "regular"; lock?: Lock | PointLock[]; say?: string; preview?: boolean }
  /** Freehand: the pointer's path while pressed, simplified when let go. Shift draws it straight. */
  | { gesture: "freehand"; make(strokes: Pt[][]): Shape<M> }
  /**
   * Place at a click, centred on the pointer, with a preview following the pointer before the
   * click; or drag to size it (`box`; without it, a drag places at the press). A box under the
   * minimum either way places at the press. Null (stage 8): nothing chosen to place yet, so no
   * preview and nothing placed.
   */
  | { gesture: "place"; make(at: Pt, ctx: DrawContext): Shape<M> | null; box?(r: Rect, ctx: DrawContext): Shape<M> | null };

/** CSS px: a dragged box under this either way makes nothing (rule 1: one minimum for all). */
export const MIN_BOX_PX = 4;

export type Gesture = Draw<Markup>["gesture"];

export interface KindDef<M extends Markup = Markup> {
  kind: M["kind"];
  /** "Rectangle": for the properties bar ("Rectangle tool") and, later, the markups list. */
  label: string;
  /** The label for one markup, where it differs (an arrow with no ends is a "Line"). */
  labelOf?(m: M): string;
  /** The style its tools start with, before one is remembered. */
  defaultStyle(): Style;
  /**
   * Which of the context bar's optional controls apply (../bar.ts). Line colour always does;
   * weight and pattern unless it's lineless; `pattern: false` leaves out the pattern alone.
   */
  controls: { fill: boolean; ends: boolean; text: boolean; pattern?: boolean };
  /** Nothing in the context bar does anything for it (Calibrate): no bar (rule 6). */
  noBar?: boolean;
  /** How it's drawn on the canvas. */
  draw: Draw<M>;
  /** Its drawing operations: the overlay, and the saved appearance stream. */
  ops(m: M): Op[];
  /**
   * Its own part of the annotation: the subtype and its keys. `spec` arrives with the common
   * part filled in (rect, appearance, colour, border, interior if filled, dates, author, flags)
   * for the kind to set, change or delete.
   */
  spec(m: M, f: Frame, spec: AnnotSpec): void;
  /** The geometry's box, not counting the line weight or anything drawn outside it. */
  bounds(m: M): Rect;
  /** Whether page point p picks it; `t` is the pick tolerance plus half the line weight. */
  hits(m: M, p: Pt, t: number): boolean;
  /**
   * The grips it shows when selected. `ptPerPx` (stage 8): points per CSS pixel at the current
   * zoom, for a grip that sits a fixed distance off the shape on screen (a stamp's rotate grip).
   */
  handles(m: M, ptPerPx?: number): Handle[];
  /** Stage 8: degrees its own frame is turned on the page (a turned stamp), for its grips' cursors. */
  turn?(m: M): number;
  /**
   * It can be turned: by `deg` clockwise as seen on the page, about its middle. [ and ] turn a
   * selection of these a quarter (Shift: 15 degrees); a selection with anything else in it isn't
   * turned. Kinds with a rotate grip turn by it with this too, or keep their own angle.
   */
  turnBy?(m: M, deg: number): M;
  /**
   * A press on this part of it (within `t` points) works that grip rather than moving the whole
   * markup: a dimension's value and its line, which are never meant to pick it all up.
   */
  partAt?(m: M, p: Pt, t: number): HandleId | null;
  /**
   * Stage 8: its context bar is its own (a stamp's: a picker, then only what its content takes)
   * rather than the line controls. `variant` is the content: "text", "signature" or "image".
   */
  ownBar?(variant: string | undefined): { colour: boolean; dateLine: boolean; picker: boolean; border?: boolean };
  /** Stage 8: which variant of its own bar a markup takes. */
  variantOf?(m: M): string;
  /** Grip `h` dragged to p; `constrain` is Shift. Stays at least minSize where that applies. */
  dragHandle(m: M, h: HandleId, p: Pt, constrain: boolean, minSize: number): M;
  moveBy(m: M, dx: number, dy: number): M;
  // Stage 6: shapes
  /** Its number of sides, while that can still be changed (a regular polygon); else null. */
  sides?(m: M): number | null;
  /** The same shape with another number of sides (same centre, size and turn). */
  withSides?(m: M, sides: number): M;
  /** Its corners were changed by hand (one added or removed): a regular polygon goes freeform. */
  freeform?(m: M): M;
  /** A new markup made whole once its gesture ends (a text box grown to fit). */
  finish?(m: M): M;
  /** After it's moved or a grip is let go. */
  settle?(m: M): M;
  // Dimensions (stage 5)
  /** Grip `h` double-clicked: the markup with what it holds put back (a dimension's value), or null for nothing. */
  resetHandle?(m: M, h: HandleId): M | null;
  /** After a restyle: `after` is `before` with the new style (a snug text box stays snug). */
  restyled?(before: M, after: M): M;
  /** It holds text typed on the canvas: typing starts once it's drawn, and a double-click edits it. */
  typed?: boolean;
  /** Typing follows drawing it (a text box, a callout, a note): its tooltip says so. */
  typesAfter?: boolean;
  /**
   * Typing ended with no text: whether it stays (rule 3). A callout and a note stay, to be
   * filled in later; a text box only if something would show it's there. Without this, an
   * empty one is dropped.
   */
  keepEmpty?(m: M): boolean;
  // Text markups
  /**
   * It marks up the page's own text (a highlight): made from a text selection rather than drawn
   * with a tool (so it has no tool), never moved or resized, and a press on it selects it and
   * leaves the press to text selection.
   */
  ofText?: boolean;
  /** It has no line to weigh or pattern (a text highlight, a note): the properties bar leaves those out. */
  lineless?: boolean;
  // Existing annotations (phase 7b)
  /**
   * It came with the file and Vellum can't redraw it (a type it doesn't understand): it can be
   * moved or deleted, never restyled or copied, and has no tool.
   */
  fixed?: boolean;
  /**
   * What Vellum's private copy in the saved annotation keeps of it (../reedit.ts), when not
   * the whole markup: an image is referred to by its hash, never carried a second time.
   */
  saved?(m: M): unknown;
}

/** Declare a kind (types each method by the kind's own markup). */
export const defineKind = <M extends Markup>(def: KindDef<M>): KindDef<M> => def;
