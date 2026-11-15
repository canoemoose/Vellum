import { describe, expect, it } from "vitest";
import { type Markup, type Pt, defaultStyle, DEFAULT_TEXT, newId } from "./types";
import { pdfString, textWidth, wrap } from "./fonts";
import { opsBounds, opsFor, signedArea, textLines, type PathOp, type TextOp } from "./ops";
import { type Frame, toContent, toPage, toUser, n } from "./pdf";
import { pdfDate, toSpec } from "./spec";
import { dragHandle, handleAt, handleCursor, handles, hits, insideMarquee, moveBy, shapeBounds, simplify, snapAngle } from "./geometry";
import { History, changesFor, isDirty } from "./history";

const meta = { author: "Matt James", created: "2026-11-14T12:00:00.000Z", modified: "2026-11-14T12:30:00.000Z" };
const rect = (r: [number, number, number, number] = [100, 100, 200, 150]): Markup => ({ id: "r1", page: 0, kind: "rect", rect: r, style: defaultStyle("rect"), meta });
const arrow = (): Markup => ({ id: "a1", page: 0, kind: "arrow", from: [100, 100], to: [200, 100], style: defaultStyle("arrow"), meta });
const cloud = (v: Pt[] = [[100, 100], [200, 100], [200, 200], [100, 200]]): Markup => ({ id: "c1", page: 0, kind: "cloud", vertices: v, intensity: 1, style: defaultStyle("cloud"), meta });
const text = (t = "Check this bolt"): Markup => ({ id: "t1", page: 0, kind: "text", rect: [100, 100, 220, 140], text: t, textStyle: DEFAULT_TEXT, style: defaultStyle("text"), meta });
const ink = (): Markup => ({ id: "i1", page: 0, kind: "ink", strokes: [[[0, 0], [10, 5], [20, 0]]], style: defaultStyle("ink"), meta });

type Pt3 = [number, number, number];

const A4: Frame = { quarterTurns: 0, bbox: [0, 0, 595, 842] };

describe("Helvetica", () => {
  it("measures with the AFM widths and wraps on words", () => {
    expect(textWidth("Hello", 1000)).toBe(2278);
    const lines = wrap("Check this bolt before the show", 80, 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => textWidth(l, 10) <= 80)).toBe(true);
    expect(lines.join(" ")).toBe("Check this bolt before the show");
    expect(wrap("a\nb", 100, 10)).toEqual(["a", "b"]);
  });

  it("escapes and encodes for a PDF string", () => {
    expect(pdfString("a(b)\\")).toBe("a\\(b\\)\\\\");
    expect(pdfString("±5 mm")).toBe("\\2615 mm");
    expect(pdfString("Ω")).toBe("?");
  });
});

describe("drawing operations", () => {
  it("draws a cloud's scallops outwards whichever way round it runs", () => {
    for (const v of [
      [[0, 0], [100, 0], [100, 100], [0, 100]] as Pt[],
      [[0, 0], [0, 100], [100, 100], [100, 0]] as Pt[],
    ]) {
      expect(Math.sign(signedArea(v))).not.toBe(0);
      const b = opsBounds(opsFor(cloud(v)));
      expect(b[0]).toBeLessThan(-5);
      expect(b[1]).toBeLessThan(-5);
      expect(b[2]).toBeGreaterThan(105);
      expect(b[3]).toBeGreaterThan(105);
    }
  });

  it("fills only inside the line's inner edge", () => {
    const style = { ...defaultStyle("rect"), width: 4, fill: [1, 1, 0] as Pt3 };
    const [fill, line] = opsFor({ ...rect(), style }) as PathOp[];
    expect(fill.fill).toEqual([1, 1, 0]);
    expect(fill.stroke).toBeNull();
    expect(line.fill).toBeNull();
    expect(line.stroke).not.toBeNull();
    // The rectangle is 100..200 x 100..150; the line's inner edge is 2 in.
    expect(fill.segs[0]).toEqual(["M", 102, 102]);
    expect(fill.segs[2]).toEqual(["L", 198, 148]);
    // A text box's border sits inside the box, so its fill starts a whole weight in.
    const t = opsFor({ ...text(), style: { ...defaultStyle("text"), width: 3 } }) as PathOp[];
    expect(t[0].segs[0]).toEqual(["M", 103, 103]);
    expect(t[1].segs[0]).toEqual(["M", 101.5, 101.5]);
    // No line: one filled path to the edge.
    const bare = opsFor({ ...rect(), style: { ...style, width: 0 } }) as PathOp[];
    expect(bare.length).toBe(1);
    expect(bare[0].segs[0]).toEqual(["M", 100, 100]);
  });

  it("insets a filled cloud's fill by half the line weight", () => {
    const style = { ...defaultStyle("cloud"), width: 4, fill: [1, 1, 0] as Pt3 };
    const [fill, line] = opsFor({ ...cloud(), style }) as PathOp[];
    const ob = opsBounds([{ ...line, width: 0 }]);
    const fb = opsBounds([{ ...fill, width: 0 }]);
    // Bounds are grown by a point and snapped outwards; the inset is 2 on each side.
    expect(fb[0] - ob[0]).toBeGreaterThanOrEqual(1);
    expect(ob[2] - fb[2]).toBeGreaterThanOrEqual(1);
    // Sampled along both paths, every point of the fill's edge is half the weight (2) from the
    // line's centre: it meets the line's inner edge, neither under it nor short of it.
    const sample = (segs: PathOp["segs"]): Pt[] => {
      const out: Pt[] = [];
      let at: Pt = [0, 0];
      for (const s of segs) {
        if (s[0] === "M" || s[0] === "L") at = [s[1], s[2]];
        else if (s[0] === "C") {
          for (let i = 1; i <= 16; i++) {
            const t = i / 16, u = 1 - t;
            out.push([
              u * u * u * at[0] + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5],
              u * u * u * at[1] + 3 * u * u * t * s[2] + 3 * u * t * t * s[4] + t * t * t * s[6],
            ]);
          }
          at = [s[5], s[6]];
          continue;
        } else continue;
        out.push(at);
      }
      return out;
    };
    const centre = sample(line.segs);
    for (const p of sample(fill.segs)) {
      const d = Math.min(...centre.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
      expect(d).toBeGreaterThan(1.9);
      expect(d).toBeLessThan(2.3);
    }
    expect(fill.segs.at(-1)).toEqual(["Z"]);
  });

  it("puts an open arrowhead at the head", () => {
    const op = opsFor(arrow())[0] as PathOp;
    expect(op.fill).toBeNull();
    // Shaft, then the two wings meeting at the head.
    expect(op.segs.filter((s) => s[0] === "M").length).toBe(2);
    expect(op.segs.some((s) => s[0] === "L" && s[1] === 200 && s[2] === 100)).toBe(true);
    const b = opsBounds([op]);
    expect(b[1]).toBeLessThan(97); // wings above and below the line
    expect(b[3]).toBeGreaterThan(103);
  });

  it("wraps a text box's text inside its padding and clips to it", () => {
    const ops = opsFor(text("Check this bolt before the show tonight"));
    const t = ops.find((o) => o.t === "text") as TextOp;
    expect(t.lines.length).toBeGreaterThan(1);
    expect(t.lines.every((l) => textWidth(l, 10) <= 120 - 2 * 5)).toBe(true);
    expect(t.clip).toEqual([[100, 100], [220, 100], [220, 140], [100, 140]]);
    expect(textLines("x", [0, 0, 5, 5], DEFAULT_TEXT, 1)).toEqual(["x"]); // never narrower than one size
  });
});

describe("page frame", () => {
  const frames: Frame[] = [0, 1, 2, 3].map((q) => ({ quarterTurns: q, bbox: [20, 10, 320, 210] }));

  it("round-trips page points through user space for every rotation", () => {
    for (const f of frames)
      for (const p of [[0, 0], [12.5, 40], [199, 3]] as Pt[]) {
        const [x, y] = toPage(f, ...toUser(f, p[0], p[1]));
        expect(x).toBeCloseTo(p[0]);
        expect(y).toBeCloseTo(p[1]);
      }
  });

  it("matches the backend's frame (tests/text.rs)", () => {
    // Unrotated: the page's top-left is the box's top-left.
    expect(toUser(frames[0], 0, 0)).toEqual([20, 210]);
    // A quarter turn: the box's bottom-left comes to the page's top-left.
    expect(toUser(frames[1], 0, 0)).toEqual([20, 10]);
    expect(toPage(frames[2], 20, 10)).toEqual([300, 0]);
    expect(toPage(frames[3], 20, 10)).toEqual([200, 300]);
  });

  it("keeps text upright on screen on a rotated page", () => {
    // On a page shown a quarter turn clockwise, reading left to right on screen runs up the
    // page's user space (+y), and "up" on screen is user -x.
    const c = toContent(frames[1], opsFor(text("Hi")));
    expect(c.fonts).toEqual({ Helv: "Helvetica" });
    expect(c.ops).toMatch(/\n0 1 -1 0 [\d.]+ [\d.]+ Tm\n\(Hi\) Tj/);
    const plain = toContent(A4, opsFor(text("Hi")));
    expect(plain.ops).toMatch(/\n1 0 0 1 [\d.]+ [\d.]+ Tm\n\(Hi\) Tj/);
  });

  it("writes paths in user space with their style", () => {
    const c = toContent(A4, opsFor(rect()));
    expect(c.ops).toContain("0.85 0.1 0.1 RG");
    expect(c.ops).toContain("1.5 w");
    expect(c.ops).toContain("100 742 m");
    expect(c.ops).toContain("200 692 l");
    expect(c.ops.trim().endsWith("S\nQ")).toBe(true);
    expect(c.opacity).toBeNull();
    const faint = toContent(A4, opsFor({ ...rect(), style: { ...defaultStyle("rect"), fill: [1, 1, 0], opacity: 0.5, fillOpacity: 0.25 } }));
    expect(faint.opacity).toBe(0.5);
    expect(faint.fillOpacity).toBe(0.25);
    expect(faint.ops).toContain("/GS0 gs");
    // The fill, then the line, as separate paths.
    expect(faint.ops).toMatch(/f\nQ\nq\n[^]*S\nQ$/);
    // A see-through fill under a solid line still names the line's opacity (1) for /GS0.
    const tint = toContent(A4, opsFor({ ...rect(), style: { ...defaultStyle("rect"), fill: [1, 1, 0], fillOpacity: 0.3 } }));
    expect([tint.opacity, tint.fillOpacity]).toEqual([1, 0.3]);
    expect(n(-0.0001)).toBe("0");
  });
});

describe("annotation specs", () => {
  it("describes each kind as the standard annotation", () => {
    const r = toSpec(rect(), A4);
    expect(r.subtype).toBe("Square");
    expect(r.rect[0]).toBeLessThanOrEqual(99.25);
    expect(r.rect[3]).toBeGreaterThanOrEqual(742.75);
    expect(r.appearance.bbox).toEqual(r.rect);
    expect(r.inset!.every((v) => v >= 0 && v < 2)).toBe(true);
    expect(r.flags).toBe(4);
    expect(r.author).toBe("Matt James");
    expect(r.created).toBe("D:20261114120000Z");
    const a = toSpec(arrow(), A4);
    expect(a.subtype).toBe("Line");
    expect(a.line).toEqual([100, 742, 200, 742]);
    expect(a.lineEnds).toEqual(["None", "OpenArrow"]);
    const c = toSpec(cloud(), A4);
    expect(c.subtype).toBe("Polygon");
    expect(c.cloud).toBe(1);
    expect(c.intent).toBe("PolygonCloud");
    expect(c.vertices!.slice(0, 4)).toEqual([100, 742, 200, 742]);
    const t = toSpec(text(), { quarterTurns: 1, bbox: [0, 0, 595, 842] });
    expect(t.subtype).toBe("FreeText");
    expect(t.contents).toBe("Check this bolt");
    expect(t.defaultAppearance).toBe("0 0 0 rg /Helv 10 Tf");
    expect(t.colour).toEqual([1, 1, 1]); // the background, for FreeText
    expect(t.rotate).toBe(90);
    const i = toSpec(ink(), A4);
    expect(i.subtype).toBe("Ink");
    expect(i.ink).toEqual([[0, 842, 10, 837, 20, 842]]);
  });

  it("formats PDF dates in UTC", () => {
    expect(pdfDate("2026-11-14T13:05:09.000+01:00")).toBe("D:20261114120509Z");
  });
});

describe("geometry", () => {
  it("picks markups on their lines, and filled ones inside", () => {
    expect(hits(rect(), [100.5, 120], 1)).toBe(true);
    expect(hits(rect(), [150, 120], 1)).toBe(false);
    expect(hits({ ...rect(), style: { ...defaultStyle("rect"), fill: [1, 1, 0] } } as Markup, [150, 120], 1)).toBe(true);
    expect(hits(text(), [150, 120], 0)).toBe(true);
    expect(hits(arrow(), [150, 101], 1)).toBe(true);
    expect(hits(arrow(), [150, 110], 1)).toBe(false);
    expect(hits(cloud(), [100, 150], 1)).toBe(true);
    expect(hits(ink(), [10, 5], 1)).toBe(true);
    expect(insideMarquee(rect(), [90, 90, 210, 160])).toBe(true);
    expect(insideMarquee(rect(), [90, 90, 150, 160])).toBe(false);
  });

  it("offers handles and resizes boxes from them, flipping rather than turning inside out", () => {
    expect(handles(rect()).length).toBe(8);
    expect(handles(arrow()).map((h) => h.id)).toEqual(["from", "to"]);
    expect(handles(cloud()).length).toBe(4);
    expect(handles(ink()).length).toBe(4);
    expect(handleAt(rect(), [201, 151], 3)).toBe("se");
    const bigger = dragHandle(rect(), "se", [260, 190], false) as Extract<Markup, { kind: "rect" }>;
    expect(bigger.rect).toEqual([100, 100, 260, 190]);
    const flipped = dragHandle(rect(), "e", [50, 120], false) as Extract<Markup, { kind: "rect" }>;
    expect(flipped.rect).toEqual([50, 100, 100, 150]);
    // Shift keeps the 2:1 proportions.
    const prop = dragHandle(rect(), "se", [300, 160], true) as Extract<Markup, { kind: "rect" }>;
    expect((prop.rect[2] - prop.rect[0]) / (prop.rect[3] - prop.rect[1])).toBeCloseTo(2);
  });

  it("gives handles arrow cursors along their direction on screen, never a hand", () => {
    expect(handleCursor("n", 0)).toBe("ns-resize");
    expect(handleCursor("e", 0)).toBe("ew-resize");
    expect(handleCursor("nw", 0)).toBe("nwse-resize");
    expect(handleCursor("ne", 0)).toBe("nesw-resize");
    // A quarter turn swaps them.
    expect(handleCursor("n", 90)).toBe("ew-resize");
    expect(handleCursor("nw", 270)).toBe("nesw-resize");
    expect(handleCursor("se", 180)).toBe("nwse-resize");
    expect(handleCursor("to", 0)).toBe("move");
    expect(handleCursor("v3", 90)).toBe("move");
  });

  it("moves, snaps lines to 15 degrees and scales ink", () => {
    expect(shapeBounds(moveBy(rect(), 5, -5))).toEqual([105, 95, 205, 145]);
    const s = snapAngle([0, 0], [10, 1]);
    expect(s[1]).toBeCloseTo(0);
    const tilted = dragHandle(arrow(), "to", [200, 130], true) as Extract<Markup, { kind: "arrow" }>;
    expect(Math.atan2(tilted.to[1] - 100, tilted.to[0] - 100) * (180 / Math.PI)).toBeCloseTo(15);
    const big = dragHandle(ink(), "se", [40, 10], false);
    expect(shapeBounds(big)).toEqual([0, 0, 40, 10]);
  });

  it("simplifies a freehand stroke, keeping its shape", () => {
    const pts: Pt[] = Array.from({ length: 50 }, (_, i) => [i, i < 25 ? 0.01 * (i % 2) : i - 25]);
    const out = simplify(pts, 0.5);
    expect(out.length).toBeLessThan(6);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[49]);
  });
});

describe("history and changes", () => {
  it("undoes and redoes, and a new edit clears the redo", () => {
    const h = new History([]);
    h.push([rect()]);
    h.push([rect(), arrow()]);
    expect(h.undo()).toBe(true);
    expect(h.present.length).toBe(1);
    expect(h.redo()).toBe(true);
    expect(h.present.length).toBe(2);
    h.undo();
    h.push([]);
    expect(h.canRedo).toBe(false);
    expect(h.undo() && h.undo() && h.present.length === 0).toBe(true);
    expect(h.undo()).toBe(false);
  });

  it("works out adds, replaces and deletes against what's saved", () => {
    const saved = [rect(), arrow()];
    const now = [moveBy(rect(), 10, 0), cloud()];
    const ch = changesFor(saved, now, (m) => toSpec(m, A4));
    expect(ch.map((c) => c.op + ":" + (c.op === "delete" ? c.nm : c.spec.nm))).toEqual(["replace:r1", "add:c1", "delete:a1"]);
    expect(isDirty(saved, saved)).toBe(false);
    expect(isDirty(saved, [rect(), arrow()])).toBe(false); // equal values
    expect(isDirty(saved, now)).toBe(true);
  });

  it("makes unique ids", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId(0)));
    expect(ids.size).toBe(1000);
  });
});
