// A markup as the backend's annotation spec (src-tauri/src/annot/spec.rs), in PDF user space,
// with its appearance stream built from the same drawing operations as the overlay. Pure.

import { type LineEnd, type Markup, type Pt, arrowEnds, faceOf, fullText } from "./types";
import { fontResource } from "./fonts";
import { normRect } from "./types";
import { opsBounds, opsFor } from "./ops";
import { drawnDash } from "./dash";
import { type Frame, rectToUser, toContent, toUser } from "./pdf";

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
}

export type Change = { op: "add"; spec: AnnotSpec } | { op: "replace"; spec: AnnotSpec } | { op: "delete"; page: number; nm: string };

/** "D:20261114120000Z" from an ISO time. */
export function pdfDate(iso: string): string {
  const d = new Date(iso);
  const p = (v: number) => String(v).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Each end as PDF names it (/LE). */
const LE: Record<LineEnd, string> = { none: "None", open: "OpenArrow", filled: "ClosedArrow", dot: "Circle", bar: "Butt", slash: "Slash" };

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const flat = (f: Frame, pts: Pt[]) => pts.flatMap((p) => toUser(f, p[0], p[1]).map(r3));
const hex = (c: [number, number, number]) => "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();

/** The annotation for a markup on a page with frame `f`. */
export function toSpec(m: Markup, f: Frame): AnnotSpec {
  const ops = opsFor(m);
  const content = toContent(f, ops);
  const box = rectToUser(f, opsBounds(ops));
  const s = m.style;
  const spec: AnnotSpec = {
    page: m.page,
    nm: m.id,
    subtype: "Square",
    rect: box,
    appearance: { ops: content.ops, bbox: box, opacity: content.opacity, fillOpacity: content.fillOpacity, fonts: content.fonts },
    author: m.meta.author || undefined,
    modified: pdfDate(m.meta.modified),
    created: pdfDate(m.meta.created),
    flags: 4, // Print: markups print (agreed default)
    colour: s.stroke,
    borderWidth: s.width,
    // /BS /D as drawn, so an app that redraws the markup spaces it the same.
    dash: drawnDash(s.dash, s.width) ?? undefined,
    // No annotation-wide /CA: the line and fill have their own opacities, in the appearance.
  };
  if (s.fill) spec.interior = s.fill;
  switch (m.kind) {
    case "rect": {
      spec.subtype = "Square";
      // /RD: how far the drawn square (the outside of its stroke) sits inside /Rect.
      const inner = rectToUser(f, normRect([m.rect[0] - s.width / 2, m.rect[1] - s.width / 2, m.rect[2] + s.width / 2, m.rect[3] + s.width / 2]));
      spec.inset = [inner[0] - box[0], inner[1] - box[1], box[2] - inner[2], box[3] - inner[3]].map((v) => r3(Math.max(0, v))) as [number, number, number, number];
      break;
    }
    case "arrow": {
      spec.subtype = "Line";
      spec.line = [...toUser(f, m.from[0], m.from[1]), ...toUser(f, m.to[0], m.to[1])].map(r3) as [number, number, number, number];
      spec.lineEnds = arrowEnds(s).map((e) => LE[e]);
      // Filled heads and dots are filled with the line's colour (/IC, as PDF draws them).
      if (arrowEnds(s).some((e) => e === "filled" || e === "dot")) spec.interior = s.stroke;
      else delete spec.interior;
      break;
    }
    case "cloud":
      spec.subtype = "Polygon";
      spec.vertices = flat(f, m.vertices);
      spec.cloud = m.intensity;
      spec.intent = "PolygonCloud";
      break;
    case "text": {
      spec.subtype = "FreeText";
      spec.contents = m.text;
      // For apps that redraw the box themselves (Acrobat when it's edited there).
      const t = fullText(m.textStyle);
      const c = t.colour;
      const face = faceOf(t);
      const css = t.family === "times" ? "Times New Roman,serif" : t.family === "courier" ? "Courier New,monospace" : "Helvetica,sans-serif";
      const deco = [t.underline ? "underline" : "", t.strike ? "line-through" : ""].filter(Boolean).join(" ");
      spec.defaultAppearance = `${c.map((v) => r3(v)).join(" ")} rg /${fontResource(face)} ${r3(t.size)} Tf`;
      spec.defaultStyle =
        `font: ${t.italic ? "italic " : ""}${t.bold ? "bold " : ""}${r3(t.size)}pt ${css}; text-align:${t.align}; color:${hex(c)}` +
        (deco ? `; text-decoration:${deco}` : "");
      spec.quadding = t.align === "center" ? 1 : t.align === "right" ? 2 : 0;
      // FreeText: /C is the background (ISO 32000-1, 12.5.6.6), not the border.
      delete spec.colour;
      delete spec.interior;
      if (s.fill) spec.colour = s.fill;
      // Acrobat keeps text upright on a rotated page, when it redraws it, by this.
      if (f.quarterTurns % 4) spec.rotate = (((f.quarterTurns % 4) + 4) % 4) * 90;
      break;
    }
    case "ink":
      spec.subtype = "Ink";
      spec.ink = m.strokes.map((st) => flat(f, st));
      delete spec.interior;
      break;
  }
  return spec;
}
