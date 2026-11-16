// Revision cloud: click the corners and double-click (or Enter) to finish, or drag a box.
// Saved as a Polygon annotation with a cloudy border (/BE) and intent PolygonCloud.

import { type MarkupBase, type Pt, type Style, LINE_STYLE } from "../base";
import { type Op, type Seg, add, arc, filled, len, mul, signedArea, sub, unit } from "../draw";
import { distToPolyline, insidePolygon, isBoxGrip, movePt, pointsBounds, turnPointsBy, turnTowards, turnedPointGrips, turnedPointsGrip, dragTurnedPointGrip } from "../shape";
import { userPoints } from "../annotation";
import { defineKind } from "./kind";

export interface CloudMarkup extends MarkupBase {
  kind: "cloud";
  vertices: Pt[];
  /** Scallop size, 1 normal. */
  intensity: number;
  /** Degrees it has been turned clockwise (by its rotate grip, or [ and ]): its own frame. */
  angle?: number;
}

declare module "../base" {
  interface MarkupKinds {
    cloud: CloudMarkup;
  }
}

export const cloud = defineKind<CloudMarkup>({
  kind: "cloud",
  label: "Revision cloud",
  defaultStyle: () => ({ ...LINE_STYLE }),
  controls: { fill: true, ends: false, text: false },
  draw: { gesture: "points", make: (vertices) => ({ vertices, intensity: 1 }), closed: true, min: 3, drag: "box" },
  ops: (m) => cloudOps(m.vertices, m.intensity, m.style),
  spec(m, f, spec) {
    spec.subtype = "Polygon";
    spec.vertices = userPoints(f, m.vertices);
    spec.cloud = m.intensity;
    spec.intent = "PolygonCloud";
  },
  bounds: (m) => pointsBounds(m.vertices),
  hits(m, p, t) {
    if (m.style.fill && insidePolygon(p, m.vertices)) return true;
    // The scallops stand out from the edges by up to half a chord.
    return distToPolyline(p, m.vertices, true) <= t + cloudChord(m.intensity, m.style.width) / 2;
  },
  handles: (m, ptPerPx = 1) => [...turnedPointGrips(m), turnedPointsGrip(m, ptPerPx)],
  // Its box grips' cursors follow its turn.
  turn: (m) => m.angle ?? 0,
  // A corner moves freely (no Shift snap, as before); the box scales it, Shift keeping proportions.
  dragHandle: (m, h, p, constrain, minSize) =>
    // Turned by its rotate grip, about the middle of its box (Shift: 15 degree steps).
    h === "rotate" ? turnCloud(m, turnTowards(m, p, constrain)) : dragTurnedPointGrip(m, h, p, constrain && isBoxGrip(h), minSize, true),
  turnBy: (m, deg) => turnCloud(m, deg),
  moveBy: (m, dx, dy) => ({ ...m, vertices: m.vertices.map((v) => movePt(v, dx, dy)) }),
});

/** Turned by `deg` clockwise about the middle of its own box. */
const turnCloud = (m: CloudMarkup, deg: number): CloudMarkup => turnPointsBy(m, deg).next;

/**
 * Scallop chord for a cloud of the given intensity and line weight: 14 pt at the default 1.5 pt,
 * growing with the weight so heavy lines don't swamp their bumps.
 */
export function cloudChord(intensity: number, width = 1.5): number {
  return Math.max(0.5, intensity) * (10 + (8 / 3) * Math.max(0, width));
}

interface Scallop {
  /** Centre, radius, direction along the edge, outward normal. */
  c: Pt;
  r: number;
  u: Pt;
  out: Pt;
}

/** A revision cloud's scallops: each edge divided into equal chords, each a half circle bulging outwards. */
function scallops(v: Pt[], intensity: number, width: number): Scallop[] {
  const pos = signedArea(v) > 0;
  const target = cloudChord(intensity, width);
  const out: Scallop[] = [];
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    const e = len(sub(b, a));
    if (e < 1e-6) continue;
    const count = Math.max(1, Math.round(e / target));
    const d = mul(sub(b, a), 1 / count);
    const u = unit(d);
    // Outward normal: one side of travel or the other, by the winding.
    const n: Pt = pos ? [u[1], -u[0]] : [-u[1], u[0]];
    for (let j = 0; j < count; j++) out.push({ c: add(a, mul(d, j + 0.5)), r: len(d) / 2, u, out: n });
  }
  return out;
}

/** The cloud's outline: the scallops end to end. */
function cloudOutline(sc: Scallop[]): Seg[] {
  const segs: Seg[] = [];
  for (const q of sc) {
    const p0 = sub(q.c, mul(q.u, q.r));
    if (!segs.length) segs.push(["M", p0[0], p0[1]]);
    segs.push(...arc(q.c, q.r, mul(q.u, -1), q.u, q.out));
  }
  segs.push(["Z"]);
  return segs;
}

/**
 * The cloud's outline inset by d: each scallop shrunk about its centre, and between scallops a
 * small inward arc round the point where they meet (the line's round join there).
 */
function cloudInner(sc: Scallop[], d: number): Seg[] {
  const segs: Seg[] = [];
  sc.forEach((q, i) => {
    const r = Math.max(0, q.r - d);
    const p0 = sub(q.c, mul(q.u, r));
    segs.push([segs.length ? "L" : "M", p0[0], p0[1]]);
    if (r > 0) segs.push(...arc(q.c, r, mul(q.u, -1), q.u, q.out));
    // Round the meeting point, from this scallop's end to the next one's start.
    const nx = sc[(i + 1) % sc.length];
    const meet = add(q.c, mul(q.u, q.r));
    if (q.r > d && nx.r > d) {
      const inward: Pt = mul(add(q.out, nx.out), -1);
      segs.push(...arc(meet, d, mul(q.u, -1), nx.u, len(inward) > 1e-6 ? inward : mul(q.out, -1)));
    }
  });
  segs.push(["Z"]);
  return segs;
}

/** Revision cloud: half-circle scallops along each edge, bulging outwards. */
function cloudOps(v: Pt[], intensity: number, s: Style): Op[] {
  if (v.length < 2) return [];
  const sc = scallops(v, intensity, s.width);
  if (!sc.length) return [];
  return filled(cloudOutline(sc), () => cloudInner(sc, s.width / 2), s);
}
