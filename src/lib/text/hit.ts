// Finding characters under the pointer, words and lines, and turning a run of characters into
// highlight rectangles. Pure, over a TextLayer.

import { type Box, type TextLayer, boxOf, charAt, hasBox, isGenerated, isWordChar } from "./layer";

const CELL = 24; // grid cell, points

/**
 * A uniform grid over the characters' boxes, so the pointer's character is found without
 * scanning a page of 300,000 characters on every move. Built once per layer.
 */
export class CharIndex {
  private cells = new Map<number, number[]>();

  constructor(readonly layer: TextLayer) {
    for (let i = 0; i < layer.n; i++) {
      if (!hasBox(layer, i)) continue;
      const [x0, y0, x1, y1] = boxOf(layer, i);
      const [i0, j0, i1, j1] = [cell(x0), cell(y0), cell(x1), cell(y1)];
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 64) continue; // a huge glyph box: skip, not worth a hundred cells
      for (let cj = j0; cj <= j1; cj++)
        for (let ci = i0; ci <= i1; ci++) {
          const k = key(ci, cj);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(i);
        }
    }
  }

  /**
   * The character nearest (x, y) within `tol` points (0 = inside its box), or null. Ties go to
   * the smaller box, so a small character on a big one is reachable.
   */
  nearest(x: number, y: number, tol: number): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    let bestA = Infinity;
    const r = Math.max(0, tol);
    for (let cj = cell(y - r); cj <= cell(y + r); cj++)
      for (let ci = cell(x - r); ci <= cell(x + r); ci++) {
        for (const i of this.cells.get(key(ci, cj)) ?? []) {
          const b = boxOf(this.layer, i);
          const d = distToBox(x, y, b);
          if (d > r) continue;
          const a = (b[2] - b[0]) * (b[3] - b[1]);
          if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && a < bestA)) {
            best = i;
            bestD = d;
            bestA = a;
          }
        }
      }
    return best;
  }

  /**
   * The caret position (0..n) for a selection end at (x, y): before or after the nearest
   * character, by which half of it the point is in along its line. Searches outwards until a
   * character turns up, up to `maxTol` points; null if none is that close.
   */
  caret(x: number, y: number, maxTol = 400): number | null {
    for (let tol = 2; tol <= maxTol; tol *= 2) {
      const i = this.nearest(x, y, tol);
      if (i !== null) return afterHalf(this.layer, i, x, y) ? i + 1 : i;
    }
    return null;
  }
}

const cell = (v: number) => Math.floor(v / CELL);
const key = (i: number, j: number) => i * 100003 + j;

export function distToBox(x: number, y: number, b: Box): number {
  const dx = Math.max(b[0] - x, 0, x - b[2]);
  const dy = Math.max(b[1] - y, 0, y - b[3]);
  return Math.hypot(dx, dy);
}

/**
 * Whether the point is past the middle of character i along its line. The line's direction
 * comes from the neighbouring characters (CAD drawings have vertical text).
 */
function afterHalf(l: TextLayer, i: number, x: number, y: number): boolean {
  const b = boxOf(l, i);
  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  const [dx, dy] = lineDirection(l, i);
  return (x - cx) * dx + (y - cy) * dy > 0;
}

/** Unit direction of reading at character i, from its neighbours on the same line. */
export function lineDirection(l: TextLayer, i: number): [number, number] {
  const b = boxOf(l, i);
  for (const j of [i + 1, i - 1]) {
    if (j < 0 || j >= l.n || !hasBox(l, j) || isGenerated(l, j)) continue;
    const c = boxOf(l, j);
    if (!sameLine(b, c)) continue;
    let dx = (c[0] + c[2]) / 2 - (b[0] + b[2]) / 2;
    let dy = (c[1] + c[3]) / 2 - (b[1] + b[3]) / 2;
    if (j < i) {
      dx = -dx;
      dy = -dy;
    }
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) return [dx / len, dy / len];
  }
  // A lone character: tall and narrow boxes on a vertical line are rare; assume left to right.
  return [1, 0];
}

/** Two character boxes sit on one line: they overlap across the line and are close along it. */
export function sameLine(a: Box, b: Box): boolean {
  const ha = a[3] - a[1], hb = b[3] - b[1];
  const wa = a[2] - a[0], wb = b[2] - b[0];
  const vOverlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const hOverlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const hGap = Math.max(a[0], b[0]) - Math.min(a[2], b[2]);
  const vGap = Math.max(a[1], b[1]) - Math.min(a[3], b[3]);
  const horizontal = vOverlap >= 0.5 * Math.min(ha, hb) && hGap <= 1.5 * Math.max(ha, hb);
  const vertical = hOverlap >= 0.5 * Math.min(wa, wb) && vGap <= 1.5 * Math.max(wa, wb) && ha > 0 && hb > 0 && Math.max(ha, hb) < 3 * Math.max(wa, wb);
  return horizontal || vertical;
}

/** The word around character i, as [start, end). A non-word character is a word of one. */
export function wordRange(l: TextLayer, i: number): [number, number] {
  if (i < 0 || i >= l.n) return [i, i];
  if (!isWordChar(charAt(l, i))) return [i, i + 1];
  let a = i;
  let b = i + 1;
  while (a > 0 && isWordChar(charAt(l, a - 1))) a--;
  while (b < l.n && isWordChar(charAt(l, b))) b++;
  return [a, b];
}

const isBreak = (l: TextLayer, i: number) => {
  const c = l.codes[i];
  return c === 10 || c === 13;
};

/** The line around character i (between the line breaks PDFium inferred), as [start, end). */
export function lineRange(l: TextLayer, i: number): [number, number] {
  if (i < 0 || i >= l.n) return [i, i];
  let a = i;
  let b = i;
  while (a > 0 && !isBreak(l, a - 1)) a--;
  while (b < l.n && !isBreak(l, b)) b++;
  return [a, b];
}

/**
 * Highlight rectangles for characters [a, b): consecutive boxes on one line merge into one
 * rectangle; generated characters (spaces and breaks PDFium inferred) and characters without a
 * box are skipped.
 */
export function rangeRects(l: TextLayer, a: number, b: number): Box[] {
  const out: Box[] = [];
  let cur: Box | null = null;
  let last: Box | null = null;
  for (let i = Math.max(0, a); i < Math.min(l.n, b); i++) {
    if (!hasBox(l, i)) continue;
    const bx = boxOf(l, i);
    if (cur && last && sameLine(last, bx)) {
      cur = [Math.min(cur[0], bx[0]), Math.min(cur[1], bx[1]), Math.max(cur[2], bx[2]), Math.max(cur[3], bx[3])];
    } else {
      if (cur) out.push(cur);
      cur = bx;
    }
    last = bx;
  }
  if (cur) out.push(cur);
  return out;
}
