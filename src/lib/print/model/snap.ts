// Snapping for the manual layout editor: to the margins, to other items, to a 5 mm grid.
// Pure. Distances are in sheet points; the caller converts its pixel threshold by zoom.

import { type Box, centreX, centreY, mmToPt } from "./geom";

export interface SnapOptions {
  margins: boolean;
  pages: boolean;
  grid: boolean;
}

export const GRID = mmToPt(5);

/** A guide line to draw while snapped: vertical at x, or horizontal at y. */
export type Guide = { axis: "x"; at: number } | { axis: "y"; at: number };

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

interface Candidates {
  xs: number[];
  ys: number[];
}

function candidates(area: Box, others: Box[], o: SnapOptions): Candidates {
  const xs: number[] = [];
  const ys: number[] = [];
  if (o.margins) {
    xs.push(area.x0, area.x1, centreX(area));
    ys.push(area.y0, area.y1, centreY(area));
  }
  if (o.pages) {
    for (const b of others) {
      xs.push(b.x0, b.x1, centreX(b));
      ys.push(b.y0, b.y1, centreY(b));
    }
  }
  return { xs, ys };
}

/** Nearest grid line to v. */
const gridLine = (v: number): number => Math.round(v / GRID) * GRID;

/**
 * Best correction along one axis: move `anchors` (edges and centre of the moving box) onto
 * the nearest candidate within `threshold`. Returns [delta, guide position] or null.
 */
function bestAxis(anchors: number[], cands: number[], grid: boolean, threshold: number): [number, number, boolean] | null {
  let best: [number, number, boolean] | null = null;
  for (const a of anchors) {
    for (const c of cands) {
      const d = c - a;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best[0]) - 1e-9)) best = [d, c, true];
    }
  }
  // The grid only catches the box's leading edge, and only when nothing else is closer.
  if (grid) {
    const g = gridLine(anchors[0]) - anchors[0];
    if (Math.abs(g) <= threshold && (!best || Math.abs(g) < Math.abs(best[0]) - 1e-9)) best = [g, anchors[0] + g, false];
  }
  return best;
}

/** Snap a box being moved. `box` is where the drag would put it unsnapped. */
export function snapMove(box: Box, others: Box[], area: Box, o: SnapOptions, threshold: number): SnapResult {
  const c = candidates(area, others, o);
  const bx = bestAxis([box.x0, box.x1, centreX(box)], c.xs, o.grid, threshold);
  const by = bestAxis([box.y0, box.y1, centreY(box)], c.ys, o.grid, threshold);
  const guides: Guide[] = [];
  if (bx && bx[2]) guides.push({ axis: "x", at: bx[1] });
  if (by && by[2]) guides.push({ axis: "y", at: by[1] });
  return { dx: bx ? bx[0] : 0, dy: by ? by[0] : 0, guides };
}

/** Snap a single point (a corner or edge being dragged). */
export function snapPoint(x: number, y: number, others: Box[], area: Box, o: SnapOptions, threshold: number): { x: number; y: number; guides: Guide[] } {
  const c = candidates(area, others, o);
  const bx = bestAxis([x], c.xs, o.grid, threshold);
  const by = bestAxis([y], c.ys, o.grid, threshold);
  const guides: Guide[] = [];
  if (bx && bx[2]) guides.push({ axis: "x", at: bx[1] });
  if (by && by[2]) guides.push({ axis: "y", at: by[1] });
  return { x: x + (bx ? bx[0] : 0), y: y + (by ? by[0] : 0), guides };
}
