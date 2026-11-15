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

/** The geometry a gesture gives a new markup: everything but what every markup has. */
export type Shape<M extends Markup> = Omit<M, "id" | "page" | "style" | "meta" | "kind">;

export interface DrawContext {
  /** The text style new text takes (the properties bar's). */
  textStyle: TextStyle;
}

/** The gesture that draws a kind, and how its result becomes the kind's geometry. */
export type Draw<M extends Markup> =
  /** Press at one end, let go at the other. Shift snaps to 15 degrees. Under 4 px makes nothing. */
  | { gesture: "line"; make(a: Pt, b: Pt): Shape<M> }
  /**
   * Drag a box; Shift makes it square. Under 4 px both ways makes nothing, unless `click` is
   * given: then a click, or a drag under 8 px both ways, makes one at the point.
   */
  | { gesture: "box"; make(r: Rect, ctx: DrawContext): Shape<M>; click?(a: Pt, ctx: DrawContext): Shape<M> }
  /**
   * Click points; double-click or Enter finishes, Esc abandons. Shift snaps each point to 15
   * degrees from the last. `closed`: a shape (the rubber band shows the closing edge, and a
   * click on the first point also finishes). `min`: the fewest points it takes. Pressing and
   * dragging instead makes one in a go: `drag` "box" a rectangle of points (under 4 px either
   * way makes nothing), "line" two points (under 4 px makes nothing).
   */
  | { gesture: "points"; make(pts: Pt[]): Shape<M>; closed: boolean; min: number; drag: "box" | "line" }
  /** Freehand: the pointer's path while pressed, simplified when let go. */
  | { gesture: "freehand"; make(strokes: Pt[][]): Shape<M> }
  /**
   * Place at a click, centred on the pointer, with a preview following the pointer before the
   * click; or drag to size it (`box`; without it, a drag places at the press).
   */
  | { gesture: "place"; make(at: Pt, ctx: DrawContext): Shape<M>; box?(r: Rect, ctx: DrawContext): Shape<M> };

export type Gesture = Draw<Markup>["gesture"];

export interface KindDef<M extends Markup = Markup> {
  kind: M["kind"];
  /** "Rectangle": for the properties bar ("Rectangle tool") and, later, the markups list. */
  label: string;
  /** The label for one markup, where it differs (an arrow with no ends is a "Line"). */
  labelOf?(m: M): string;
  /** The style its tools start with, before one is remembered. */
  defaultStyle(): Style;
  /** Which of the properties bar's optional controls apply (line colour, weight, pattern always do). */
  controls: { fill: boolean; ends: boolean; text: boolean };
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
  /** The grips it shows when selected. */
  handles(m: M): Handle[];
  /** Grip `h` dragged to p; `constrain` is Shift. Stays at least minSize where that applies. */
  dragHandle(m: M, h: HandleId, p: Pt, constrain: boolean, minSize: number): M;
  moveBy(m: M, dx: number, dy: number): M;
  /** A new markup made whole once its gesture ends (a text box grown to fit). */
  finish?(m: M): M;
  /** After it's moved or a grip is let go. */
  settle?(m: M): M;
  /** After a restyle: `after` is `before` with the new style (a snug text box stays snug). */
  restyled?(before: M, after: M): M;
  /** It holds text typed on the canvas: typing starts once it's drawn, and a double-click edits it. */
  typed?: boolean;
  /**
   * What Vellum's private copy in the saved annotation keeps of it (../reedit.ts), when not
   * the whole markup: an image is referred to by its hash, never carried a second time.
   */
  saved?(m: M): unknown;
}

/** Declare a kind (types each method by the kind's own markup). */
export const defineKind = <M extends Markup>(def: KindDef<M>): KindDef<M> => def;
