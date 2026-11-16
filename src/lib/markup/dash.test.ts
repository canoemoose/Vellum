import { describe, expect, it } from "vitest";
import { DASHES, dashOption, drawnDash, sameDash } from "./dash";
import { defaultStyle } from "./types";
import { opsFor, type PathOp } from "./ops";
import { sanitisePrefs } from "./prefs";

describe("line patterns", () => {
  it("matches a style's dash to its pattern", () => {
    expect(dashOption(null)?.name).toBe("Solid");
    expect(dashOption([]))?.toEqual(DASHES[0]);
    expect(dashOption([4, 3])?.name).toBe("Dashed");
    expect(dashOption([5, 5])).toBeNull();
    expect(sameDash([1, 2], [1, 2, 3])).toBe(false);
  });

  it("spaces a pattern out with the line's weight, never closer than at 1 pt", () => {
    expect(drawnDash([4, 3], 1)).toEqual([4, 3]);
    expect(drawnDash([4, 3], 0.5)).toEqual([4, 3]);
    expect(drawnDash([0, 3], 4)).toEqual([0, 12]);
    expect(drawnDash(null, 4)).toBeNull();
    const arrow = { id: "a", page: 0, kind: "arrow" as const, from: [0, 0] as [number, number], to: [100, 0] as [number, number], style: { ...defaultStyle("arrow"), width: 3, dash: [4, 3] }, meta: { author: "", created: "", modified: "" } };
    // Drawn out along the shaft: 100 / 21 rounds to 5 repeats, so k = 100 / 105; the tail
    // carries half a 12 pt dash.
    const shaft = (opsFor(arrow)[0] as PathOp).segs;
    expect(shaft[0]).toEqual(["M", 0, 0]);
    expect((shaft[1] as ["L", number, number])[1]).toBeCloseTo(6 * (100 / 105));
  });

  it("draws dots as points, so they come out round at any weight", async () => {
    const { fitDashes } = await import("./ops");
    const segs = fitDashes([["M", 0, 0], ["L", 30, 0], ["L", 30, 30], ["Z"]], [0, 3])!;
    for (let i = 0; i < segs.length; i += 2) {
      const [m, l] = [segs[i], segs[i + 1]] as [["M", number, number], ["L", number, number]];
      expect(Math.hypot(l[1] - m[1], l[2] - m[2])).toBeLessThan(0.01);
    }
    // Settings saved with the old 0.1 pt dots read as the new ones.
    expect(sanitisePrefs({ styles: { rect: { dash: [0.1, 3] } } }).styles.rect!.dash).toEqual([0, 3]);
    expect(sanitisePrefs({ styles: { rect: { dash: [0, 0] } } }).styles.rect!.dash).toBeNull();
  });

  it("offers only patterns the saved settings keep", () => {
    for (const o of DASHES) {
      const p = sanitisePrefs({ styles: { rect: { dash: o.dash } } });
      expect(sameDash(p.styles.rect!.dash, o.dash)).toBe(true);
    }
  });
});

describe("dashes fitted to corners", () => {
  it("centres a dash on every corner, turning it, and fits whole repeats between", async () => {
    const { fitDashes } = await import("./ops");
    const square: PathOp["segs"] = [["M", 0, 0], ["L", 100, 0], ["L", 100, 100], ["L", 0, 100], ["Z"]];
    const segs = fitDashes(square, [4, 3])!;
    const pieces: [number, number][][] = [];
    for (const g of segs) {
      if (g[0] === "M") pieces.push([[g[1], g[2]]]);
      else if (g[0] === "L") pieces.at(-1)!.push([g[1], g[2]]);
    }
    // Every corner lies inside one piece, which turns there (three points).
    for (const c of [[0, 0], [100, 0], [100, 100], [0, 100]]) {
      const at = pieces.filter((pc) => pc.some((p) => p[0] === c[0] && p[1] === c[1]));
      expect(at.length).toBe(1);
      expect(at[0].length).toBe(3);
    }
    // 100 / 7 rounds to 14 repeats an edge: 14 pieces an edge, corners shared.
    expect(pieces.length).toBe(4 * 14);
    // Corner dashes are equal arms of half a dash, stretched to fit.
    const k = 100 / (14 * 7);
    const corner = pieces.find((pc) => pc[1][0] === 100 && pc[1][1] === 0)!;
    expect(corner[0][0]).toBeCloseTo(100 - 2 * k);
    expect(corner[2][1]).toBeCloseTo(2 * k);
  });

  it("puts a dot on each corner of a dotted line, and a dash on each end of an open one", async () => {
    const { fitDashes } = await import("./ops");
    const dots = fitDashes([["M", 0, 0], ["L", 30, 0], ["L", 30, 30], ["Z"]], [0, 3])!;
    const starts = dots.filter((g) => g[0] === "M").length;
    expect(starts).toBeGreaterThan(20);
    const line = fitDashes([["M", 0, 0], ["L", 50, 0]], [4, 3])!;
    expect(line[0]).toEqual(["M", 0, 0]);
    expect(line.at(-1)).toEqual(["L", 50, 0]);
    expect(fitDashes([["M", 0, 0], ["C", 1, 1, 2, 2, 3, 3]], [4, 3])).toBeNull();
  });

  it("draws a dashed rectangle's line as fitted pieces, with no dash pattern left", () => {
    const rect = { id: "r", page: 0, kind: "rect" as const, rect: [0, 0, 100, 50] as [number, number, number, number], style: { ...defaultStyle("rect"), dash: [4, 3] }, meta: { author: "", created: "", modified: "" } };
    const op = opsFor(rect)[0] as PathOp;
    expect(op.dash).toBeNull();
    expect(op.segs.filter((g) => g[0] === "M").length).toBeGreaterThan(10);
  });
});
