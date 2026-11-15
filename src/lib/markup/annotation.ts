// The annotation spec the backend writes (src-tauri/src/annot/spec.rs), in PDF user space, and
// the small pieces each kind uses to fill in its part of one. spec.ts builds the common part
// and hands the rest to the kind's file under kinds/. Pure, and a leaf: never imports a kind.

import { type LineEnd, type Pt, type Style, arrowEnds } from "./base";
import { type Frame, toUser } from "./pdf";

export interface AnnotSpec {
  page: number;
  nm: string;
  subtype: string;
  rect: [number, number, number, number];
  appearance: { ops: string; bbox: [number, number, number, number]; opacity: number | null; fillOpacity: number | null; fonts: Record<string, string> };
  author?: string;
  modified?: string;
  created?: string;
  contents?: string;
  flags?: number;
  colour?: [number, number, number];
  interior?: [number, number, number];
  opacity?: number;
  borderWidth?: number;
  dash?: number[];
  line?: [number, number, number, number];
  lineEnds?: string[];
  vertices?: number[];
  ink?: number[][];
  cloud?: number;
  intent?: string;
  defaultAppearance?: string;
  defaultStyle?: string;
  quadding?: number;
  inset?: [number, number, number, number];
  rotate?: number;
  callout?: number[];
  /**
   * Vellum's own copy of the markup (reedit.ts), written as the private key /Vellum_Markup
   * beside the standard ones. Other apps ignore it.
   */
  vellum?: string;
  // Measuring
  /** A dimension's /Measure dictionary (dimension.ts MeasureSpec). */
  measure?: { ratio: string; unit: string; factor: number; precision: number };
  /** /Cap true and /CP /Top: a Line dimension shows its value as a caption above it. */
  caption?: boolean;

  // Stamps

  // Text markups
  /** The blend mode of the appearance's /GS0 (/BM), e.g. "Multiply" for highlights. */
  blend?: string;
  /** /QuadPoints for text markups: x1 y1 ... x4 y4 per quad, in user space. */
  quadPoints?: number[];
  /** /Name: a note's icon ("Comment", "Note"...). */
  icon?: string;
}

export type Change = { op: "add"; spec: AnnotSpec } | { op: "replace"; spec: AnnotSpec } | { op: "delete"; page: number; nm: string };

/** "D:20261114120000Z" from an ISO time. */
export function pdfDate(iso: string): string {
  const d = new Date(iso);
  const p = (v: number) => String(v).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Each line end as PDF names it (/LE). */
export const LE: Record<LineEnd, string> = { none: "None", open: "OpenArrow", filled: "ClosedArrow", dot: "Circle", bar: "Butt", slash: "Slash" };

/** Rounded to a thousandth (keeps the file small; far below anything visible). */
export const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Page points in user space, flattened to x, y, x, y... (/Vertices, /InkList). */
export const userPoints = (f: Frame, pts: Pt[]) => pts.flatMap((p) => toUser(f, p[0], p[1]).map(r3));

/** "#RRGGBB". */
export const hex = (c: [number, number, number]) => "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();

/** /RD: how far `inner` (user space) sits inside /Rect `box`, each side. */
export function boxInset(inner: [number, number, number, number], box: [number, number, number, number]): [number, number, number, number] {
  return [inner[0] - box[0], inner[1] - box[1], box[2] - inner[2], box[3] - inner[3]].map((v) => r3(Math.max(0, v))) as [number, number, number, number];
}

/**
 * /LE for a line with ends, and /IC: filled heads and dots are filled with the line's colour
 * (as PDF draws them); otherwise a line has no interior.
 */
export function lineEndsSpec(spec: { lineEnds?: string[]; interior?: [number, number, number] }, s: Style): void {
  const ends = arrowEnds(s);
  spec.lineEnds = ends.map((e) => LE[e]);
  if (ends.some((e) => e === "filled" || e === "dot")) spec.interior = s.stroke;
  else delete spec.interior;
}
