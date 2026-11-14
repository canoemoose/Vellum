import { describe, expect, it } from "vitest";
import {
  bounds,
  type Ctx,
  Drawing,
  drawStrokes,
  exportPlan,
  finishStroke,
  MAX_EXPORT_SCALE,
  MAX_EXPORT_SIDE,
  MIN_STEP,
  parse,
  pathData,
  PEN_WIDTH,
  type Pt,
  segmentDistance,
  serialise,
  simplify,
  smooth,
  type Stroke,
  thin,
  toSvg,
  TOLERANCE,
} from "./strokes";

/** Deterministic jitter. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

/** A pen moving round a circle, sampled finely, with hand jitter. */
function circle(n: number, r = 60, jitter = 0): Stroke {
  const j = rng(7);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / (n - 1)) * Math.PI * 2;
    return { x: 100 + r * Math.cos(a) + jitter * j(), y: 100 + r * Math.sin(a) + jitter * j() };
  });
}

/** Distance from p to a polyline. */
function toPolyline(p: Pt, line: Stroke): number {
  if (line.length === 1) return Math.hypot(p.x - line[0].x, p.y - line[0].y);
  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, segmentDistance(p, line[i], line[i + 1]));
  return d;
}

describe("thin", () => {
  it("drops points that barely move and keeps both ends", () => {
    const pts: Stroke = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.2, y: 0.1 }, { x: 1, y: 0 }, { x: 1.1, y: 0 }];
    const t = thin(pts);
    expect(t[0]).toEqual(pts[0]);
    expect(t[t.length - 1]).toEqual(pts[pts.length - 1]);
    expect(t).toHaveLength(3);
  });

  it("collapses a pen held still to one point", () => {
    const still = Array.from({ length: 50 }, () => ({ x: 5, y: 5 }));
    expect(thin(still)).toEqual([{ x: 5, y: 5 }]);
  });
});

describe("smooth", () => {
  it("pins the ends and takes out zigzag jitter", () => {
    const zig: Stroke = Array.from({ length: 40 }, (_, i) => ({ x: i, y: i % 2 ? 1 : -1 }));
    const s = smooth(zig);
    expect(s[0]).toEqual(zig[0]);
    expect(s[s.length - 1]).toEqual(zig[zig.length - 1]);
    const inner = s.slice(2, -2).map((p) => Math.abs(p.y));
    expect(Math.max(...inner)).toBeLessThan(0.3);
  });

  it("leaves a straight line straight", () => {
    const line = Array.from({ length: 10 }, (_, i) => ({ x: i * 3, y: i * 2 }));
    for (const p of smooth(line)) expect(p.y).toBeCloseTo((p.x * 2) / 3, 10);
  });
});

describe("simplify", () => {
  it("reduces a straight run to its ends", () => {
    const line = Array.from({ length: 500 }, (_, i) => ({ x: i, y: 2 * i }));
    expect(simplify(line)).toEqual([line[0], line[499]]);
  });

  it("keeps a dense curve within tolerance with far fewer points", () => {
    const c = circle(4000);
    const s = simplify(c);
    expect(s.length).toBeLessThan(120);
    for (const p of c) expect(toPolyline(p, s)).toBeLessThanOrEqual(TOLERANCE + 1e-9);
  });

  it("copes with very long strokes (iterative, no recursion limit)", () => {
    const spiral = Array.from({ length: 100000 }, (_, i) => {
      const a = i / 500;
      return { x: Math.cos(a) * (10 + i / 100), y: Math.sin(a) * (10 + i / 100) };
    });
    const s = simplify(spiral);
    expect(s.length).toBeGreaterThan(100);
    expect(s.length).toBeLessThan(5000);
  });
});

describe("finishStroke", () => {
  it("turns thousands of jittery samples into a few dozen points that follow the stroke", () => {
    const raw = circle(3000, 60, 0.6);
    const s = finishStroke(raw);
    expect(s.length).toBeGreaterThan(10);
    expect(s.length).toBeLessThan(150);
    // Within a pixel or so of the true circle everywhere.
    for (const p of s) expect(Math.abs(Math.hypot(p.x - 100, p.y - 100) - 60)).toBeLessThan(1.2);
    expect(s[0]).toEqual(raw[0]);
    expect(s[s.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it("makes a tap a dot", () => {
    expect(finishStroke([{ x: 3, y: 4 }])).toEqual([{ x: 3, y: 4 }]);
    expect(finishStroke([{ x: 3, y: 4 }, { x: 3.2, y: 4.1 }, { x: 3.1, y: 4 }])).toEqual([{ x: 3, y: 4 }]);
    expect(finishStroke([])).toEqual([]);
  });

  it("keeps a short flick as a line", () => {
    const s = finishStroke([{ x: 0, y: 0 }, { x: MIN_STEP * 3, y: 0 }]);
    expect(s).toHaveLength(2);
  });
});

describe("Drawing", () => {
  it("captures, undoes and clears", () => {
    const d = new Drawing();
    expect(d.isEmpty).toBe(true);
    d.begin({ x: 0, y: 0 });
    for (let i = 1; i <= 100; i++) d.extend({ x: i, y: 0 });
    expect(d.isEmpty).toBe(false);
    expect(d.end()).toHaveLength(2);
    d.begin({ x: 50, y: 50 });
    d.end();
    expect(d.strokes).toHaveLength(2);
    expect(d.strokes[1]).toEqual([{ x: 50, y: 50 }]);
    expect(d.pointCount).toBe(3);
    expect(d.undo()).toBe(true);
    expect(d.strokes).toHaveLength(1);
    d.clear();
    expect(d.isEmpty).toBe(true);
    expect(d.undo()).toBe(false);
    expect(d.end()).toBeNull();
  });

  it("undo during a stroke drops the stroke in progress", () => {
    const d = new Drawing();
    d.begin({ x: 0, y: 0 });
    d.end();
    d.begin({ x: 10, y: 10 });
    d.extend({ x: 20, y: 20 });
    d.undo();
    expect(d.live).toBeNull();
    expect(d.strokes).toHaveLength(1);
    d.begin({ x: 1, y: 1 });
    d.cancel();
    expect(d.strokes).toHaveLength(1);
  });
});

describe("bounds and export", () => {
  const strokes: Stroke[] = [
    [{ x: 10, y: 20 }, { x: 110, y: 40 }],
    [{ x: 60, y: 70 }],
  ];

  it("measures centre lines", () => {
    expect(bounds(strokes)).toEqual({ x0: 10, y0: 20, x1: 110, y1: 70 });
    expect(bounds([])).toBeNull();
  });

  it("crops with a margin and caps the scale", () => {
    const plan = exportPlan(strokes)!;
    const pad = PEN_WIDTH * 1.5;
    expect(plan.scale).toBe(MAX_EXPORT_SCALE);
    expect(plan.width).toBe(Math.round((100 + 2 * pad) * MAX_EXPORT_SCALE));
    expect(plan.height).toBe(Math.round((50 + 2 * pad) * MAX_EXPORT_SCALE));
    const m = plan.map({ x: 10, y: 20 });
    expect(m.x).toBeCloseTo(pad * MAX_EXPORT_SCALE, 9);
    expect(m.y).toBeCloseTo(pad * MAX_EXPORT_SCALE, 9);
    expect(plan.penWidth).toBeCloseTo(PEN_WIDTH * MAX_EXPORT_SCALE);
    expect(exportPlan([])).toBeNull();
  });

  it("caps the long side for a wide drawing", () => {
    const plan = exportPlan([[{ x: 0, y: 0 }, { x: 1000, y: 100 }]])!;
    expect(Math.max(plan.width, plan.height)).toBe(MAX_EXPORT_SIDE);
    expect(plan.scale).toBeLessThan(2);
  });
});

/** A context that records calls. */
function recorder() {
  const calls: string[] = [];
  const ctx = {
    lineWidth: 0,
    lineCap: "butt",
    lineJoin: "miter",
    strokeStyle: "",
    fillStyle: "",
    beginPath: () => calls.push("begin"),
    moveTo: (x: number, y: number) => calls.push(`M ${x} ${y}`),
    lineTo: (x: number, y: number) => calls.push(`L ${x} ${y}`),
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => calls.push(`Q ${cx} ${cy} ${x} ${y}`),
    arc: (x: number, y: number, r: number) => calls.push(`arc ${x} ${y} ${r}`),
    stroke: () => calls.push("stroke"),
    fill: () => calls.push("fill"),
  };
  return { ctx: ctx as Ctx, calls };
}

describe("drawStrokes", () => {
  it("draws curves through midpoints, lines for two points, and dots", () => {
    const { ctx, calls } = recorder();
    drawStrokes(
      ctx,
      [
        [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }],
        [{ x: 0, y: 0 }, { x: 5, y: 5 }],
        [{ x: 7, y: 7 }],
      ],
      { colour: "#000", width: 4 },
    );
    expect(calls).toEqual([
      "begin", "M 0 0", "Q 10 0 15 5", "L 20 10", "stroke",
      "begin", "M 0 0", "L 5 5", "stroke",
      "begin", "arc 7 7 2", "fill",
    ]);
    expect(ctx.lineCap).toBe("round");
    expect(ctx.lineWidth).toBe(4);
  });

  it("maps points to the output", () => {
    const { ctx, calls } = recorder();
    drawStrokes(ctx, [[{ x: 1, y: 2 }]], { colour: "#000", width: 2, map: (p) => ({ x: p.x * 10, y: p.y * 10 }) });
    expect(calls).toContain("arc 10 20 1");
  });
});

describe("SVG and stored form", () => {
  const strokes: Stroke[] = [
    [{ x: 0, y: 0 }, { x: 10.04, y: 0 }, { x: 20, y: 10 }],
    [{ x: 30, y: 30 }],
  ];

  it("writes paths and dots in a cropped viewBox", () => {
    const svg = toSvg(strokes)!;
    // The pen is 2.6, so the margin is 3.9.
    expect(svg).toContain(`viewBox="-3.9 -3.9 37.8 37.8"`);
    expect(svg).toContain(`<path d="M0 0Q10 0 15 5L20 10"/>`);
    expect(svg).toContain(`<circle cx="30" cy="30" r="1.3"`);
    expect(toSvg([])).toBeNull();
    expect(pathData([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe("M0 0L1 1");
  });

  it("round-trips to 0.1 px", () => {
    const back = parse(serialise(strokes))!;
    expect(back.pen).toBe(PEN_WIDTH);
    expect(back.strokes).toEqual([
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }],
      [{ x: 30, y: 30 }],
    ]);
  });

  it("refuses anything that isn't a stored drawing", () => {
    for (const bad of ["", "nope", "null", "[]", '{"v":2,"pen":1,"strokes":[]}', '{"v":1,"pen":0,"strokes":[]}',
      '{"v":1,"pen":1,"strokes":[[1]]}', '{"v":1,"pen":1,"strokes":[[1,"2"]]}', '{"v":1,"pen":1,"strokes":[[]]}']) {
      expect(parse(bad), bad).toBeNull();
    }
    expect(parse('{"v":1,"pen":2,"strokes":[]}')).toEqual({ strokes: [], pen: 2 });
  });
});
