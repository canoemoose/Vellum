// A page's text layer as the backend sends it (doc_text_layer, src-tauri/src/text.rs): every
// character PDFium found, in its reading order, with a box in page points (y down, the page as
// rendered), plus the page's links. Pure.

/** [x0, y0, x1, y1] in page points, y down. */
export type Box = [number, number, number, number];

export interface TextLink {
  rects: Box[];
  /** A web address. */
  uri: string | null;
  /** A page in this document. */
  page: number | null;
  /** Target position from the top of that page, when given. */
  y: number | null;
}

export interface TextLayer {
  /** Characters (PDFium char indices 0..n-1). */
  n: number;
  codes: Uint32Array;
  /** 4 per character. Zero for characters without a box. */
  boxes: Float32Array;
  flags: Uint8Array;
  links: TextLink[];
}

const GENERATED = 1;
const HAS_BOX = 2;

/** An empty layer (images, scans, pages without text). */
export const EMPTY_LAYER: TextLayer = { n: 0, codes: new Uint32Array(0), boxes: new Float32Array(0), flags: new Uint8Array(0), links: [] };

/** Decode doc_text_layer's bytes (layout in text.rs, encode_layer). */
export function parseTextLayer(buf: ArrayBuffer): TextLayer {
  if (buf.byteLength < 8) return EMPTY_LAYER;
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  // Copies, so the views are aligned whatever offset the IPC buffer had.
  const codes = new Uint32Array(n);
  for (let i = 0; i < n; i++) codes[i] = dv.getUint32(4 + 4 * i, true);
  const bo = 4 + 4 * n;
  const boxes = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) boxes[i] = dv.getFloat32(bo + 4 * i, true);
  const fo = bo + 16 * n;
  const flags = new Uint8Array(buf.slice(fo, fo + n));
  const jo = Math.ceil((fo + n) / 4) * 4;
  const len = dv.getUint32(jo, true);
  const json = new TextDecoder().decode(new Uint8Array(buf, jo + 4, len));
  const links = JSON.parse(json) as TextLink[];
  return { n, codes, boxes, flags, links };
}

export const hasBox = (l: TextLayer, i: number): boolean => (l.flags[i] & HAS_BOX) !== 0;
export const isGenerated = (l: TextLayer, i: number): boolean => (l.flags[i] & GENERATED) !== 0;

export function boxOf(l: TextLayer, i: number): Box {
  const k = i * 4;
  return [l.boxes[k], l.boxes[k + 1], l.boxes[k + 2], l.boxes[k + 3]];
}

export function charAt(l: TextLayer, i: number): string {
  const c = l.codes[i];
  return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : "";
}

/**
 * The text of characters [a, b). Line breaks PDFium inferred (\r\n) become \n; other control
 * characters (soft hyphens reported as U+0002 and the like) are dropped.
 */
export function textOf(l: TextLayer, a: number, b: number): string {
  let s = "";
  for (let i = Math.max(0, a); i < Math.min(l.n, b); i++) s += charAt(l, i);
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

/** Whether a character is part of a word (letters, digits, underscore, apostrophes inside). */
export function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch);
}
