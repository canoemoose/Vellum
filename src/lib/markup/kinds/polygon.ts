// Polygon: click the corners, double-click, Enter or a click on the first corner to finish; or
// drag a regular one from the centre out, with Sides from the context bar (stage 6). Saved as a
// Polygon annotation; a regular one's centre, size, turn and sides go only in Vellum's own
// saved copy (../reedit.ts), so Sides still works on it after a save and reopen.

import { type MarkupBase, type Pt, LINE_STYLE } from "../base";
import { type Seg, add, filled, len, mul, signedArea, sub, unit } from "../draw";
import { distToPolyline, insidePolygon, isBoxGrip, movePt, pointsBounds, turnPointsBy, turnTowards, turnedPointGrips, turnedPointsGrip, dragTurnedPointGrip } from "../shape";
import { type Regular, matchesRegular, moveRegular, readRegular, regularVertices, scaleRegular, withSides } from "../regular";
import { userPoints } from "../annotation";
import { defineKind } from "./kind";
import { turnPt } from "../turn";

export interface PolygonMarkup extends MarkupBase {
  kind: "polygon";
  vertices: Pt[];
  /** Stage 6: dragged out regular, and no corner changed by hand since. Absent: freeform. */
  regular?: Regular;
  /** Degrees it has been turned clockwise (by its rotate grip, or [ and ]): its own frame. */
  angle?: number;
}

/** Its regular parameters, if it is still that polygon (sound, and matching its corners). */
function regularOf(m: PolygonMarkup): Regular | null {
  const r = readRegular(m.regular);
  return r && matchesRegular(r, m.vertices) ? r : null;
}

/** Freeform: the same corners, no longer regular. */
function freeform(m: PolygonMarkup): PolygonMarkup {
  if (!("regular" in m)) return m;
  const { regular: _, ...rest } = m;
  return rest;
}

const asRegular = (m: PolygonMarkup, r: Regular): PolygonMarkup => ({ ...m, regular: r, vertices: regularVertices(r) });

declare module "../base" {
  interface MarkupKinds {
    polygon: PolygonMarkup;
  }
}

export const polygon = defineKind<PolygonMarkup>({
  kind: "polygon",
  label: "Polygon",
  defaultStyle: () => ({ ...LINE_STYLE }),
  controls: { fill: true, ends: false, text: false },
  draw: { gesture: "points", make: (vertices, ctx) => (ctx.regular ? { vertices, regular: ctx.regular } : { vertices }), closed: true, min: 3, drag: "regular" },
  ops: (m) => (m.vertices.length < 2 ? [] : filled(closedPath(m.vertices), () => closedPath(insetPolygon(m.vertices, m.style.width / 2)), m.style)),
  spec(m, f, spec) {
    spec.subtype = "Polygon";
    spec.vertices = userPoints(f, m.vertices);
  },
  bounds: (m) => pointsBounds(m.vertices),
  hits(m, p, t) {
    if (m.style.fill && insidePolygon(p, m.vertices)) return true;
    return distToPolyline(p, m.vertices, true) <= t;
  },
  handles: (m, ptPerPx = 1) => [...turnedPointGrips(m), turnedPointsGrip(m, ptPerPx)],
  // Its box grips' cursors follow its turn.
  turn: (m) => m.angle ?? 0,
  dragHandle(m, h, p, constrain, minSize) {
    // Turned by its rotate grip, about the middle of its box (Shift: 15 degree steps).
    if (h === "rotate") return turnPolygon(m, turnTowards(m, p, constrain));
    const next = dragTurnedPointGrip(m, h, p, constrain, minSize, true);
    const r = regularOf(m);
    if (!r || next === m) return next;
    // Resized by its box keeping proportions: still regular. A corner dragged, or the box
    // stretched: freeform.
    const s = isBoxGrip(h) ? scaleRegular(r, pointsBounds(m.vertices), pointsBounds(next.vertices)) : null;
    return s ? asRegular(next, s) : freeform(next);
  },
  moveBy(m, dx, dy) {
    const moved = { ...m, vertices: m.vertices.map((v) => movePt(v, dx, dy)) };
    const r = regularOf(m);
    return r ? asRegular(moved, moveRegular(r, dx, dy)) : moved;
  },
  sides: (m) => regularOf(m)?.sides ?? null,
  withSides(m, sides) {
    const r = regularOf(m);
    return r ? asRegular(m, withSides(r, sides)) : m;
  },
  freeform,
  turnBy: (m, deg) => turnPolygon(m, deg),
});

/** Turned by `deg` clockwise about the middle of its own box; a regular one stays regular. */
function turnPolygon(m: PolygonMarkup, deg: number): PolygonMarkup {
  if (!deg) return m;
  const { next, centre } = turnPointsBy(m, deg);
  const r = regularOf(m);
  return r ? asRegular(next, { ...r, centre: turnPt(r.centre, centre, deg), angle: r.angle + (deg * Math.PI) / 180 }) : next;
}

const closedPath = (v: Pt[]): Seg[] => [["M", v[0][0], v[0][1]], ...v.slice(1).map((p) => ["L", p[0], p[1]] as Seg), ["Z"]];

/**
 * The outline moved inwards by d (the line's inner edge, where the fill stops): each corner
 * moved along its bisector so both edges move d. Very sharp corners are held to 4 d, as a line
 * join would be, so they can't shoot across the shape.
 */
export function insetPolygon(v: Pt[], d: number): Pt[] {
  if (d <= 0 || v.length < 3) return v.slice();
  // Inwards is to the right of travel for one winding, the left for the other.
  const s = signedArea(v) > 0 ? 1 : -1;
  const n = v.length;
  return v.map((p, i) => {
    const a = unit(sub(p, v[(i - 1 + n) % n]));
    const b = unit(sub(v[(i + 1) % n], p));
    const na: Pt = [-a[1] * s, a[0] * s];
    const nb: Pt = [-b[1] * s, b[0] * s];
    const bis = add(na, nb);
    const bl = len(bis);
    if (bl < 1e-9) return add(p, mul(na, d));
    const cos = bl / 2; // the bisector against either edge's normal
    return add(p, mul(bis, Math.min(d / cos, 4 * d) / bl));
  });
}
