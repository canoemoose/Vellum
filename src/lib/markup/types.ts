// The markup model: plain objects in Vellum page coordinates (points, y down, the page as
// rendered with its /Rotate applied). Pure; see docs/editing-phase2-scope.md.

import type { Face, Family } from "./fonts";

export type Pt = [number, number];
export type Rgb = [number, number, number];
/** [x0, y0, x1, y1], x0 <= x1 and y0 <= y1. */
export type Rect = [number, number, number, number];

export interface Style {
  /** Line colour, 0..1 per channel. */
  stroke: Rgb;
  /** Line weight in points on paper. */
  width: number;
  /** Fill, or none. */
  fill: Rgb | null;
  /** Line opacity, 0..1. */
  opacity: number;
  /** Fill opacity, 0..1. Older recovery files lack it: read it with fillOpacity(). */
  fillOpacity: number;
  /** Dash pattern in points, or solid. */
  dash: number[] | null;
  /** Arrows only: how the tail and the head end. Read it with arrowEnds(). */
  ends?: [LineEnd, LineEnd];
}

/** How an arrow's end is drawn; each is a standard PDF line ending (lineEndName). */
export type LineEnd = "none" | "open" | "filled" | "dot" | "bar" | "slash";
export const LINE_ENDS: LineEnd[] = ["none", "open", "filled", "dot", "bar", "slash"];
export const DEFAULT_ENDS: [LineEnd, LineEnd] = ["none", "open"];

/** An arrow's [tail, head] ends (arrows drawn before ends could be chosen had an open head). */
export function arrowEnds(s: Style): [LineEnd, LineEnd] {
  const ok = (e: unknown): e is LineEnd => LINE_ENDS.includes(e as LineEnd);
  return Array.isArray(s.ends) && s.ends.length === 2 && ok(s.ends[0]) && ok(s.ends[1]) ? [s.ends[0], s.ends[1]] : [...DEFAULT_ENDS];
}

export type Align = "left" | "center" | "right";

export interface TextStyle {
  /** Points. */
  size: number;
  colour: Rgb;
  // The rest arrived later, so older recovery files lack them: read them through fullText().
  family?: Family;
  bold?: boolean;
  italic?: boolean;
  align?: Align;
  underline?: boolean;
  strike?: boolean;
  /** Line spacing as a multiple of the size. */
  spacing?: number;
}

export const SPACINGS = [1, 1.2, 1.5, 2];

/** A text style with every setting filled in. */
export function fullText(t: TextStyle): Required<TextStyle> {
  return {
    size: t.size,
    colour: t.colour,
    family: t.family === "times" || t.family === "courier" ? t.family : "helvetica",
    bold: t.bold === true,
    italic: t.italic === true,
    align: t.align === "center" || t.align === "right" ? t.align : "left",
    underline: t.underline === true,
    strike: t.strike === true,
    spacing: typeof t.spacing === "number" && t.spacing >= 0.8 && t.spacing <= 3 ? t.spacing : 1.2,
  };
}

/** The font a text style uses. */
export const faceOf = (t: TextStyle): Face => {
  const f = fullText(t);
  return { family: f.family, bold: f.bold, italic: f.italic };
};

export interface MarkupMeta {
  author: string;
  /** ISO timestamps. */
  created: string;
  modified: string;
}

interface Base {
  /** Unique; written into the file as /NM so a saved markup can be found again. */
  id: string;
  page: number;
  style: Style;
  meta: MarkupMeta;
}

export interface RectMarkup extends Base {
  kind: "rect";
  rect: Rect;
}

export interface ArrowMarkup extends Base {
  kind: "arrow";
  /** Tail and head. */
  from: Pt;
  to: Pt;
}

export interface CloudMarkup extends Base {
  kind: "cloud";
  vertices: Pt[];
  /** Scallop size, 1 normal. */
  intensity: number;
}

export interface TextMarkup extends Base {
  kind: "text";
  rect: Rect;
  text: string;
  textStyle: TextStyle;
}

export interface InkMarkup extends Base {
  kind: "ink";
  strokes: Pt[][];
}

export type Markup = RectMarkup | ArrowMarkup | CloudMarkup | TextMarkup | InkMarkup;
export type MarkupKind = Markup["kind"];

export const RED: Rgb = [0.85, 0.1, 0.1];
export const BLACK: Rgb = [0, 0, 0];
export const WHITE: Rgb = [1, 1, 1];

/** The agreed starting styles (docs/editing-phase2-scope.md, "Assumed" 5). */
export function defaultStyle(kind: MarkupKind): Style {
  switch (kind) {
    case "text":
      return { stroke: RED, width: 1, fill: WHITE, opacity: 1, fillOpacity: 1, dash: null };
    case "ink":
      return { stroke: RED, width: 2, fill: null, opacity: 1, fillOpacity: 1, dash: null };
    case "arrow":
      return { stroke: RED, width: 1.5, fill: null, opacity: 1, fillOpacity: 1, dash: null, ends: [...DEFAULT_ENDS] };
    default:
      return { stroke: RED, width: 1.5, fill: null, opacity: 1, fillOpacity: 1, dash: null };
  }
}

/** A style's fill opacity (styles saved before line and fill were split had only one). */
export const fillOpacity = (s: Style): number => (typeof s.fillOpacity === "number" ? s.fillOpacity : s.opacity);

export const DEFAULT_TEXT: TextStyle = { size: 10, colour: BLACK, family: "helvetica", bold: false, italic: false, align: "left", underline: false, strike: false, spacing: 1.2 };

let counter = 0;
/** A markup id: unique within the session and across files ("vellum-" + time + counter). */
export function newId(now = Date.now()): string {
  counter = (counter + 1) % 1e6;
  return `vellum-${now.toString(36)}-${counter.toString(36)}-${Math.floor(Math.random() * 36 ** 4).toString(36)}`;
}

export function normRect(r: Rect): Rect {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}
