// Quadrilaterals for text markups (highlight, underline, strike through): one per line of
// selected text, following the text's own direction, from its characters' boxes. A quad's
// corners are in the order PDF readers expect for /QuadPoints: the line's top left, top right,
// bottom left, bottom right, "top" being the side the glyphs stand up towards. Page points,
// y down. Pure, over a TextLayer.

import { type TextLayer, boxOf, hasBox } from "./layer";
import { lineDirection, sameLine } from "./hit";

type Pt = [number, number];
/** [top left, top right, bottom left, bottom right], along the text. */
export type Quad = [Pt, Pt, Pt, Pt];

/** Within this many radians of an axis, a line counts as square to the page (no skewed quads from rounding). */
const SNAP = (3 * Math.PI) / 180;

const isBreak = (c: number) => c === 10 || c === 13;

/** Unit reading direction of a run of boxes, snapped to the page's axes when nearly square. */
function runDirection(l: TextLayer, first: number, boxes: number[][]): Pt {
  let d: Pt;
  if (boxes.length >= 2) {
    const a = boxes[0], b = boxes[boxes.length - 1];
    const dx = (b[0] + b[2]) / 2 - (a[0] + a[2]) / 2;
    const dy = (b[1] + b[3]) / 2 - (a[1] + a[3]) / 2;
    const n = Math.hypot(dx, dy);
    d = n > 1e-6 ? [dx / n, dy / n] : lineDirection(l, first);
  } else d = lineDirection(l, first);
  const ang = Math.atan2(d[1], d[0]);
  const axis = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(ang - axis) < SNAP) d = [Math.round(Math.cos(axis)), Math.round(Math.sin(axis))];
  return d;
}

/** The quad around boxes read in direction d: their extent along d and across it. */
export function quadAround(boxes: number[][], d: Pt): Quad {
  // "Down" across the line: the reading direction turned a quarter clockwise on a y-down page.
  const n: Pt = [-d[1], d[0]];
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const b of boxes)
    for (const [x, y] of [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]) {
      const s = x * d[0] + y * d[1], t = x * n[0] + y * n[1];
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
  const at = (s: number, t: number): Pt => [s * d[0] + t * n[0], s * d[1] + t * n[1]];
  return [at(s0, t0), at(s1, t0), at(s0, t1), at(s1, t1)];
}

/**
 * One quad per line of characters [a, b): consecutive boxes on one line join (as selection
 * bands do), a line break starts a new one, and characters without a box are skipped.
 */
export function lineQuads(l: TextLayer, a: number, b: number): Quad[] {
  const out: Quad[] = [];
  let run: number[][] = [];
  let first = -1;
  const flush = () => {
    if (run.length) out.push(quadAround(run, runDirection(l, first, run)));
    run = [];
  };
  for (let i = Math.max(0, a); i < Math.min(l.n, b); i++) {
    if (isBreak(l.codes[i])) {
      flush();
      continue;
    }
    if (!hasBox(l, i)) continue;
    const bx = boxOf(l, i);
    const last = run[run.length - 1];
    if (last && !sameLine(last as [number, number, number, number], bx)) flush();
    if (!run.length) first = i;
    run.push(bx);
  }
  flush();
  return out;
}

/** A quad's height across its line. */
export const quadHeight = (q: Quad): number => Math.hypot(q[2][0] - q[0][0], q[2][1] - q[0][1]);
