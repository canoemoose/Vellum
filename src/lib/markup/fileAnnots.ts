// Annotations already in the file, into the markup model (phase 7b; docs/editing-phase7-scope.md).
// The backend reads them (src-tauri/src/annot/read.rs, annot_read) in PDF user space; this maps
// each onto the page. One that carries Vellum's own entry (reedit.ts), unchanged since Vellum
// wrote it, comes back exactly as drawn. Anything else is mapped from the standard keys as far
// as they go; a type Vellum doesn't understand becomes a "foreign" markup, which can be moved or
// deleted but not restyled. Pure.

import { type LineEnd, type Markup, type MarkupKind, type Pt, type Rect, type Rgb, type Style, type TextStyle, DEFAULT_TEXT, LINE_STYLE, normRect } from "./base";
import type { Family } from "./fonts";
import { type Frame, toPage } from "./pdf";
import { LE } from "./annotation";
import { readReedit } from "./reedit";
import { KINDS, defOf, kindOf } from "./kinds";
import type { MarkQuad, TextMarkVariant } from "./kinds/textmark";
import { textMarkStyle } from "./kinds/textmark";
// Dimensions (stage 5)
import { type DimEnds, newMeasure } from "./dimension";
import { type MeasureLengthMarkup, valueFromCaption } from "./kinds/measureLength";

/** One annotation as annot_read gives it (read.rs FileAnnot), in user space. */
export interface FileAnnot {
  index: number;
  subtype: string;
  nm: string | null;
  rect: [number, number, number, number];
  flags: number;
  colour: number[] | null;
  interior: number[] | null;
  opacity: number | null;
  borderWidth: number | null;
  dash: number[] | null;
  cloud: number | null;
  line: [number, number, number, number] | null;
  lineEnds: string[] | null;
  vertices: number[] | null;
  ink: number[][] | null;
  quadPoints: number[] | null;
  callout: number[] | null;
  inset: [number, number, number, number] | null;
  intent: string | null;
  contents: string | null;
  author: string | null;
  modified: string | null;
  created: string | null;
  defaultAppearance: string | null;
  defaultStyle: string | null;
  quadding: number | null;
  name: string | null;
  rotate: number | null;
  vellum: string | null;
  measured: boolean;
  // Notes (tool consistency stage 7)
  /** A Text annotation's pop-up's /Open: true pinned open, false closed, null or absent when it has no pop-up. */
  popupOpen?: boolean | null;
  // Dimensions (stage 5): optional, so readers older than it still type-check.
  /** A Line's /LL, /LLE, /LLO (0 where absent), when it has /LL. */
  leader?: [number, number, number] | null;
  /** A Line's /CO. */
  captionOffset?: [number, number] | null;
}

export interface PageAnnots {
  page: number;
  frame: Frame;
  annots: FileAnnot[];
}

/** What annot_read returns. */
export interface AnnotRead {
  pages: PageAnnots[];
  ms: number;
}

/** Where a markup that came with the file sits in it, and what it was. */
export interface FileOrigin {
  page: number;
  /** Position in the page's /Annots: PDFium's annotation index, and how the writer finds it. */
  index: number;
  /** Its /NM in the file, if it had one (else its id was made up here and it's found by index). */
  nm: string | null;
  subtype: string;
  /** Vellum wrote it and nobody has changed it since: it came back exactly as drawn. */
  exact: boolean;
}

export interface FromFile {
  markup: Markup;
  origin: FileOrigin;
}

// ---------------------------------------------------------------- small conversions

/** /C or /IC as RGB: grey, RGB or CMYK; none for an empty array (transparent). */
export function colourOf(c: number[] | null | undefined): Rgb | null {
  if (!c || !c.length) return null;
  const k = (v: number) => Math.min(1, Math.max(0, v));
  if (c.length === 1) return [k(c[0]), k(c[0]), k(c[0])];
  if (c.length === 4) return [0, 1, 2].map((i) => k((1 - c[i]) * (1 - c[3]))) as Rgb;
  if (c.length >= 3) return [k(c[0]), k(c[1]), k(c[2])];
  return null;
}

/** A PDF date ("D:20261115100000Z", "D:20261115100000+01'00'", or shorter) as an ISO time. */
export function parsePdfDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*([Zz+-])?\s*(\d{2})?'?(\d{2})?'?/.exec(s.trim());
  if (!m) return null;
  const n = (v: string | undefined, d: number) => (v === undefined ? d : Number(v));
  let t = Date.UTC(n(m[1], 0), n(m[2], 1) - 1, n(m[3], 1), n(m[4], 0), n(m[5], 0), n(m[6], 0));
  if (m[7] === "+" || m[7] === "-") t -= (m[7] === "+" ? 1 : -1) * (n(m[8], 0) * 60 + n(m[9], 0)) * 60000;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** /LE names back to line ends ("Square" and "Diamond" have no Vellum end: drawn as none). */
const END_OF: Record<string, LineEnd> = Object.fromEntries(Object.entries(LE).map(([k, v]) => [v, k as LineEnd]));
END_OF.ROpenArrow = "open";
END_OF.RClosedArrow = "filled";
const endOf = (n: string | undefined): LineEnd => (n && END_OF[n]) || "none";

/** A flat x, y, x, y... list in user space as page points. */
function pts(f: Frame, v: number[] | null | undefined): Pt[] {
  const out: Pt[] = [];
  if (!v) return out;
  for (let i = 0; i + 1 < v.length; i += 2) out.push(toPage(f, v[i], v[i + 1]));
  return out;
}

/** A user-space box as a page rectangle. */
function pageRect(f: Frame, r: [number, number, number, number]): Rect {
  const a = toPage(f, r[0], r[1]);
  const b = toPage(f, r[2], r[3]);
  return normRect([a[0], a[1], b[0], b[1]]);
}

/** /Rect less /RD, as a page rectangle. */
function innerRect(f: Frame, a: FileAnnot): Rect {
  const [x0, y0, x1, y1] = a.rect;
  const d = a.inset ?? [0, 0, 0, 0];
  const r: [number, number, number, number] = [x0 + d[0], y0 + d[1], x1 - d[2], y1 - d[3]];
  return pageRect(f, r[2] > r[0] && r[3] > r[1] ? r : a.rect);
}

/** A rectangle shrunk by d each side (never past its middle). */
function shrink(r: Rect, d: number): Rect {
  const dx = Math.min(d, (r[2] - r[0]) / 2), dy = Math.min(d, (r[3] - r[1]) / 2);
  return [r[0] + dx, r[1] + dy, r[2] - dx, r[3] - dy];
}

/** The common style from /C, /IC, /BS and /CA. */
function styleOf(a: FileAnnot, base: Style = LINE_STYLE): Style {
  const op = a.opacity ?? 1;
  const w = a.borderWidth ?? 1;
  return {
    ...base,
    stroke: colourOf(a.colour) ?? base.stroke,
    width: w,
    fill: colourOf(a.interior),
    opacity: op,
    fillOpacity: op,
    dash: a.dash && a.dash.length && a.dash.some((d) => d > 0) ? a.dash : null,
  };
}

/** The text style from a FreeText's /DA ("0 0 1 rg /Helv 12 Tf") and /Q. */
export function textStyleOf(da: string | null | undefined, q: number | null | undefined): TextStyle {
  const t: TextStyle = { ...DEFAULT_TEXT };
  if (da) {
    const tf = /\/([^\s/]+)\s+([\d.]+)\s+Tf/.exec(da);
    if (tf) {
      const name = tf[1].toLowerCase();
      const size = Number(tf[2]);
      if (size > 0) t.size = size;
      let family: Family = "helvetica";
      if (/^(ti|times)/.test(name)) family = "times";
      else if (/^(co|cour)/.test(name)) family = "courier";
      t.family = family;
      t.bold = /bo|bold|black|heavy/.test(name.replace(/^(cour|co)/, ""));
      t.italic = /it|obl|italic|oblique/.test(name.replace(/^(ti|times)/, ""));
    }
    const rg = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
    const g = /(?:^|\s)([\d.]+)\s+g(?:\s|$)/.exec(da);
    if (rg) t.colour = [Number(rg[1]), Number(rg[2]), Number(rg[3])];
    else if (g) t.colour = [Number(g[1]), Number(g[1]), Number(g[1])];
  }
  t.align = q === 1 ? "center" : q === 2 ? "right" : "left";
  return t;
}

/** /QuadPoints as quads (top left, top right, bottom left, bottom right as the text reads). */
function quadsOf(f: Frame, q: number[] | null): MarkQuad[] {
  const out: MarkQuad[] = [];
  if (!q) return out;
  for (let i = 0; i + 7 < q.length; i += 8) {
    const p = pts(f, q.slice(i, i + 8));
    out.push([p[0], p[1], p[2], p[3]]);
  }
  return out;
}

// ---------------------------------------------------------------- Vellum's own entry

/**
 * The markup from Vellum's own entry, if it can be trusted: readable, unchanged since Vellum
 * wrote it (its /M), of a kind this Vellum has, and where the annotation is (the page wasn't
 * turned since, say). Null otherwise.
 */
function fromEntry(a: FileAnnot, page: number, f: Frame, id: string): Markup | null {
  const raw = readReedit(a.vellum, a.modified) as Partial<Markup> | null;
  if (!raw || typeof raw.kind !== "string" || !(raw.kind in KINDS) || kindOf(raw.kind as MarkupKind).fixed) return null;
  if (!raw.style || typeof raw.style !== "object" || !raw.meta || typeof raw.meta !== "object") return null;
  const m = { ...raw, id, page } as Markup;
  let b: Rect;
  try {
    b = defOf(m).bounds(m);
  } catch {
    return null;
  }
  // Its middle must be inside the annotation's box, with room to spare for what it draws
  // outside its geometry (line ends, a note's icon drawn at another zoom).
  const r = pageRect(f, a.rect);
  const slack = 5 + 0.25 * Math.max(r[2] - r[0], r[3] - r[1]);
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  if (!(cx >= r[0] - slack && cx <= r[2] + slack && cy >= r[1] - slack && cy <= r[3] + slack)) return null;
  return m;
}

// ---------------------------------------------------------------- the standard keys

const VARIANT: Record<string, TextMarkVariant> = { Highlight: "highlight", Underline: "underline", Squiggly: "underline", StrikeOut: "strike" };

/** The geometry and kind from the standard keys; null for a type mapped to "foreign". */
function fromKeys(a: FileAnnot, f: Frame): (Record<string, unknown> & { kind: MarkupKind; style: Style }) | null {
  const style = styleOf(a);
  const half = style.width / 2;
  switch (a.subtype) {
    case "Square":
    case "Circle": {
      const r = shrink(innerRect(f, a), half);
      if (a.cloud !== null && a.subtype === "Square") return { kind: "cloud", vertices: [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], intensity: a.cloud || 1, style };
      return { kind: a.subtype === "Square" ? "rect" : "ellipse", rect: r, style };
    }
    case "Line": {
      if (!a.line) return null;
      const [from, to] = pts(f, a.line);
      // Dimensions (stage 5): a line dimension is a Length, pulled out and its value moved as saved.
      if (a.intent === "LineDimension") return lineDimension(a, from, to, style);
      return { kind: "arrow", from, to, style: { ...style, fill: null, ends: [endOf(a.lineEnds?.[0]), endOf(a.lineEnds?.[1])] } };
    }
    case "PolyLine": {
      const v = pts(f, a.vertices);
      if (v.length < 2) return null;
      return { kind: "polyline", vertices: v, style: { ...style, fill: null, ends: [endOf(a.lineEnds?.[0]), endOf(a.lineEnds?.[1])] } };
    }
    case "Polygon": {
      const v = pts(f, a.vertices);
      if (v.length < 3) return null;
      if (a.cloud !== null || a.intent === "PolygonCloud") return { kind: "cloud", vertices: v, intensity: a.cloud || 1, style };
      return { kind: "polygon", vertices: v, style };
    }
    case "Ink": {
      const strokes = (a.ink ?? []).map((s) => pts(f, s)).filter((s) => s.length > 0);
      if (!strokes.length) return null;
      return { kind: "ink", strokes, style: { ...style, fill: null } };
    }
    case "FreeText": {
      const textStyle = textStyleOf(a.defaultAppearance, a.quadding);
      const rect = innerRect(f, a);
      // FreeText's /C is its background; the border takes the text's colour.
      const typewriter = a.intent === "FreeTextTypewriter";
      const s: Style = { ...style, stroke: textStyle.colour, fill: colourOf(a.colour), width: typewriter ? 0 : (a.borderWidth ?? 1) };
      const text = a.contents ?? "";
      const cl = pts(f, a.callout);
      if (a.intent === "FreeTextCallout" && cl.length >= 2) {
        const head = endOf(a.lineEnds?.[0]);
        return { kind: "callout", tip: cl[0], elbow: cl.length >= 3 ? cl[1] : null, rect, text, textStyle, style: { ...s, ends: ["none", head] } };
      }
      return { kind: "text", rect, text, textStyle, style: s };
    }
    case "Highlight":
    case "Underline":
    case "Squiggly":
    case "StrikeOut": {
      const quads = quadsOf(f, a.quadPoints);
      if (!quads.length) return null;
      const variant = VARIANT[a.subtype];
      const base = textMarkStyle(variant);
      // No /CA is opaque (as the file draws it), whatever Vellum starts new ones at.
      return { kind: "textmark", variant, quads, text: a.contents ?? "", style: { ...base, stroke: colourOf(a.colour) ?? base.stroke, opacity: a.opacity ?? 1 } };
    }
    case "Text": {
      const r = pageRect(f, a.rect);
      const base = kindOf("note").defaultStyle();
      const pinned = a.popupOpen === true; // stage 7: pinned open when its pop-up is open
      return { kind: "note", at: [r[0], r[1]], text: a.contents ?? "", ...(pinned ? { pinned } : {}), style: { ...base, stroke: colourOf(a.colour) ?? base.stroke, opacity: a.opacity ?? 1 } };
    }
    default:
      return null;
  }
}

// Dimensions (stage 5)
/** /LE back to a dimension's ends. */
const DIM_END_OF: Record<string, DimEnds> = { Butt: "bar", Slash: "tick", ClosedArrow: "arrow", OpenArrow: "arrow", RClosedArrow: "arrow", ROpenArrow: "arrow" };

/**
 * A file's line dimension as a Length: /LL (same units as /L, and the same anticlockwise
 * normal: see measureLength.ts lengthFrame) is its offset, /CO where its value was moved to. Its
 * scale is left for the app to fill in from the page, as for one being drawn, and its look is
 * the measuring tools' for the parts the file doesn't say.
 */
function lineDimension(a: FileAnnot, from: Pt, to: Pt, style: Style): Record<string, unknown> & { kind: MarkupKind; style: Style } {
  const m = {
    kind: "measureLength" as const,
    from,
    to,
    offset: a.leader?.[0] ?? 0,
    ...newMeasure(),
    ...(a.lineEnds?.[0] && DIM_END_OF[a.lineEnds[0]] ? { ends: DIM_END_OF[a.lineEnds[0]] } : {}),
    style: { ...style, fill: null },
  };
  const co = a.captionOffset;
  if (!co || (Math.abs(co[0]) < 0.01 && Math.abs(co[1]) < 0.01)) return m;
  const value = valueFromCaption({ ...m, id: "", page: 0, meta: { author: "", created: "", modified: "" } } as MeasureLengthMarkup, co);
  return Math.hypot(...value) > 0.05 ? { ...m, value } : m;
}

/** The id an annotation gets: its /NM when it has one not already taken, else one from its place. */
function idFor(a: FileAnnot, page: number, used: Set<string>): string {
  if (a.nm && !used.has(a.nm)) return a.nm;
  let id = `file-p${page}-a${a.index}`;
  for (let i = 2; used.has(id); i++) id = `file-p${page}-a${a.index}-${i}`;
  return id;
}

/**
 * A page's annotations as markups, each with where it is in the file. `used` holds ids already
 * taken (and gains these): an /NM seen twice gets an id of its own the second time.
 */
export function fromFile(p: PageAnnots, used: Set<string>, now = new Date().toISOString()): FromFile[] {
  const out: FromFile[] = [];
  for (const a of p.annots) {
    const id = idFor(a, p.page, used);
    used.add(id);
    const origin: FileOrigin = { page: p.page, index: a.index, nm: a.nm, subtype: a.subtype, exact: false };
    const exact = a.vellum ? fromEntry(a, p.page, p.frame, id) : null;
    if (exact) {
      // Stage 7: a note's pin follows its pop-up, which another app may open or close without changing the note.
      if (exact.kind === "note" && typeof a.popupOpen === "boolean" && a.popupOpen !== !!exact.pinned) exact.pinned = a.popupOpen;
      out.push({ markup: exact, origin: { ...origin, exact: true } });
      continue;
    }
    const created = parsePdfDate(a.created) ?? parsePdfDate(a.modified) ?? now;
    const meta = { author: a.author ?? "", created, modified: parsePdfDate(a.modified) ?? created };
    const keys = fromKeys(a, p.frame);
    const markup = keys
      ? ({ id, page: p.page, meta, ...keys } as unknown as Markup)
      : ({ id, page: p.page, meta, kind: "foreign", subtype: a.subtype, rect: pageRect(p.frame, a.rect), moved: [0, 0], text: a.contents ?? "", style: kindOf("foreign").defaultStyle() } as Markup);
    out.push({ markup, origin });
  }
  return out;
}

/**
 * Whether a markup that came with the file may be changed without unlocking the document
 * (docs/editing-phase7-scope.md, 7b "Assumed" 1): only Vellum's own markups, back exactly as
 * drawn, whose author is you. Everything else needs "Edit document" unlocked.
 */
export function freeToEdit(origin: FileOrigin, m: Markup, author: string): boolean {
  return origin.exact && !!author && m.meta.author.trim().toLowerCase() === author.trim().toLowerCase();
}

/** Image stamps brought back from Vellum's entry: their pictures' hashes (annot_stamp_images fills them in). */
export function stampHashes(ms: Markup[]): string[] {
  const out = new Set<string>();
  for (const m of ms) if (m.kind === "stamp" && m.content.type === "image" && !m.content.png) out.add(m.content.hash);
  return [...out];
}

/** Those stamps with their pictures (by hash, as annot_stamp_images returns them). */
export function withStampImages(ms: Markup[], pngs: Record<string, string>): Markup[] {
  return ms.map((m) => {
    if (m.kind !== "stamp" || m.content.type !== "image" || m.content.png) return m;
    const png = pngs[m.content.hash.toLowerCase()];
    return png ? { ...m, content: { ...m.content, png } } : m;
  });
}
