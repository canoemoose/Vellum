// What a stamp holds and how it's drawn, before it's placed: text stamp layouts (rounded border,
// bold capitals, an optional second line), signature strokes as paths, and images. The stamp
// kind (kinds/stamp.ts) scales these into its box. Pure, and a leaf: never imports a kind.

import type { Pt, Rect, Rgb } from "./base";
import type { Op, PathOp, Seg, TextOp } from "./draw";
import { arc } from "./draw";
import { type Face, textWidth } from "./fonts";

/** A drawn signature's strokes: pad pixels, each flat [x, y, x, y, ...], as the library stores them. */
export interface StrokesContent {
  type: "strokes";
  strokes: number[][];
  /** Pen width in pad pixels. */
  pen: number;
  colour: Rgb;
}

/** A PNG (an imported signature, or an image stamp). */
export interface ImageContent {
  type: "image";
  /** The PNG, base64. Never logged; a signature's never leaves Vellum except into the file. */
  png: string;
  /** Hex SHA-256 of the PNG bytes. */
  hash: string;
  /** Pixels. */
  w: number;
  h: number;
}

/** A text stamp: APPROVED, FOR COMMENT, SUPERSEDED or your own wording. */
export interface TextContent {
  type: "text";
  /** Shown in capitals. */
  label: string;
  /** The second line (name and date), or none. */
  sub: string | null;
  colour: Rgb;
}

export type StampContent = StrokesContent | ImageContent | TextContent;

/** The built-in text stamps, with the colour each starts in. */
export const BUILT_IN: { label: string; colour: Rgb }[] = [
  { label: "APPROVED", colour: [0.1, 0.55, 0.2] },
  { label: "FOR COMMENT", colour: [0.05, 0.35, 0.8] },
  { label: "SUPERSEDED", colour: [0.85, 0.1, 0.1] },
];

/** The colours a text stamp can be. */
export const STAMP_COLOURS: { name: string; c: Rgb }[] = [
  { name: "Green", c: [0.1, 0.55, 0.2] },
  { name: "Blue", c: [0.05, 0.35, 0.8] },
  { name: "Red", c: [0.85, 0.1, 0.1] },
  { name: "Black", c: [0, 0, 0] },
];

/** The /Name a text stamp saves with: Acrobat's standard names where one fits. */
export function stampName(c: StampContent, signature: boolean): string {
  if (signature) return "Signature";
  if (c.type !== "text") return "Image";
  const std: Record<string, string> = { APPROVED: "Approved", "FOR COMMENT": "ForComment", SUPERSEDED: "Superseded" };
  return std[c.label.toUpperCase()] ?? "Custom";
}

/** "15 Nov 2026". */
export function stampDate(d: Date): string {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${d.getDate()} ${m} ${d.getFullYear()}`;
}

/** The second line a text stamp starts with: the author and today. */
export function defaultSub(author: string, d: Date): string {
  const a = author.trim();
  return a ? `${a}, ${stampDate(d)}` : stampDate(d);
}

/** Tidy a custom wording: one line, trimmed, capped. */
export function cleanLabel(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 60).toUpperCase();
}

// ---------------------------------------------------------------- text stamp layout

const BOLD: Face = { family: "helvetica", bold: true, italic: false };
const PLAIN: Face = { family: "helvetica", bold: false, italic: false };
/** Natural sizes, points: the stamp is scaled to its box, so only the proportions matter. */
const MAIN = 24;
const SUB = 10;
const PAD_X = 10;
const PAD_Y = 7;
const BORDER = 2.5;
const RADIUS = 6;
/** Helvetica's cap height and descender, as shares of the size. */
const CAP = 0.718;
const DESC = 0.21;

/** A text stamp's natural size, points. */
export function textSize(c: TextContent): [number, number] {
  const label = c.label.toUpperCase();
  const wMain = textWidth(label, MAIN, BOLD);
  const wSub = c.sub ? textWidth(c.sub, SUB, PLAIN) : 0;
  const w = Math.max(wMain, wSub, MAIN) + 2 * (PAD_X + BORDER);
  const h = 2 * (PAD_Y + BORDER) + CAP * MAIN + (c.sub ? 0.35 * MAIN + CAP * SUB + DESC * SUB : 0);
  return [w, h];
}

/** A rounded rectangle, inset by d. */
function rounded(x0: number, y0: number, x1: number, y1: number, r: number): Seg[] {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  return [
    ["M", x0 + r, y0],
    ["L", x1 - r, y0],
    ...arc([x1 - r, y0 + r], r, [0, -1], [1, 0], [1, -1]),
    ["L", x1, y1 - r],
    ...arc([x1 - r, y1 - r], r, [1, 0], [0, 1], [1, 1]),
    ["L", x0 + r, y1],
    ...arc([x0 + r, y1 - r], r, [0, 1], [-1, 0], [-1, 1]),
    ["L", x0, y0 + r],
    ...arc([x0 + r, y0 + r], r, [-1, 0], [0, -1], [-1, -1]),
    ["Z"],
  ];
}

/** A text stamp's drawing at natural size, its top left at (0, 0). */
export function textOps(c: TextContent): Op[] {
  const [w, h] = textSize(c);
  const label = c.label.toUpperCase();
  const border: PathOp = {
    t: "path", segs: rounded(BORDER / 2, BORDER / 2, w - BORDER / 2, h - BORDER / 2, RADIUS), stroke: c.colour, fill: null,
    width: BORDER, dash: null, strokeOpacity: 1, fillOpacity: 1,
  };
  const line = (text: string, size: number, face: Face, base: number): TextOp => ({
    t: "text", lines: [text], origin: [0, base], dir: [1, 0], size, leading: size, colour: c.colour, clip: null, face,
    offsets: [(w - textWidth(text, size, face)) / 2],
  });
  const base1 = BORDER + PAD_Y + CAP * MAIN;
  const ops: Op[] = [border, line(label, MAIN, BOLD, base1)];
  if (c.sub) ops.push(line(c.sub, SUB, PLAIN, base1 + 0.35 * MAIN + CAP * SUB));
  return ops;
}

// ---------------------------------------------------------------- strokes

/** Strokes' extent, pen included: [x0, y0, x1, y1] in pad pixels. */
export function strokesBox(c: StrokesContent): Rect {
  let b: Rect = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of c.strokes) for (let i = 0; i + 1 < s.length; i += 2) b = [Math.min(b[0], s[i]), Math.min(b[1], s[i + 1]), Math.max(b[2], s[i]), Math.max(b[3], s[i + 1])];
  if (!Number.isFinite(b[0])) return [0, 0, 1, 1];
  const p = c.pen / 2;
  return [b[0] - p, b[1] - p, b[2] + p, b[3] + p];
}

/**
 * Strokes as one path at natural size (pad pixels, top left of the ink at 0, 0): curves through
 * the midpoints as the pad draws them (signature/strokes.ts, trace), quadratics written as
 * cubics; a single point is a dot (a line too short to see, its round caps a circle).
 */
export function strokesOps(c: StrokesContent): Op[] {
  const [bx, by] = strokesBox(c);
  const segs: Seg[] = [];
  for (const flat of c.strokes) {
    const p: Pt[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) p.push([flat[i] - bx, flat[i + 1] - by]);
    if (!p.length) continue;
    segs.push(["M", p[0][0], p[0][1]]);
    if (p.length === 1) {
      segs.push(["L", p[0][0] + 0.001, p[0][1]]);
      continue;
    }
    if (p.length === 2) {
      segs.push(["L", p[1][0], p[1][1]]);
      continue;
    }
    let cur = p[0];
    for (let i = 1; i < p.length - 1; i++) {
      const q = p[i];
      const end: Pt = [(p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2];
      segs.push(["C", cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1]), end[0] + (2 / 3) * (q[0] - end[0]), end[1] + (2 / 3) * (q[1] - end[1]), end[0], end[1]]);
      cur = end;
    }
    const last = p[p.length - 1];
    segs.push(["L", last[0], last[1]]);
  }
  return [{ t: "path", segs, stroke: c.colour, fill: null, width: c.pen, dash: null, strokeOpacity: 1, fillOpacity: 1 }];
}

// ---------------------------------------------------------------- any content

/** A content's natural size (any units; only the aspect matters to the box). */
export function naturalSize(c: StampContent): [number, number] {
  if (c.type === "text") return textSize(c);
  if (c.type === "image") return [Math.max(1, c.w), Math.max(1, c.h)];
  const b = strokesBox(c);
  return [Math.max(1e-3, b[2] - b[0]), Math.max(1e-3, b[3] - b[1])];
}

/** Width over height. */
export function aspectOf(c: StampContent): number {
  const [w, h] = naturalSize(c);
  return w / h;
}

/** Operations scaled by k about the origin, then moved by (dx, dy). */
export function transformOps(ops: Op[], k: number, dx: number, dy: number): Op[] {
  const P = (x: number, y: number): [number, number] => [x * k + dx, y * k + dy];
  return ops.map((op): Op => {
    if (op.t === "path") {
      const segs = op.segs.map((s): Seg => {
        if (s[0] === "M" || s[0] === "L") return [s[0], ...P(s[1], s[2])];
        if (s[0] === "C") return ["C", ...P(s[1], s[2]), ...P(s[3], s[4]), ...P(s[5], s[6])];
        return s;
      });
      return { ...op, segs, width: op.width * k, dash: op.dash?.map((d) => d * k) ?? null };
    }
    if (op.t === "text") {
      return { ...op, origin: P(op.origin[0], op.origin[1]), size: op.size * k, leading: op.leading * k, offsets: op.offsets.map((o) => o * k), clip: op.clip?.map((p) => P(p[0], p[1])) ?? null };
    }
    return { ...op, rect: [op.rect[0] * k + dx, op.rect[1] * k + dy, op.rect[2] * k + dx, op.rect[3] * k + dy] };
  });
}

/** A content drawn to fill `r` (page points; r has the content's aspect). */
export function contentOps(c: StampContent, r: Rect): Op[] {
  const [w] = naturalSize(c);
  const k = (r[2] - r[0]) / w;
  if (c.type === "image") return [{ t: "image", rect: r, png: c.png, hash: c.hash }];
  return transformOps(c.type === "text" ? textOps(c) : strokesOps(c), k, r[0], r[1]);
}

/** The resource name an image is drawn under in an appearance stream (the same for one hash). */
export const imageResName = (hash: string) => `Im${hash.slice(0, 16).toLowerCase()}`;

// ---------------------------------------------------------------- bytes

/** Bytes as base64. */
export function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Base64 back to bytes. */
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Hex SHA-256. */
export async function sha256(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b as BufferSource);
  return [...new Uint8Array(d)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** A PNG's size in pixels from its header, or null if it isn't a PNG. */
export function pngSize(b: Uint8Array): [number, number] | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || sig.some((v, i) => b[i] !== v)) return null;
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const w = u32(16), h = u32(20);
  return w > 0 && h > 0 ? [w, h] : null;
}

/** An image content from PNG bytes. */
export async function imageContent(png: Uint8Array): Promise<ImageContent | null> {
  const size = pngSize(png);
  if (!size) return null;
  return { type: "image", png: toBase64(png), hash: await sha256(png), w: size[0], h: size[1] };
}

/** A drawn signature's content from the library's stored strokes (signature/strokes.ts form). */
export function strokesContent(stored: { strokes: { x: number; y: number }[][]; pen: number; colour: string }): StrokesContent | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(stored.colour);
  if (!m || !stored.strokes.length) return null;
  return {
    type: "strokes",
    strokes: stored.strokes.map((s) => s.flatMap((p) => [p.x, p.y])),
    pen: stored.pen,
    colour: [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255],
  };
}

// ---------------------------------------------------------------- the picker's settings

/** What the Stamp tool's picker remembers (settings.ts). Never a signature. */
export interface StampPrefs {
  /** Text stamps get the second line (name and date). */
  sub: boolean;
  /** Text stamps' colour; null for each stamp's own. */
  colour: Rgb | null;
  /** The last custom wording. */
  custom: string;
  /**
   * Stage 8: what the Stamp and Signature tools last placed, so picking the tool goes straight
   * to placing. By reference only: a text stamp's wording and colour, an image stamp's or a
   * signature's id in its library. A signature's picture or strokes never go here.
   */
  last: { stamp?: StampRef; signature?: string };
}

/** A stamp by reference (stage 8): what to arm again, never the picture itself. */
export type StampRef = { type: "text"; label: string; colour: Rgb } | { type: "image"; id: string };

const isRgb = (c: unknown): c is Rgb => Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === "number" && v >= 0 && v <= 1);
/** A library id: what the stamp and signature libraries hand out (hex, or a UUID's hex and dashes). */
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{1,64}$/i.test(v);

function sanitiseRef(raw: unknown): StampRef | undefined {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (o.type === "text" && typeof o.label === "string" && cleanLabel(o.label) && isRgb(o.colour)) return { type: "text", label: cleanLabel(o.label), colour: o.colour };
  if (o.type === "image" && isId(o.id)) return { type: "image", id: o.id };
  return undefined;
}

export function sanitiseStampPrefs(raw: unknown): StampPrefs {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const colour = isRgb(o.colour) ? o.colour : null;
  const l = (o.last && typeof o.last === "object" ? o.last : {}) as Record<string, unknown>;
  const stamp = sanitiseRef(l.stamp);
  const last = { ...(stamp ? { stamp } : {}), ...(isId(l.signature) ? { signature: l.signature } : {}) };
  return { sub: o.sub !== false, colour, custom: typeof o.custom === "string" ? cleanLabel(o.custom) : "", last };
}

/** Stage 8: the reference a picked stamp is remembered by (an image stamp needs its library id). */
export function refOf(c: StampContent, imageId?: string): StampRef | undefined {
  if (c.type === "text") return { type: "text", label: c.label, colour: c.colour };
  return c.type === "image" && imageId ? { type: "image", id: imageId } : undefined;
}

/** Stage 8: a text stamp from its reference, with the date line or not. */
export const textFromRef = (r: Extract<StampRef, { type: "text" }>, sub: string | null): TextContent => ({ type: "text", label: r.label, sub, colour: r.colour });
