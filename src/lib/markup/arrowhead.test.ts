// Stage 4 (docs/editing-tool-consistency-brief.md): a filled arrowhead meets its line, and a dot
// end its line, with no gap and nothing drawn twice, at every weight.
//
// A solid straight line (Matt's review: the two shapes showed a faint seam) is drawn as one
// filled outline, line and ends together, every part wound alike so they fill as one: there's no
// edge between them to show. A dashed line, or one through more points, still draws its line and
// its solid ends apart, the line stopping with its round end where it always did and the solid
// end reaching back to it, less the bite that round end fills. Checked by area: that solid is
// exactly the head (or dot), plus the line's missing stretch, less the half disc the line's round
// end already covers.

import { describe, expect, it } from "vitest";
import { type LineEnd, type Markup, defaultStyle } from "./types";
import { type PathOp, type Seg, HEAD_ANGLE, arrowLength, dotRadius, opsFor } from "./ops";
import { lineEnd } from "./draw";

const meta = { author: "", created: "2026-11-15T12:00:00.000Z", modified: "2026-11-15T12:00:00.000Z" };
const arrow = (ends: [LineEnd, LineEnd], width: number): Markup =>
  ({ id: "a", page: 0, kind: "arrow", from: [0, 100], to: [200, 100], style: { ...defaultStyle("arrow"), width, ends }, meta }) as Markup;

/** Sub-paths of segments as polygons, curves sampled finely. */
function polygons(segs: Seg[]): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (const s of segs) {
    if (s[0] === "M") {
      if (cur.length) out.push(cur);
      cur = [[s[1], s[2]]];
    } else if (s[0] === "L") cur.push([s[1], s[2]]);
    else if (s[0] === "C") {
      const [x0, y0] = cur[cur.length - 1];
      for (let i = 1; i <= 64; i++) {
        const t = i / 64, u = 1 - t;
        cur.push([
          u * u * u * x0 + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5],
          u * u * u * y0 + 3 * u * u * t * s[2] + 3 * u * t * t * s[4] + t * t * t * s[6],
        ]);
      }
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

const signed = (v: [number, number][]) => v.reduce((a, p, i) => a + p[0] * v[(i + 1) % v.length][1] - v[(i + 1) % v.length][0] * p[1], 0) / 2;
/** The filled area under the nonzero rule, for sub-paths that nest (a ring with a hole). */
const area = (segs: Seg[]) => Math.abs(polygons(segs).reduce((a, v) => a + signed(v), 0));

/** Whether p is inside polygon v (even-odd, which for one convex shape is just inside). */
const inside = (p: [number, number], v: [number, number][]) => {
  let c = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    if (v[i][1] > p[1] !== v[j][1] > p[1] && p[0] < ((v[j][0] - v[i][0]) * (p[1] - v[i][1])) / (v[j][1] - v[i][1]) + v[i][0]) c = !c;
  }
  return c;
};

describe("a solid line with filled ends: one outline (Matt's review)", () => {
  const cases: [LineEnd, LineEnd][] = [["none", "filled"], ["filled", "none"], ["filled", "filled"], ["none", "dot"], ["dot", "filled"]];
  for (const ends of cases) {
    for (const w of [0.5, 2, 6]) {
      it(`${ends.join(" and ")} at weight ${w}: one fill, every part wound alike, the line's sides inside each end`, () => {
        const ops = opsFor(arrow(ends, w)) as PathOp[];
        // One filled path in the line's colour and opacity: nothing stroked, nothing drawn twice.
        expect(ops.length).toBe(1);
        expect(ops[0].stroke).toBeNull();
        expect(ops[0].fill).toEqual(defaultStyle("arrow").stroke);
        const [shaft, ...solids] = polygons(ops[0].segs);
        expect(solids.length).toBe(ends.filter((e) => e !== "none").length);
        for (const s of solids) expect(Math.sign(signed(s))).toBe(Math.sign(signed(shaft)));
        // Where the line's outline meets a filled end, its corners are within that end (so
        // there's no notch), a hair in from its edge.
        for (const [k, x] of [[0, 0], [1, 200]] as const) {
          if (ends[k] === "none") continue;
          const near = shaft.filter((p) => Math.abs(p[0] - x) === Math.min(...shaft.map((q) => Math.abs(q[0] - x))));
          const end = solids[ends[0] === "none" || k === 0 ? 0 : 1];
          for (const p of near) expect(inside([p[0] + (k ? -1e-6 : 1e-6), p[1]], end)).toBe(true);
        }
      });
    }
  }

  it("has a round end where nothing is drawn on it", () => {
    const [shaft] = polygons((opsFor(arrow(["none", "filled"], 4)) as PathOp[])[0].segs);
    expect(Math.min(...shaft.map((p) => p[0]))).toBeCloseTo(-2, 3);
  });

  it("draws a dashed line and its ends apart, as before", () => {
    const m = { ...arrow(["none", "filled"], 2), style: { ...defaultStyle("arrow"), width: 2, ends: ["none", "filled"], dash: [4, 2] } } as Markup;
    expect((opsFor(m) as PathOp[]).length).toBe(2);
  });
});

describe("a filled arrowhead drawn apart from its line (dashed, or through more points)", () => {
  for (const w of [0.5, 1, 2, 4, 8]) {
    it(`meets its line flat on its base, with nothing drawn twice, at weight ${w}`, () => {
      const e = lineEnd("filled", [200, 100], [1, 0], w);
      const len = arrowLength(w);
      const base = 200 - len * Math.cos(HEAD_ANGLE);
      // The line still stops half a weight short of the base (its round end reaches the base).
      expect(200 - e.back).toBeCloseTo(base - w / 2, 6);
      // Head + the line's stretch to the base - the round end's half disc.
      const half = len * Math.sin(HEAD_ANGLE);
      const tri = len * Math.cos(HEAD_ANGLE) * half;
      const want = tri + w * (w / 2) - (Math.PI * (w / 2) ** 2) / 2;
      expect(area(e.solid!)).toBeCloseTo(want, 2);
      // The neck is the line's width where it meets the base.
      const ys = polygons(e.solid!)[0].filter((p) => Math.abs(p[0] - base) < 1e-6).map((p) => p[1]);
      expect(ys).toEqual(expect.arrayContaining([expect.closeTo(100 - w / 2, 6), expect.closeTo(100 + w / 2, 6)]));
    });
  }
});

describe("a dot end drawn apart from its line", () => {
  for (const w of [0.5, 2, 6]) {
    it(`leaves out the bite its line's round end fills, at weight ${w}`, () => {
      const e = lineEnd("dot", [200, 100], [1, 0], w);
      const r = dotRadius(w);
      const want = Math.PI * r * r - (Math.PI * (w / 2) ** 2) / 2;
      // Within what drawing a circle as four Bezier curves allows (about 0.03%).
      expect(Math.abs(area(e.solid!) - want) / want).toBeLessThan(0.001);
      // The bite winds the other way from the circle, so it's a hole under either fill rule.
      const [ring, hole] = polygons(e.solid!);
      expect(Math.sign(signed(ring))).toBe(-Math.sign(signed(hole)));
    });
  }
});
