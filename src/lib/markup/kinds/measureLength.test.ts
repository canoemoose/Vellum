// docs/edit-lock-brief.md, 7: a Length whose value doesn't fit between its points puts it beyond
// the second point, the dimension line running on to carry it, and with arrow ends turns the
// arrows outside. Only while the value hasn't been moved by hand. Pure geometry: no viewer.

import { describe, expect, it } from "vitest";
import type { MarkupOf, Pt } from "../base";
import { type PathOp, opsFor } from "../ops";
import { len as dist, sub } from "../draw";
import { toSpec } from "../spec";
import type { Frame } from "../pdf";
import { DIMENSION_HEAD } from "../draw";
import { VALUE_CLEAR, barHalf, endReach, valueFits } from "../dimension";
import { kindOf } from ".";
import { lengthGeometry, lengthRuns, lengthValueAt, valueFromCaption } from "./measureLength";

const meta = { author: "Tester", created: "2026-11-16T10:00:00Z", modified: "2026-11-16T10:00:00Z" };
const fmt = { units: "auto" as const, decimals: 2 };

/** A Length made now: `offset` off its points, at 1:100. */
function length(from: Pt, to: Pt, extra: Record<string, unknown> = {}): MarkupOf<"measureLength"> {
  return {
    id: "t-len", page: 0, kind: "measureLength", style: kindOf("measureLength").defaultStyle(), meta,
    scale: 100, userUnit: 1, fmt, labelSize: 8, from, to, offset: 20, ends: "bar", font: "helvetica", ...extra,
  } as unknown as MarkupOf<"measureLength">;
}

const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
/** Where the value's centre sits along the dimension line from its first end, and the line's length. */
function along(m: MarkupOf<"measureLength">): { s: number; L: number; half: number } {
  const { a, b } = lengthGeometry(m);
  const L = dist(sub(b, a));
  const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const v = lengthValueAt(m);
  return { s: dot(sub(v.centre, a), u), L, half: v.size[0] / 2 };
}

describe("the room for a value", () => {
  it("is the line between its ends, less the ends' reach and a clearance each side", () => {
    // Bars take no room along the line.
    expect(valueFits(30 + 2 * VALUE_CLEAR, 30, "bar", 0.75)).toBe(true);
    expect(valueFits(30 + 2 * VALUE_CLEAR - 0.01, 30, "bar", 0.75)).toBe(false);
    // Arrowheads take none either (Matt's review): the value sits above them.
    expect(endReach("arrow", 0.75)).toBeCloseTo(DIMENSION_HEAD.length(0.75), 9);
    expect(valueFits(30 + 2 * VALUE_CLEAR, 30, "arrow", 0.75)).toBe(true);
    expect(valueFits(30 + 2 * VALUE_CLEAR - 0.01, 30, "arrow", 0.75)).toBe(false);
    // Ticks lean an eighth of a turn: their reach along the line.
    const t = barHalf(0.75) * Math.SQRT1_2;
    expect(valueFits(30 + 2 * VALUE_CLEAR + 2 * t, 30, "tick", 0.75)).toBe(true);
    expect(valueFits(30 + 2 * VALUE_CLEAR + 2 * t - 0.01, 30, "tick", 0.75)).toBe(false);
  });
});

describe("a value that doesn't fit between the points", () => {
  // [name, from, long to, short to]: each orientation, and the second point either side.
  const CASES: [string, Pt, Pt, Pt][] = [
    ["level, left to right", [100, 300], [400, 300], [115, 300]],
    ["level, right to left", [400, 300], [100, 300], [385, 300]],
    ["upright, top to bottom", [300, 100], [300, 400], [300, 115]],
    ["upright, bottom to top", [300, 400], [300, 100], [300, 385]],
    ["slanting", [100, 100], [400, 300], [110, 108]],
  ];
  for (const [name, from, far, near] of CASES) {
    it(`stays in the middle where it fits (${name})`, () => {
      const m = length(from, far);
      const { s, L } = along(m);
      expect(s).toBeCloseTo(L / 2, 6);
      expect(lengthRuns(m).beyond).toEqual([]);
      expect(lengthValueAt(m).out).toBe(false);
    });

    it(`goes beyond the second point, the line running on to it (${name})`, () => {
      const m = length(from, near);
      const { s, L, half } = along(m);
      expect(lengthValueAt(m).out).toBe(true);
      // Wholly past the second end, and clear of it.
      expect(s - half).toBeGreaterThanOrEqual(L + VALUE_CLEAR - 1e-6);
      // The line runs on from the second end to past the value.
      const runs = lengthRuns(m).beyond;
      expect(runs).toHaveLength(1);
      const { a, b } = lengthGeometry(m);
      expect(runs[0][0]).toEqual(b);
      expect(dist(sub(runs[0][1], a))).toBeGreaterThan(s + half);
      // Its grip goes with it.
      const grip = kindOf("measureLength").handles!(m).find((h) => h.id === "value")!;
      expect(grip.at).toEqual(lengthValueAt(m).centre);
    });
  }

  it("is re-decided when the label grows", () => {
    const m = length([100, 300], [160, 300]);
    expect(lengthValueAt(m).out).toBe(false);
    expect(lengthValueAt({ ...m, labelSize: 24 }).out).toBe(true);
  });

  it("leaves a value moved by hand where it was put, and goes back to automatic on reset", () => {
    const m = length([100, 300], [115, 300], { value: [0, 0] });
    const { s, L } = along(m);
    expect(s).toBeCloseTo(L / 2, 6);
    expect(lengthValueAt(m).out).toBe(false);
    const reset = kindOf("measureLength").resetHandle!(m, "value") as MarkupOf<"measureLength">;
    expect(reset.value).toBeUndefined();
    expect(lengthValueAt(reset).out).toBe(true);
  });

  it("leaves measurements from before stage 5 (no offset) as they were", () => {
    const m = length([100, 300], [115, 300], { offset: undefined });
    expect(lengthValueAt(m).out).toBe(false);
  });
});

describe("arrow ends out of room", () => {
  /** The filled paths (arrowheads) and the points of their outlines. */
  const heads = (m: MarkupOf<"measureLength">) =>
    opsFor(m).filter((o): o is PathOp => o.t === "path" && o.fill !== null).map((o) => o.segs.filter((g) => g[0] !== "Z").map((g) => [g[1], g[2]] as Pt));

  it("turn outside, pointing in at the points, with a run past the first point to carry its arrow", () => {
    const m = length([100, 300], [115, 300], { ends: "arrow" });
    const r = lengthRuns(m);
    expect(r.outside).toBe(true);
    const { a, b } = lengthGeometry(m);
    // Each head lies outside its point (x below a's, above b's), its tip on the point.
    const hs = heads(m);
    expect(hs.length).toBeGreaterThanOrEqual(2);
    const xs = hs.map((pts) => pts.map((p) => p[0]));
    const left = xs.find((x) => Math.min(...x) < a[0] - 1)!, right = xs.find((x) => Math.max(...x) > b[0] + 1)!;
    expect(Math.max(...left)).toBeCloseTo(a[0], 3);
    expect(Math.min(...right)).toBeCloseTo(b[0], 3);
    // A run past the first point for its arrow; the second point's run carries the value.
    expect(r.beyond.some(([p, q]) => p[0] === a[0] && q[0] < a[0])).toBe(true);
    expect(r.beyond.some(([p, q]) => p[0] === b[0] && q[0] > b[0])).toBe(true);
  });

  it("stay inside, pointing out, where the value fits", () => {
    const m = length([100, 300], [400, 300], { ends: "arrow" });
    expect(lengthRuns(m).outside).toBe(false);
    const { a, b } = lengthGeometry(m);
    for (const pts of heads(m)) for (const p of pts) expect(p[0] >= a[0] - 1e-6 && p[0] <= b[0] + 1e-6).toBe(true);
  });

  it("leave bars and ticks as they are", () => {
    for (const ends of ["bar", "tick"]) {
      const m = length([100, 300], [115, 300], { ends });
      expect(lengthValueAt(m).out).toBe(true);
      expect(lengthRuns(m).outside).toBe(false);
    }
  });

  it("put the value clear of the turned-out head", () => {
    const m = length([100, 300], [115, 300], { ends: "arrow" });
    const { s, L, half } = along(m);
    expect(s - half).toBeGreaterThanOrEqual(L + endReach("arrow", m.style.width) + VALUE_CLEAR - 1e-6);
  });
});

describe("saved as drawn", () => {
  const A3: Frame = { quarterTurns: 0, bbox: [0, 0, 1191, 842] };
  it("writes /CO for the place it moved to by itself, which reads back to the same place", () => {
    const m = length([100, 300], [115, 300]);
    const s = toSpec(m, A3);
    expect(s.captionOffset).toBeDefined();
    // Along the line, the caption sits past the line's middle by more than half the line.
    expect(s.captionOffset![0]).toBeGreaterThan(along(m).L / 2);
    const back = valueFromCaption({ ...m, value: undefined }, s.captionOffset!);
    expect(back[0]).toBeCloseTo(along(m).s - along(m).L / 2, 2);
    expect(back[1]).toBeCloseTo(0, 2);
  });
});

// Matt's review of the build: the ends' weight and size, and a value slid out by hand.
describe("dimension ends at any weight", () => {
  it("draw arrowheads that keep their shape as the line gets heavier", () => {
    expect(DIMENSION_HEAD.length(0.75)).toBeCloseTo(7.2, 9); // the default, as it was
    expect(DIMENSION_HEAD.length(2) / DIMENSION_HEAD.length(1)).toBeCloseTo(2, 9);
  });

  it("draw bars and ticks at the line's weight, in one path with the extension lines", () => {
    for (const ends of ["bar", "tick"]) {
      const m = length([100, 300], [400, 300], { ends, style: { ...kindOf("measureLength").defaultStyle(), width: 2 } });
      const ps = opsFor(m).filter((o): o is PathOp => o.t === "path");
      expect(ps).toHaveLength(2); // the dimension line; the ends with the extension lines
      expect(ps[1].width).toBe(2);
      expect(ps[1].segs).toHaveLength(8); // two extension lines and two ends, a move and a line each
    }
  });
});

describe("a value slid past an end by hand", () => {
  it("turns arrows outside, each end carried by a run", () => {
    const m = length([100, 300], [400, 300], { ends: "arrow", value: [250, 0] });
    const r = lengthRuns(m);
    expect(r.outside).toBe(true);
    const { a, b } = lengthGeometry(m);
    expect(r.beyond.some(([p, q]) => p[0] === a[0] && q[0] < a[0])).toBe(true);
    expect(r.beyond.some(([p, q]) => p[0] === b[0] && q[0] > b[0])).toBe(true);
  });

  it("past the first point, carries the second point's arrow on a run of its own", () => {
    const m = length([100, 300], [400, 300], { ends: "arrow", value: [-250, 0] });
    const r = lengthRuns(m);
    expect(r.outside).toBe(true);
    const { b } = lengthGeometry(m);
    expect(r.beyond.some(([p, q]) => p[0] === b[0] && q[0] > b[0])).toBe(true);
  });

  it("leaves arrows inside while the value stays between the ends", () => {
    expect(lengthRuns(length([100, 300], [400, 300], { ends: "arrow", value: [60, 0] })).outside).toBe(false);
  });
});

describe("switching a dimension's ends", () => {
  it("never sends its value outside: arrows go out exactly where bars would", () => {
    for (let x = 105; x <= 200; x += 1) {
      const bar = length([100, 300], [x, 300]);
      expect(lengthValueAt({ ...bar, ends: "arrow" }).out).toBe(lengthValueAt(bar).out);
    }
  });
});
