import { describe, expect, it } from "vitest";
import { type LineEnd, type Markup, type Pt, arrowEnds, defaultStyle } from "./types";
import { cloudChord, dotRadius, opsBounds, opsFor, type PathOp } from "./ops";
import { toSpec } from "./spec";
import { sanitisePrefs } from "./prefs";

const meta = { author: "", created: "2026-11-14T12:00:00.000Z", modified: "2026-11-14T12:00:00.000Z" };
const arrow = (ends: [LineEnd, LineEnd], width = 2): Markup => ({
  id: "a", page: 0, kind: "arrow", from: [0, 100], to: [100, 100], style: { ...defaultStyle("arrow"), width, ends }, meta,
});
const A4 = { quarterTurns: 0, bbox: [0, 0, 595, 842] as [number, number, number, number] };

describe("arrow ends", () => {
  it("defaults to an open head and no tail, as arrows always were", () => {
    expect(arrowEnds(defaultStyle("arrow"))).toEqual(["none", "open"]);
    expect(arrowEnds({ ...defaultStyle("rect") })).toEqual(["none", "open"]);
    expect(sanitisePrefs({ styles: { arrow: { ends: ["dot", "wobbly"] } } }).styles.arrow!.ends).toEqual(["none", "open"]);
    expect(sanitisePrefs({ styles: { arrow: { ends: ["dot", "slash"] } } }).styles.arrow!.ends).toEqual(["dot", "slash"]);
  });

  it("fills a filled head and a dot in the line's colour, as one outline with a solid line", () => {
    const m = arrow(["dot", "filled"]);
    const ops = opsFor(m) as PathOp[];
    expect(ops.length).toBe(1);
    expect(ops[0].fill).toEqual(m.style.stroke);
    expect(ops[0].stroke).toBeNull();
  });

  it("with a dashed line, stops the line short of them", () => {
    const base = arrow(["dot", "filled"]);
    const m = { ...base, style: { ...base.style, dash: [4, 2] } } as Markup;
    const ops = opsFor(m) as PathOp[];
    const solids = ops.filter((o) => o.fill && !o.stroke);
    expect(solids.length).toBe(2);
    for (const o of solids) expect(o.fill).toEqual(m.style.stroke);
    // Tail: back to where the line's sides meet the dot.
    const r = dotRadius(2);
    const first = ops[0].segs[0] as ["M", number, number];
    expect(first[1]).toBeCloseTo(Math.sqrt(r * r - 1));
  });

  it("draws bars square across the end and slashes 30 degrees off", () => {
    const ops = opsFor(arrow(["bar", "slash"])) as PathOp[];
    expect(ops.length).toBe(1);
    const segs = ops[0].segs;
    const bar = [segs[2], segs[3]] as [["M", number, number], ["L", number, number]];
    expect(bar[0][1]).toBeCloseTo(0);
    expect(bar[1][1]).toBeCloseTo(0);
    const slash = [segs[4], segs[5]] as [["M", number, number], ["L", number, number]];
    const ang = Math.atan2(slash[1][2] - slash[0][2], slash[1][1] - slash[0][1]);
    expect(Math.abs(Math.abs(ang) - Math.PI / 2)).toBeCloseTo(Math.PI / 6);
  });

  it("names each end in the file as PDF does", () => {
    const s = toSpec(arrow(["dot", "filled"]), A4);
    expect(s.lineEnds).toEqual(["Circle", "ClosedArrow"]);
    expect(s.interior).toEqual(defaultStyle("arrow").stroke);
    const t = toSpec(arrow(["bar", "slash"]), A4);
    expect(t.lineEnds).toEqual(["Butt", "Slash"]);
    expect(t.interior).toBeUndefined();
    expect(toSpec(arrow(["none", "open"]), A4).lineEnds).toEqual(["None", "OpenArrow"]);
  });
});

describe("cloud scallops", () => {
  it("grow with the line weight", () => {
    expect(cloudChord(1, 1.5)).toBeCloseTo(14);
    expect(cloudChord(1, 6)).toBeGreaterThan(2 * cloudChord(1, 1.5) - 3);
    const v: Pt[] = [[0, 0], [200, 0], [200, 200], [0, 200]];
    const cloud = (width: number): Markup => ({ id: "c", page: 0, kind: "cloud", vertices: v, intensity: 1, style: { ...defaultStyle("cloud"), width }, meta });
    const bulge = (m: Markup) => -opsBounds(opsFor(m))[1];
    expect(bulge(cloud(6))).toBeGreaterThan(bulge(cloud(1.5)) + 5);
  });
});

describe("resizing a text box", () => {
  it("stops where the text would no longer fit, instead of springing back", async () => {
    const { dragHandle } = await import("./geometry");
    const { fitText } = await import("../engine/markupTool");
    const box = fitText({ id: "t", page: 0, kind: "text", rect: [100, 100, 220, 140], text: "Check this bolt before the show", textStyle: { size: 10, colour: [0, 0, 0] }, style: defaultStyle("text"), meta } as Markup) as Extract<Markup, { kind: "text" }>;
    const [, y0] = box.rect;
    // Dragging the bottom edge up past the text stops at the text's height: no taller than it
    // needs (fitting it changes nothing) and well short of where the pointer went.
    const up = dragHandle(box, "s", [160, y0 + 5], false) as typeof box;
    expect(up.rect[3] - y0).toBeGreaterThan(20);
    expect(fitText(up).rect).toEqual(up.rect);
    // Dragging the right edge in stops where the wrapped text still fits the height.
    const thin = dragHandle(box, "e", [110, 120], false) as typeof box;
    expect(thin.rect[2]).toBeGreaterThan(150);
    expect(fitText(thin).rect[3]).toBeCloseTo(thin.rect[3]);
    // Growing is free.
    expect((dragHandle(box, "se", [300, 300], false) as typeof box).rect).toEqual([100, y0, 300, 300]);
  });
});

describe("restyling a text box", () => {
  it("keeps a snug box snug and only grows a box made taller by hand", async () => {
    const { fitText, refitText } = await import("../engine/markupTool");
    const make = (rect: [number, number, number, number]) => fitText({ id: "t", page: 0, kind: "text", rect, text: "Check this bolt before the show", textStyle: { size: 10, colour: [0, 0, 0] }, style: defaultStyle("text"), meta } as Markup) as Extract<Markup, { kind: "text" }>;
    const snug = make([100, 100, 220, 100]);
    const h = (m: Extract<Markup, { kind: "text" }>) => m.rect[3] - m.rect[1];
    const bigger = refitText(snug, { ...snug, textStyle: { ...snug.textStyle, size: 14 } });
    expect(h(bigger)).toBeGreaterThan(h(snug));
    const back = refitText(bigger, { ...bigger, textStyle: { ...bigger.textStyle, size: 10 } });
    expect(h(back)).toBeCloseTo(h(snug));
    const heavier = refitText(snug, { ...snug, style: { ...snug.style, width: 4 } });
    expect(h(heavier)).toBeGreaterThan(h(snug));
    // Made tall by hand: smaller text leaves it alone.
    const tall = make([100, 100, 220, 300]);
    expect(h(refitText(tall, { ...tall, textStyle: { ...tall.textStyle, size: 8 } }))).toBe(200);
  });
});
