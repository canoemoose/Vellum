// The annotation spec the backend writes (src-tauri/src/annot/spec.rs), in PDF user space, and
// the small pieces each kind uses to fill in its part of one. spec.ts builds the common part
// and hands the rest to the kind's file under kinds/. Pure, and a leaf: never imports a kind.

import type { LineEnd, Pt } from "./base";
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
  // Measuring

  // Stamps

  // Text markups
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
