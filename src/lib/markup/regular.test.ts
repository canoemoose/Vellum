// Stage 6 [D11]: regular polygon maths, and the box resize every shape of points shares [A11].

import { describe, expect, it } from "vitest";
import type { Pt, Rect } from "./base";
import { DEFAULT_SIDES, MAX_SIDES, MIN_SIDES, clampSides, flatAngle, matchesRegular, readRegular, regularFromDrag, regularVertices, scaleRegular, withSides } from "./regular";
import { dragPointGrip, pointGrips, pointsBounds, resizeBox } from "./shape";
import { barFor, subjectOfTool } from "./bar";
import { TOOLS } from "./tools";
import { defaultPrefs, sanitisePrefs, sidesFor } from "./prefs";

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("regular polygons", () => {
  it("puts every corner on the circle, equal sides apart, the first at the angle", () => {
    for (let n = MIN_SIDES; n <= MAX_SIDES; n++) {
      const r = { centre: [50, 80] as Pt, radius: 30, angle: 0.3, sides: n };
      const v = regularVertices(r);
      expect(v.length).toBe(n);
      for (const p of v) expect(dist(p, r.centre)).toBeCloseTo(30, 9);
      const side = dist(v[0], v[1]);
      for (let i = 0; i < n; i++) expect(dist(v[i], v[(i + 1) % n])).toBeCloseTo(side, 9);
      expect(Math.atan2(v[0][1] - 80, v[0][0] - 50)).toBeCloseTo(0.3, 9);
    }
  });

  it("drags from the centre out with a corner on the pointer", () => {
    const r = regularFromDrag([100, 100], [130, 140], 5, null);
    expect(r.centre).toEqual([100, 100]);
    expect(r.radius).toBeCloseTo(50);
    expect(r.sides).toBe(5);
    const v = regularVertices(r);
    expect(v[0][0]).toBeCloseTo(130);
    expect(v[0][1]).toBeCloseTo(140);
  });

  // The page direction that is down on screen under each quarter turn of the view: the view
  // turned clockwise by q quarters shows the page's left edge (q = 1) at the bottom, and so on.
  const downs: Pt[] = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  it("with Shift, sets a flat side at the bottom as viewed, under every quarter turn, for every count of sides", () => {
    for (const down of downs) {
      for (let n = MIN_SIDES; n <= MAX_SIDES; n++) {
        const r = regularFromDrag([0, 0], [17, 4], n, down);
        expect(r.radius).toBeCloseTo(Math.hypot(17, 4)); // the pointer still sets its size
        const v = regularVertices(r);
        // The lowest as viewed (furthest along `down`): two corners level, a flat side.
        const along = v.map((p) => p[0] * down[0] + p[1] * down[1]);
        const most = Math.max(...along);
        expect(along.filter((a) => Math.abs(a - most) < 1e-9).length, `${n} sides, down ${down}`).toBe(2);
      }
    }
  });

  it("flatAngle puts the middle of a side straight down", () => {
    const n = 6;
    const a = flatAngle(n, [0, 1]) + Math.PI / n;
    expect(Math.cos(a)).toBeCloseTo(0);
    expect(Math.sin(a)).toBeCloseTo(1);
  });

  it("holds sides to 3 to 12, whole, defaulting to 6", () => {
    expect(DEFAULT_SIDES).toBe(6);
    expect(clampSides(2)).toBe(3);
    expect(clampSides(13)).toBe(12);
    expect(clampSides(7.4)).toBe(7);
    expect(clampSides(NaN)).toBe(6);
    expect(clampSides("8")).toBe(6);
  });

  it("changing the sides keeps the centre, size and turn", () => {
    const r = { centre: [10, 20] as Pt, radius: 15, angle: 1.1, sides: 6 };
    const s = withSides(r, 4);
    expect(s).toEqual({ centre: [10, 20], radius: 15, angle: 1.1, sides: 4 });
    expect(withSides(r, 40).sides).toBe(12);
  });

  it("stays regular when scaled alike both ways, and not otherwise", () => {
    const r = { centre: [50, 50] as Pt, radius: 20, angle: 0, sides: 5 };
    const b = pointsBounds(regularVertices(r));
    const twice: Rect = [b[0], b[1], b[0] + 2 * (b[2] - b[0]), b[1] + 2 * (b[3] - b[1])];
    const s = scaleRegular(r, b, twice)!;
    expect(s.radius).toBeCloseTo(40);
    expect(matchesRegular(s, regularVertices(r).map((p) => [b[0] + (p[0] - b[0]) * 2, b[1] + (p[1] - b[1]) * 2]))).toBe(true);
    expect(scaleRegular(r, b, [b[0], b[1], b[2] + 10, b[3]])).toBeNull();
  });

  it("reads back only sound parameters", () => {
    expect(readRegular({ centre: [1, 2], radius: 3, angle: 0, sides: 6 })).toEqual({ centre: [1, 2], radius: 3, angle: 0, sides: 6 });
    expect(readRegular({ centre: [1, 2], radius: 3, angle: 0, sides: 13 })).toBeNull();
    expect(readRegular({ centre: [1], radius: 3, angle: 0, sides: 6 })).toBeNull();
    expect(readRegular({ centre: [1, 2], radius: -1, angle: 0, sides: 6 })).toBeNull();
    expect(readRegular(null)).toBeNull();
  });
});

describe("Sides in the context bar, remembered per tool (rules 6 and 7)", () => {
  it("shows for a tool that drags a regular polygon and for a regular polygon only", () => {
    const polygonTool = TOOLS.find((t) => t.id === "polygon")!;
    expect(barFor([subjectOfTool(polygonTool)])!.sides).toBe(true);
    for (const t of TOOLS) if (t.kind && t.id !== "polygon" && barFor([subjectOfTool(t)])) expect(barFor([subjectOfTool(t)])!.sides, t.id).toBe(false);
    // With a polygon and a rectangle selected, only what both have.
    expect(barFor([{ kind: "polygon", sides: true }, { kind: "rect" }])!.sides).toBe(false);
  });

  it("is remembered by tool, held to 3 to 12, default 6", () => {
    expect(sidesFor(defaultPrefs(), "polygon")).toBe(6);
    const p = sanitisePrefs({ sides: { polygon: 9, rect: 5 } });
    expect(sidesFor(p, "polygon")).toBe(9);
    expect(p.sides.rect).toBeUndefined();
    expect(sanitisePrefs({ sides: { polygon: 40 } }).sides.polygon).toBe(12);
    expect(sanitisePrefs({}).sides).toEqual({});
  });
});

describe("shapes of points: corner grips and a box to resize by", () => {
  const tri: Pt[] = [[100, 100], [200, 100], [150, 200]];

  it("are round corners on the shape and eight square grips on its box", () => {
    const g = pointGrips(tri);
    expect(g.filter((h) => h.round).map((h) => h.at)).toEqual(tri);
    const box = g.filter((h) => !h.round);
    expect(box.map((h) => h.id)).toEqual(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
    expect(box.find((h) => h.id === "se")!.at).toEqual([200, 200]);
  });

  it("scale every corner with the box", () => {
    const m = dragPointGrip({ vertices: tri }, "se", [300, 300], false, 2, true);
    expect(m.vertices).toEqual([[100, 100], [300, 100], [200, 300]]);
  });

  it("keep proportions with Shift, from a corner grip and from a side grip", () => {
    const b: Rect = [0, 0, 100, 50];
    const c = resizeBox(b, "se", [300, 60], true, 2);
    expect((c[2] - c[0]) / (c[3] - c[1])).toBeCloseTo(2);
    const e = resizeBox(b, "e", [200, 10], true, 2);
    expect(e).toEqual([0, -25, 200, 75]); // twice as wide, so twice as tall, about the middle
    const s = resizeBox(b, "s", [10, 100], true, 2);
    expect(s).toEqual([-50, 0, 150, 100]);
    // Without Shift a side grip moves its side alone.
    expect(resizeBox(b, "e", [200, 10], false, 2)).toEqual([0, 0, 200, 50]);
  });

  it("leave a straight shape straight", () => {
    const flat = resizeBox([0, 10, 100, 10], "se", [200, 50], true, 2);
    expect(flat).toEqual([0, 10, 200, 10]);
  });

  it("move a corner alone from its own grip", () => {
    const m = dragPointGrip({ vertices: tri }, "v2", [160, 220], false, 2, true);
    expect(m.vertices).toEqual([[100, 100], [200, 100], [160, 220]]);
  });
});
