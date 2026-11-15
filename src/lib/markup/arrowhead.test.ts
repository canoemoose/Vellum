// Stage 4 (docs/editing-tool-consistency-brief.md): a filled arrowhead meets its line, and a dot
// end its line, with no gap and nothing drawn twice, at every weight. The line stops with its
// round end where it always did; the solid end reaches back to it, less the bite that round end
// fills. Checked by area: the solid is exactly the head (or dot), plus the line's missing
// stretch, less the half disc the line's round end already covers.

import { describe, expect, it } from "vitest";
import { type LineEnd, type Markup, defaultStyle } from "./types";
import { type PathOp, type Seg, HEAD_ANGLE, arrowLength, dotRadius, opsFor } from "./ops";

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

const solidOf = (m: Markup, i: number) => (opsFor(m) as PathOp[]).filter((o) => o.fill && !o.stroke)[i];
const shaftEnd = (m: Markup) => {
  const segs = (opsFor(m)[0] as PathOp).segs;
  return [segs[0], segs[1]] as [["M", number, number], ["L", number, number]];
};

describe("a filled arrowhead", () => {
  for (const w of [0.5, 1, 2, 4, 8]) {
    it(`meets its line flat on its base, with nothing drawn twice, at weight ${w}`, () => {
      const m = arrow(["none", "filled"], w);
      const len = arrowLength(w);
      const base = 200 - len * Math.cos(HEAD_ANGLE);
      // The line still stops half a weight short of the base (its round end reaches the base).
      expect(shaftEnd(m)[1][1]).toBeCloseTo(base - w / 2, 6);
      // Head + the line's stretch to the base - the round end's half disc.
      const half = len * Math.sin(HEAD_ANGLE);
      const tri = len * Math.cos(HEAD_ANGLE) * half;
      const want = tri + w * (w / 2) - (Math.PI * (w / 2) ** 2) / 2;
      expect(area(solidOf(m, 0).segs)).toBeCloseTo(want, 2);
      // The neck is the line's width where it meets the base.
      const ys = polygons(solidOf(m, 0).segs)[0].filter((p) => Math.abs(p[0] - base) < 1e-6).map((p) => p[1]);
      expect(ys).toEqual(expect.arrayContaining([expect.closeTo(100 - w / 2, 6), expect.closeTo(100 + w / 2, 6)]));
    });
  }

  it("works at the tail too", () => {
    const m = arrow(["filled", "none"], 3);
    expect(shaftEnd(m)[0][1]).toBeCloseTo(arrowLength(3) * Math.cos(HEAD_ANGLE) + 1.5, 6);
    const tri = arrowLength(3) * Math.cos(HEAD_ANGLE) * arrowLength(3) * Math.sin(HEAD_ANGLE);
    expect(area(solidOf(m, 0).segs)).toBeCloseTo(tri + 3 * 1.5 - (Math.PI * 1.5 ** 2) / 2, 2);
  });
});

describe("a dot end", () => {
  for (const w of [0.5, 2, 6]) {
    it(`leaves out the bite its line's round end fills, at weight ${w}`, () => {
      const m = arrow(["none", "dot"], w);
      const r = dotRadius(w);
      const want = Math.PI * r * r - (Math.PI * (w / 2) ** 2) / 2;
      // Within what drawing a circle as four Bezier curves allows (about 0.03%).
      expect(Math.abs(area(solidOf(m, 0).segs) - want) / want).toBeLessThan(0.001);
      // The bite winds the other way from the circle, so it's a hole under either fill rule.
      const [ring, hole] = polygons(solidOf(m, 0).segs);
      expect(Math.sign(signed(ring))).toBe(-Math.sign(signed(hole)));
    });
  }
});
