// Stage 5 of docs/editing-tool-consistency-brief.md, the dimensions: placed the CAD way (the
// offset line and its extension lines), where the value sits and which way it reads, its grip,
// the ends, the font, the standard keys it saves with (/LL, /LLE, /LLO, /CO, /LE) at every
// /Rotate, the angle's corner-first order, and measurements saved before still drawing as they
// did. Pure: no viewer.

import { afterEach, describe, expect, it } from "vitest";
import type { Markup, MarkupKind, MarkupOf, Pt } from "./base";
import { type PathOp, type TextOp, opsFor } from "./ops";
import { add, mul, sub, unit } from "./draw";
import { toSpec } from "./spec";
import { type Frame, toPage, toUser } from "./pdf";
import { MM_PER_PT, setMeasureSource, uprightDir } from "./measure";
import { DEFAULT_LOOK, EXT_BEYOND, EXT_GAP, barHalf, dimensionLine, faceOf, labelAlong, sanitiseLook, setDimensionLook, valueGap } from "./dimension";
import { hasEnds, relook } from "./measurements";
import { kindOf } from "./kinds";
import { lengthFromPoints, lengthGeometry, lengthLabel, lengthRuns, lengthValueAt, lengthValues, valueFromCaption } from "./kinds/measureLength";
import { pathValueAt } from "./kinds/measurePath";
import { areaValueAt } from "./kinds/measureArea";
import { angleVertices } from "./kinds/measureAngle";
import { gestureTip, lockTip } from "./tools";
import type { KindDef } from "./kinds/kind";
import { fromFile } from "./fileAnnots";

const meta = { author: "Tester", created: "2026-11-15T10:00:00Z", modified: "2026-11-15T10:00:00Z" };
const fmt = { units: "auto" as const, decimals: 2 };
const pt = (mm: number) => mm / MM_PER_PT;
/** The real length, mm, of `points` on paper at the tests' 1:100. */
const realOf = (points: number) => points * MM_PER_PT * 100;

function mk<K extends MarkupKind>(kind: K, shape: Record<string, unknown>, extra: Record<string, unknown> = {}): MarkupOf<K> {
  return { id: `t-${kind}`, page: 0, kind, style: kindOf(kind).defaultStyle(), meta, scale: 100, userUnit: 1, fmt, labelSize: 8, ...shape, ...extra } as unknown as MarkupOf<K>;
}
/** A Length made now (stage 5 fields set), `offset` off its points. */
const len = (from: Pt, to: Pt, offset = 0, extra: Record<string, unknown> = {}) => mk("measureLength", { from, to, offset, ends: "bar", font: "helvetica" }, extra);

const texts = (m: Markup) => opsFor(m).filter((o): o is TextOp => o.t === "text");
const paths = (m: Markup) => opsFor(m).filter((o): o is PathOp => o.t === "path");
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const close = (a: Pt, b: Pt, d = 6) => [0, 1].forEach((k) => expect(a[k]).toBeCloseTo(b[k], d));
/** A text op's centre: its clip quad's middle. */
const centreOf = (t: TextOp): Pt => mul(add(t.clip![0], t.clip![2]), 0.5);

afterEach(() => {
  setMeasureSource({ page: () => ({ ratio: null, userUnit: 1 }), format: () => fmt, labelSize: () => 8 });
  setDimensionLook(() => DEFAULT_LOOK);
});

/** Directions every 15 degrees, page axes. */
const DIRS: Pt[] = Array.from({ length: 24 }, (_, i) => [Math.cos((i * Math.PI) / 12), Math.sin((i * Math.PI) / 12)]);

describe("placed the CAD way: the offset line and its extension lines", () => {
  for (const d of DIRS) {
    const deg = Math.round((Math.atan2(d[1], d[0]) * 180) / Math.PI);
    it(`sits the dimension line its offset off the points, square to them, at ${deg} degrees`, () => {
      const from: Pt = [300, 300], to = add(from, mul(d, 200));
      for (const off of [30, -30]) {
        const m = len(from, to, off);
        const { a, b, extensions } = lengthGeometry(m);
        const normal: Pt = [d[1], -d[0]];
        close(a, add(from, mul(normal, off)));
        close(b, add(to, mul(normal, off)));
        // Parallel and the same length as what it measures: the value is unchanged.
        expect(Math.hypot(...sub(b, a))).toBeCloseTo(200, 6);
        expect(lengthLabel(m)).toBe(lengthLabel(len(from, to)));
        // An extension line from each point, leaving a gap there and running past the line.
        expect(extensions.length).toBe(2);
        extensions.forEach(([s, e], i) => {
          const p = i ? to : from;
          close(s, add(p, mul(normal, Math.sign(off) * EXT_GAP)));
          close(e, add(p, mul(normal, off + Math.sign(off) * EXT_BEYOND)));
        });
        // Drawn: the dimension line through a and b, then the extension lines with the bars.
        const ps = paths(m);
        expect(ps[0].segs[0]).toEqual(["M", a[0], a[1]]);
        expect(ps[1].segs.length).toBe(8);
      }
    });
  }

  it("has no extension lines in line, or too near the points for them to show", () => {
    expect(lengthGeometry(len([0, 0], [100, 0], 0)).extensions).toEqual([]);
    expect(lengthGeometry(len([0, 0], [100, 0], EXT_GAP)).extensions).toEqual([]);
    expect(lengthGeometry(len([0, 0], [100, 0], EXT_GAP + 0.5)).extensions.length).toBe(2);
  });

  it("takes the offset from the third click's distance off the line, either side", () => {
    expect(lengthFromPoints([[0, 0], [100, 0]])).toEqual({ from: [0, 0], to: [100, 0], offset: 0 });
    // Up the page is the line's normal for a rightward line.
    expect(lengthFromPoints([[0, 0], [100, 0], [40, -25]]).offset).toBeCloseTo(25);
    expect(lengthFromPoints([[0, 0], [100, 0], [40, 25]]).offset).toBeCloseTo(-25);
    // Measuring straight (Shift), only its distance counts, not where along.
    expect(lengthFromPoints([[0, 0], [100, 0], [-400, -25]], { textStyle: {} as never, free: true }).offset).toBeCloseTo(25);
    // On the points (within a grip's reach): in line.
    expect(lengthFromPoints([[0, 0], [100, 0], [100, 3]], { textStyle: {} as never, pick: 5 }).offset).toBe(0);
    expect(lengthFromPoints([[0, 0], [100, 0], [100, 6]], { textStyle: {} as never, pick: 5 }).offset).toBeCloseTo(-6);
  });

  it("measures across, up and down, or straight between, by the way it's pulled (Matt's review)", () => {
    const from: Pt = [100, 100], to: Pt = [200, 160];
    const ctx = (free: boolean) => ({ textStyle: {} as never, pick: 2, free });
    // Pulled above the points: the horizontal distance, the line level above them.
    const above = len(from, to, 0, lengthFromPoints([from, to, [150, 60]], ctx(false)));
    expect(above.orient).toBe("level");
    expect(lengthValues(above).realMm).toBeCloseTo(realOf(100), 6);
    const g = lengthGeometry(above);
    close(g.a, [100, 60]);
    close(g.b, [200, 60]);
    // Each point's extension line reaches the line from its own point.
    expect(g.extensions.length).toBe(2);
    // The value reads along the dimension line, not the slant between the points.
    expect(lengthValueAt(above).dir).toEqual([1, 0]);
    expect(texts(above)[0].dir).toEqual([1, 0]);
    close(g.extensions[1][0], [200, 160 - EXT_GAP]);
    // Pulled beside them: the vertical distance.
    const beside = len(from, to, 0, lengthFromPoints([from, to, [260, 130]], ctx(false)));
    expect(beside.orient).toBe("upright");
    expect(lengthValues(beside).realMm).toBeCloseTo(realOf(60), 6);
    expect(lengthValueAt(beside).dir).toEqual([0, -1]);
    close(lengthGeometry(beside).a, [260, 100]);
    close(lengthGeometry(beside).b, [260, 160]);
    // Shift: straight between them, wherever it's pulled.
    const straight = len(from, to, 0, lengthFromPoints([from, to, [150, 60]], ctx(true)));
    expect(straight.orient).toBeUndefined();
    expect(lengthValues(straight).realMm).toBeCloseTo(realOf(Math.hypot(100, 60)), 6);
    // Its line's grip pulls the same way.
    const k = kindOf("measureLength");
    expect(k.dragHandle(above, "offset", [300, 130], false, 2).orient).toBe("upright");
    expect(k.dragHandle(above, "offset", [300, 130], true, 2).orient).toBeUndefined();
  });

  it("is placed with three points, dragged in line, and shown as it would be made while placed", () => {
    const d = kindOf("measureLength").draw;
    expect(d.gesture === "points" && [d.min, d.max, d.drag, d.preview]).toEqual([2, 3, "line", true]);
    const c = kindOf("measureCalibrate").draw;
    expect(c.gesture === "points" && c.max).toBe(2);
  });

  it("is picked on its dimension line, extension lines and value, not between its points", () => {
    const m = len([100, 100], [300, 100], 40);
    const k = kindOf("measureLength");
    expect(k.hits(m, [200, 100], 1)).toBe(false);
    expect(k.hits(m, [200, 60], 1)).toBe(true);
    expect(k.hits(m, [100, 70], 1)).toBe(true);
    expect(k.hits(m, [200, 80], 1)).toBe(false);
    expect(k.hits(m, lengthValueAt(m).centre, 1)).toBe(true);
    expect(k.bounds(m)).toEqual([100, 60, 300, 100]);
  });

  it("moves with its points and keeps its offset", () => {
    const m = kindOf("measureLength").moveBy(len([0, 0], [100, 0], 20), 5, 7);
    expect([m.from, m.to, m.offset]).toEqual([[5, 7], [105, 7], 20]);
  });
});

describe("the value", () => {
  it("sits above a level line, reading left to right, clear of it", () => {
    const m = len([100, 200], [300, 200], 0);
    const t = texts(m)[0];
    expect(t.dir).toEqual([1, 0]);
    const c = centreOf(t);
    expect(c[0]).toBeCloseTo(200, 6);
    expect(c[1]).toBeLessThan(200 - valueGap(m.style.width));
  });

  it("sits to the left of an upright line, reading from the bottom (from the right of the sheet), as CAD does", () => {
    for (const [from, to] of [[[200, 100], [200, 300]], [[200, 300], [200, 100]]] as [Pt, Pt][]) {
      const m = len(from, to, 0);
      const t = texts(m)[0];
      expect(t.dir).toEqual([0, -1]);
      const c = centreOf(t);
      expect(c[0]).toBeLessThan(200 - valueGap(m.style.width));
      expect(c[1]).toBeCloseTo(200, 6);
    }
  });

  it("is never upside down, and faces the top of the page, at every 15 degrees", () => {
    for (const d of DIRS) {
      const from: Pt = [300, 300], to = add(from, mul(d, 200));
      const m = len(from, to, 0);
      const t = texts(m)[0];
      // Reads rightwards, or up the page when upright.
      expect(t.dir[0] > 1e-9 || (Math.abs(t.dir[0]) <= 1e-9 && t.dir[1] < 0)).toBe(true);
      const side = sub(centreOf(t), mul(add(from, to), 0.5));
      if (Math.abs(t.dir[0]) <= 1e-9) expect(side[0]).toBeLessThan(0);
      else expect(side[1]).toBeLessThan(0);
    }
  });

  it("follows a pulled-out line", () => {
    const a = len([100, 200], [300, 200], 0), b = len([100, 200], [300, 200], 50);
    close(lengthValueAt(b).centre, add(lengthValueAt(a).centre, [0, -50]));
  });

  it("slides along the line by its grip, takes the line with it off it, and goes back to the middle on a double-click (Matt's review)", () => {
    const k = kindOf("measureLength");
    for (const d of DIRS) {
      const m = len([300, 300], add([300, 300], mul(d, 200)), 25);
      const home = lengthValueAt(m).centre;
      const along = unit(sub(m.to, m.from));
      const normal: Pt = [along[1], -along[0]];
      const moved = k.dragHandle(m, "value", add(home, [17, -9]), false, 2);
      // It goes where it's dragged: along the line by sliding, off it by moving the line.
      close(lengthValueAt(moved).centre, add(home, [17, -9]));
      expect(moved.value![1]).toBe(0);
      expect(moved.offset!).toBeCloseTo(25 + dot([17, -9], normal), 6);
      // Put back: the middle of the line, which stays where it was moved to.
      const back = k.resetHandle!(moved, "value")!;
      expect(back.value).toBeUndefined();
      expect(back.offset).toBe(moved.offset);
      close(lengthValueAt(back).centre, add(home, mul(normal, dot([17, -9], normal))));
      expect(k.resetHandle!(m, "value")).toBeNull();
      expect(k.resetHandle!(moved, "from")).toBeNull();
    }
  });

  it("past either end, the dimension line reaches out to it, and no further than a width and a half (Matt's review)", () => {
    const k = kindOf("measureLength");
    const m = len([100, 200], [300, 200], 30);
    const { size } = lengthValueAt(m);
    expect(lengthRuns(m).beyond).toEqual([]);
    // Slid well past the right-hand end: the line runs on to just past it.
    const y = lengthValueAt(m).centre[1];
    const out = k.dragHandle(m, "value", [400, y], false, 2);
    const runs = lengthRuns(out);
    expect(runs.beyond.length).toBe(1);
    const c = lengthValueAt(out).centre;
    expect(runs.beyond[0][1][0]).toBeGreaterThan(c[0] + size[0] / 2);
    expect(k.hits(out, [runs.beyond[0][1][0] - 1, 170], 1)).toBe(true);
    // Miles away is held to a width and a half past the end.
    const far = k.dragHandle(m, "value", [5000, y], false, 2);
    expect(lengthValueAt(far).centre[0]).toBeCloseTo(200 + 100 + size[0] * 1.5, 6);
    // And out past the left-hand end too.
    expect(lengthRuns(k.dragHandle(m, "value", [-200, y], false, 2)).beyond[0][0]).toEqual(lengthGeometry(m).a);
  });

  it("is moved on a polyline length and an area too, and put back", () => {
    const p = mk("measurePath", { vertices: [[0, 0], [200, 0], [200, 100]] });
    const kp = kindOf("measurePath");
    const hp = pathValueAt(p).centre;
    const pm = kp.dragHandle(p, "value", add(hp, [10, 40]), false, 2);
    close(pathValueAt(pm).centre, add(hp, [10, 40]));
    close(centreOf(texts(pm)[0]), add(hp, [10, 40]));
    expect(kp.resetHandle!(pm, "value")!.value).toBeUndefined();
    // Moving a vertex keeps the value where it was moved to, relative to its place.
    const a = mk("measureArea", { vertices: [[0, 0], [100, 0], [100, 100], [0, 100]] });
    const ka = kindOf("measureArea");
    const am = ka.dragHandle(a, "value", [150, 50], false, 2);
    close(areaValueAt(am).centre, [150, 50]);
    expect(ka.handles(am).map((h) => h.id)).toContain("value");
    expect(ka.resetHandle!(am, "value")!.value).toBeUndefined();
  });

  it("an angle's value doesn't move: it has no grip for one", () => {
    const m = mk("measureAngle", { vertices: [[200, 100], [100, 100], [100, 0]] });
    expect(kindOf("measureAngle").handles(m).map((h) => h.id)).toEqual(["v0", "v1", "v2"]);
  });
});

describe("measurements saved before stage 5", () => {
  it("draw exactly as before: in line, bars, Helvetica, the value where it was (left of an upright line)", () => {
    for (const [from, to] of [[[100, 100], [100 + pt(124), 100]], [[200, 300], [200, 100]], [[0, 0], [80, 60]]] as [Pt, Pt][]) {
      const old = mk("measureLength", { from, to });
      const s = old.style;
      const before = [...dimensionLine([from, to], s), labelAlong(lengthLabel(old), from, to, old.labelSize, s.stroke, barHalf(s.width) * 0.5 + 1, uprightDir(from, to))];
      const now = opsFor(old);
      expect(now.length).toBe(before.length);
      now.forEach((op, i) => {
        if (op.t === "text") {
          const b = before[i] as TextOp;
          close(op.origin, b.origin, 9);
          expect([op.dir, op.lines, op.face]).toEqual([b.dir, b.lines, b.face]);
        } else expect(op).toEqual(before[i]);
      });
    }
  });

  it("save without the new keys, and a polyline length's value stays above its longest segment", () => {
    const s = toSpec(mk("measureLength", { from: [100, 100], to: [300, 100] }), { quarterTurns: 0, bbox: [0, 0, 1191, 842] });
    expect(s.leader).toBeUndefined();
    expect(s.captionOffset).toBeUndefined();
    expect(s.lineEnds).toEqual(["Butt", "Butt"]);
    const p = mk("measurePath", { vertices: [[0, 0], [200, 0], [200, 50]] });
    const t = texts(p)[0];
    const b = labelAlong(t.lines[0], [0, 0], [200, 0], 8, p.style.stroke, barHalf(p.style.width) * 0.5 + 1, [1, 0]);
    close(t.origin, b.origin, 9);
  });
});

describe("ends", () => {
  it("are bars by default, ticks at 45 degrees both leaning alike, or filled arrows", () => {
    const at = (ends: string) => paths(len([100, 100], [300, 100], 0, { ends }));
    const bars = at("bar")[1].segs;
    const h = barHalf(0.75);
    expect(bars).toEqual([["M", 100, 100 + h], ["L", 100, 100 - h], ["M", 300, 100 + h], ["L", 300, 100 - h]].map((s) => s.map((v) => (typeof v === "number" ? expect.closeTo(v, 9) : v))));
    const ticks = at("tick")[1];
    const dir = (i: number) => unit(sub([ticks.segs[i + 1][1], ticks.segs[i + 1][2]] as Pt, [ticks.segs[i][1], ticks.segs[i][2]] as Pt));
    // 45 degrees off the line, the same way at both ends, the line's weight (Matt's review).
    expect(Math.abs(dir(0)[0])).toBeCloseTo(Math.SQRT1_2, 6);
    close(dir(0), dir(2));
    expect(ticks.width).toBeCloseTo(0.75);
    const arrows = at("arrow");
    // The line and its two heads, one filled outline in the line's colour.
    expect(arrows.length).toBe(1);
    expect(arrows[0].stroke).toBeNull();
    expect(arrows[0].fill).toEqual(kindOf("measureLength").defaultStyle().stroke);
  });

  it("save as /LE, an arrow's heads filled with the line's colour (/IC)", () => {
    const A3: Frame = { quarterTurns: 0, bbox: [0, 0, 1191, 842] };
    expect(toSpec(len([0, 0], [100, 0], 0, { ends: "tick" }), A3).lineEnds).toEqual(["Slash", "Slash"]);
    const a = toSpec(len([0, 0], [100, 0], 0, { ends: "arrow" }), A3);
    expect([a.lineEnds, a.interior]).toEqual([["ClosedArrow", "ClosedArrow"], kindOf("measureLength").defaultStyle().stroke]);
    const p = toSpec(mk("measurePath", { vertices: [[0, 0], [50, 0], [50, 50]], ends: "arrow" }), A3);
    expect(p.lineEnds).toEqual(["ClosedArrow", "ClosedArrow"]);
    expect(paths(mk("measurePath", { vertices: [[0, 0], [50, 0], [50, 50]], ends: "tick" }))[1].width).toBeCloseTo(0.75);
  });

  it("are chosen for the selection, only where there's a dimension line; the font for every measurement", () => {
    const l = len([0, 0], [100, 0]), a = mk("measureAngle", { vertices: [[1, 0], [0, 0], [0, 1]] }, { id: "ang" });
    const ids = new Set([l.id, a.id]);
    const out = relook([l, a], ids, { ends: "arrow", font: "courierBold" });
    expect((out[0] as MarkupOf<"measureLength">).ends).toBe("arrow");
    expect((out[1] as MarkupOf<"measureAngle">).ends).toBeUndefined();
    expect(out.map((m) => (m as MarkupOf<"measureAngle">).font)).toEqual(["courierBold", "courierBold"]);
    expect(relook(out, ids, { ends: "arrow", font: "courierBold" })).toBe(out);
    expect(relook(out, new Set(), { font: "helvetica" })).toBe(out);
    expect([hasEnds(l), hasEnds(a)]).toEqual([true, false]);
  });

  it("new measurements take the remembered look; odd stored looks fall back to bars and Helvetica", () => {
    setDimensionLook(() => ({ ends: "tick", font: "courier" }));
    const d = kindOf("measureLength").draw;
    const shape = d.gesture === "points" ? d.make([[0, 0], [10, 0]], { textStyle: {} as never }) : null;
    expect([shape?.ends, shape?.font]).toEqual(["tick", "courier"]);
    expect(sanitiseLook({ ends: "dot", font: "comic" })).toEqual(DEFAULT_LOOK);
    expect(sanitiseLook({ ends: "arrow", font: "courierBold" })).toEqual({ ends: "arrow", font: "courierBold" });
    expect(sanitiseLook(null)).toEqual(DEFAULT_LOOK);
  });
});

describe("font", () => {
  it("writes the value in Courier, Courier Bold or Helvetica, by the standard names (nothing embedded)", () => {
    const A3: Frame = { quarterTurns: 0, bbox: [0, 0, 1191, 842] };
    for (const [font, res, base] of [["helvetica", "Helv", "Helvetica"], ["courier", "Cour", "Courier"], ["courierBold", "CoBo", "Courier-Bold"]]) {
      for (const kind of ["measureLength", "measurePath", "measureArea", "measureAngle"] as const) {
        const shape = kind === "measureLength" ? { from: [0, 0], to: [100, 0] } : { vertices: [[0, 0], [100, 0], [100, 80]] };
        const m = mk(kind, shape, { font });
        expect(texts(m)[0].face, `${kind} ${font}`).toEqual(faceOf(font as never));
        expect(toSpec(m, A3).appearance.fonts).toEqual({ [res]: base });
      }
    }
  });

  it("sizes the value by its own font's widths (Courier is wider)", () => {
    const h = lengthValueAt(len([0, 0], [300, 0], 0, { font: "helvetica" })).size[0];
    const c = lengthValueAt(len([0, 0], [300, 0], 0, { font: "courier" })).size[0];
    expect(c).toBeGreaterThan(h);
    expect(c).toBeCloseTo(lengthLabel(len([0, 0], [300, 0])).length * 0.6 * 8, 6);
  });
});

describe("saved with the standard keys", () => {
  const frames: Frame[] = [0, 1, 2, 3].map((q) => ({ quarterTurns: q, bbox: [10, 20, 610, 820] }));

  for (const f of frames) {
    it(`writes /LL, /LLE, /LLO so other apps draw the line where it is, at /Rotate ${f.quarterTurns * 90}`, () => {
      for (const d of DIRS.filter((_, i) => i % 3 === 0)) {
        for (const off of [40, -25]) {
          const m = len([300, 300], add([300, 300], mul(d, 150)), off);
          const s = toSpec(m, f);
          expect(s.leader).toEqual([off, EXT_BEYOND, EXT_GAP]);
          // As poppler draws it: along /L, the main line at +LL on the anticlockwise normal.
          const [x1, y1, x2, y2] = s.line!;
          const u = unit([x2 - x1, y2 - y1]);
          const n: Pt = [-u[1], u[0]];
          const { a, b } = lengthGeometry(m);
          close(add([x1, y1], mul(n, s.leader![0])), toUser(f, ...a), 2);
          close(add([x2, y2], mul(n, s.leader![0])), toUser(f, ...b), 2);
        }
      }
    });

    it(`writes /CO, the value's place from a top caption, and reads it back, at /Rotate ${f.quarterTurns * 90}`, () => {
      const m = len([300, 300], [450, 380], 30, { value: [12, -7] });
      const s = toSpec(m, f);
      expect(s.captionOffset).toBeDefined();
      // Back from the file: the same place.
      const back = valueFromCaption({ ...m, value: undefined }, s.captionOffset!);
      expect(back[0]).toBeCloseTo(12, 2);
      expect(back[1]).toBeCloseTo(-7, 2);
      // The caption's centre as poppler places it: the line's middle, the normal place over it, plus /CO.
      const [x1, y1, x2, y2] = s.line!;
      const u = unit([x2 - x1, y2 - y1]);
      const n: Pt = [-u[1], u[0]];
      const mid: Pt = [(x1 + x2) / 2 + n[0] * s.leader![0], (y1 + y2) / 2 + n[1] * s.leader![0]];
      const h = lengthValueAt(m).size[1];
      const c = add(mid, add(mul(u, s.captionOffset![0]), mul(n, s.captionOffset![1] + 2 * m.style.width + h / 2)));
      close(c, toUser(f, ...lengthValueAt(m).centre), 2);
    });
  }

  it("writes no /LL in line, and a /CO that puts other apps' caption where Vellum's value is", () => {
    const A3: Frame = { quarterTurns: 0, bbox: [0, 0, 1191, 842] };
    const m = len([100, 100], [300, 100], 0);
    const s = toSpec(m, A3);
    expect(s.leader).toBeUndefined();
    // Its value sits valueGap above the line, other apps' caption twice the weight: /CO makes up
    // the small difference, square to the line only.
    expect(s.captionOffset![0]).toBeCloseTo(0, 3);
    expect(s.captionOffset![1]).toBeCloseTo(valueGap(m.style.width) - 2 * m.style.width, 2);
    // An upright one's value is on its left: where other apps' top caption is for one drawn up
    // the page, so /CO only makes up the same small difference; drawn down, /CO moves it across.
    const up = toSpec(len([100, 300], [100, 100], 0), A3);
    expect(up.captionOffset![1]).toBeCloseTo(valueGap(m.style.width) - 2 * m.style.width, 2);
    const down = toSpec(len([100, 100], [100, 300], 0), A3);
    expect(Math.abs(down.captionOffset![1])).toBeGreaterThan(5);
    // A short pull, too near for extension lines, has none to draw: /LLE and /LLO 0.
    expect(toSpec(len([100, 100], [300, 100], 1.5), A3).leader).toEqual([1.5, 0, 0]);
  });

  it("brings a file's line dimension back as a Length, pulled out and its value moved as saved", () => {
    const f: Frame = { quarterTurns: 1, bbox: [0, 0, 842, 1191] };
    const m = len([300, 300], [500, 300], 35, { value: [20, 6], ends: "arrow" });
    const s = toSpec(m, f);
    const [x0, y0, x1, y1] = s.rect;
    const got = fromFile(
      {
        page: 0,
        frame: f,
        annots: [
          {
            index: 0, subtype: "Line", nm: null, rect: [x0, y0, x1, y1], flags: 4, colour: [0, 0, 1], interior: null, opacity: null, borderWidth: 0.75, dash: null, cloud: null,
            line: s.line!, lineEnds: s.lineEnds!, vertices: null, ink: null, quadPoints: null, callout: null, inset: null, intent: "LineDimension", contents: "12.40 m",
            author: null, modified: null, created: null, defaultAppearance: null, defaultStyle: null, quadding: null, name: null, rotate: null, vellum: null, measured: true,
            leader: s.leader!, captionOffset: s.captionOffset!,
          },
        ],
      },
      new Set(),
    )[0].markup as MarkupOf<"measureLength">;
    expect(got.kind).toBe("measureLength");
    close(got.from, m.from, 2);
    close(got.to, m.to, 2);
    expect(got.offset).toBeCloseTo(35, 3);
    expect(got.ends).toBe("arrow");
    expect(got.value![0]).toBeCloseTo(20, 1);
    expect(got.value![1]).toBeCloseTo(6, 1);
    // Valued at its page's scale once the app re-values it (undefined until then).
    expect(got.scale).toBeUndefined();
    void toPage;
  });
});

describe("the angle, corner first", () => {
  it("keeps the order saved angles have: one arm's end, the corner, the other's", () => {
    expect(angleVertices([[0, 0]])).toEqual([[0, 0]]);
    expect(angleVertices([[0, 0], [10, 0]])).toEqual([[10, 0], [0, 0]]);
    expect(angleVertices([[0, 0], [10, 0], [0, 10]])).toEqual([[10, 0], [0, 0], [0, 10]]);
    // Saved before (vertex order) reads the same.
    const old = mk("measureAngle", { vertices: [[200, 100], [100, 100], [100, 0]] });
    expect(texts(old)[0].lines).toEqual(["90.0°"]);
  });

  it("says so in its tooltip, with each arm's lock", () => {
    expect(gestureTip(kindOf("measureAngle") as unknown as KindDef)).toBe(
      "click the corner, then each arm's end; the second click stays level or upright, Shift frees it; Shift snaps the third click to 15°",
    );
  });
});

describe("tooltips say each point's lock", () => {
  it("in one phrase when every point is locked alike", () => {
    expect(lockTip(undefined, 2)).toBe("Shift snaps to 15°");
    expect(lockTip("ortho", 2)).toBe("it stays level or upright, Shift frees it");
    expect(lockTip(["ortho"], undefined)).toBe("it stays level or upright, Shift frees it");
  });

  it("per click otherwise, leaving out clicks never locked", () => {
    expect(lockTip(["ortho", "none"], 3)).toBe("the second click stays level or upright, Shift frees it");
    expect(lockTip(["none", "ortho"], undefined)).toBe("the third click and later ones stay level or upright, Shift frees them");
    expect(gestureTip(kindOf("measureLength") as unknown as KindDef)).toBe(
      "click each end, then pull the dimension line out and click: above or below measures across, beside measures up and down, Shift measures straight between the points (click on the points to keep it in line), or drag; Shift snaps the second click to 15°",
    );
    expect(gestureTip(kindOf("measureCalibrate") as unknown as KindDef)).toBe("click each end, or drag; it stays level or upright, Shift frees it");
  });
});
