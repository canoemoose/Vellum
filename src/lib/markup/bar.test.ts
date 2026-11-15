// Rules 6 and 7 (docs/editing-tool-consistency-brief.md): the context bar shows only the
// controls that do something, for every tool and every selection; each tool remembers its own
// settings, the text box and the callout apart.

import { describe, expect, it } from "vitest";
import { type Bar, barFor, endChoices, subjectOf, subjectOfTool } from "./bar";
import { TOOLS, toolById } from "./tools";
import { KINDS, kindOf } from "./kinds";
import { type Markup, type MarkupKind, defaultStyle } from "./types";
import { defaultPrefs, sanitisePrefs, textFor } from "./prefs";
import { reformat } from "./measurements";
import { DEFAULT_FORMAT } from "./measure";

const meta = { author: "", created: "2026-11-15T10:00:00Z", modified: "2026-11-15T10:00:00Z" };
const tool = (id: string) => barFor([subjectOfTool(toolById(id)!)]);

describe("rule 6: only controls that do something", () => {
  it("every tool's bar follows its kind's declared controls", () => {
    for (const t of TOOLS.filter((x) => x.kind)) {
      const d = kindOf(t.kind!);
      const b = tool(t.id);
      if (d.noBar) {
        expect(b, t.id).toBeNull();
        continue;
      }
      // Stage 8: a kind with its own bar has no line controls (below).
      if (d.ownBar) {
        expect(b, t.id).toMatchObject({ weight: false, pattern: false, ends: "none", fill: false, text: false, opacity: true });
        continue;
      }
      expect(b!.fill, t.id).toBe(d.controls.fill);
      expect(b!.text, t.id).toBe(d.controls.text);
      expect(b!.weight, t.id).toBe(!d.lineless);
      expect(b!.pattern, t.id).toBe(!d.lineless && d.controls.pattern !== false);
      expect(b!.ends !== "none", t.id).toBe(d.controls.ends && !t.preset?.ends);
    }
  });

  it("gives Calibrate no bar", () => {
    expect(tool("measureCalibrate")).toBeNull();
  });

  // Stage 8: a stamp's own bar, by what it holds (rule 6: only controls that do something).
  it("gives a text stamp its picker, colour, date line and opacity; a signature or a picture its picker and opacity", () => {
    const st = (id: string, variant: string) => barFor([subjectOfTool(toolById(id)!, variant)]);
    expect(st("stamp", "text")).toEqual({ colour: true, weight: false, pattern: false, ends: "none", fill: false, text: false, sides: false, opacity: true, dateLine: true, picker: "text" } satisfies Bar);
    // The Stamp tool with one of your image stamps armed: no colour or date line.
    expect(st("stamp", "image")).toMatchObject({ colour: false, dateLine: false, opacity: true, picker: "image" });
    expect(st("signature", "signature")).toMatchObject({ colour: false, dateLine: false, opacity: true, picker: "signature" });
    expect(st("image", "image")).toMatchObject({ colour: false, dateLine: false, opacity: true, picker: "image" });
    // Selected: the same bar, from what each one holds.
    const stamp = (content: object, signature = false) => ({ id: "s", page: 0, kind: "stamp", rect: [0, 0, 10, 10], content, signature, style: defaultStyle("stamp"), meta }) as unknown as Markup;
    const text = stamp({ type: "text", label: "APPROVED", sub: null, colour: [0, 1, 0] });
    const sig = stamp({ type: "image", png: "", hash: "h", w: 1, h: 1 }, true);
    const pic = stamp({ type: "image", png: "", hash: "h", w: 1, h: 1 });
    expect(barFor([subjectOf(text)])).toMatchObject({ colour: true, dateLine: true, opacity: true, picker: "text" });
    expect(barFor([subjectOf(sig)])).toMatchObject({ colour: false, dateLine: false, opacity: true, picker: "signature" });
    expect(barFor([subjectOf(pic)])).toMatchObject({ colour: false, opacity: true, picker: "image" });
    // Several: what they all have, and no picker (it's for one).
    expect(barFor([subjectOf(text), subjectOf(text)])).toMatchObject({ colour: true, dateLine: true, picker: null });
    expect(barFor([subjectOf(text), subjectOf(sig)])).toMatchObject({ colour: false, dateLine: false, opacity: true, picker: null });
    // A stamp and a rectangle: colour and opacity apply to both; nothing else.
    const rect = { id: "r", page: 0, kind: "rect", rect: [0, 0, 1, 1], style: defaultStyle("rect"), meta } as Markup;
    expect(barFor([subjectOf(text), subjectOf(rect)])).toEqual({ colour: true, weight: false, pattern: false, ends: "none", fill: false, text: false, sides: false, opacity: true, dateLine: false, picker: null } satisfies Bar);
    expect(barFor([subjectOf(sig), subjectOf(rect)])).toMatchObject({ colour: false, weight: false, opacity: true });
  });

  it("gives the highlighter no line pattern", () => {
    expect(tool("highlighter")).toMatchObject({ weight: true, pattern: false });
    expect(tool("ink")).toMatchObject({ weight: true, pattern: true });
  });

  it("gives a line no ends, as a tool or selected; an arrow can't lose both ends", () => {
    expect(tool("line")!.ends).toBe("none");
    expect(tool("arrow")!.ends).toBe("arrow");
    expect(tool("polyline")!.ends).toBe("all");
    const line = { id: "l", page: 0, kind: "arrow", from: [0, 0], to: [1, 1], style: { ...defaultStyle("arrow"), ends: ["none", "none"] }, meta } as Markup;
    expect(barFor([subjectOf(line)])!.ends).toBe("none");
    const keys = ["none", "open", "filled"];
    expect(endChoices(keys, "arrow", "none")).toEqual(["open", "filled"]);
    expect(endChoices(keys, "arrow", "open")).toEqual(keys);
    expect(endChoices(keys, "all", "none")).toEqual(keys);
  });

  it("shows only the controls several kinds all have", () => {
    const of = (...ks: MarkupKind[]) => barFor(ks.map((kind) => ({ kind })));
    // A rectangle and a polyline: no fill (the polyline has none), no ends (the rectangle).
    expect(of("rect", "polyline")).toMatchObject({ fill: false, ends: "none", weight: true });
    // A text box and a rectangle: fill, but no text.
    expect(of("text", "rect")).toMatchObject({ fill: true, text: false });
    // A note and a rectangle: colour only.
    expect(of("note", "rect")).toEqual({ colour: true, weight: false, pattern: false, ends: "none", fill: false, text: false, sides: false, opacity: true, dateLine: false, picker: null } satisfies Bar);
    // An arrow and a polyline: ends, keeping the arrow's rule.
    expect(of("arrow", "polyline")!.ends).toBe("arrow");
    // A rectangle and a stamp (stage 8): only opacity applies to both (whether a stamp has a colour depends on what it holds).
    expect(of("rect", "stamp")).toMatchObject({ colour: false, weight: false, opacity: true });
    expect(barFor([])).toBeNull();
  });

  it("covers every kind", () => {
    for (const k of Object.keys(KINDS) as MarkupKind[]) {
      const d = kindOf(k);
      expect(barFor([{ kind: k }]) === null, k).toBe(!!d.fixed || !!d.noBar);
    }
  });
});

describe("rule 7: each tool remembers its own", () => {
  it("splits the shared text style into the text box's and the callout's, carrying it over", () => {
    const p = sanitisePrefs({ text: { size: 14, colour: [0, 0, 1] } });
    expect(textFor(p, "text").size).toBe(14);
    expect(textFor(p, "callout").size).toBe(14);
    const q = sanitisePrefs({ texts: { text: { size: 9, colour: [0, 0, 0] }, callout: { size: 18, colour: [0, 0, 0] } } });
    expect(textFor(q, "text").size).toBe(9);
    expect(textFor(q, "callout").size).toBe(18);
    expect(textFor(defaultPrefs(), "callout").size).toBeGreaterThan(0);
    // Only tools that type keep a text style.
    expect(sanitisePrefs({ texts: { rect: { size: 9, colour: [0, 0, 0] } } }).texts.rect).toBeUndefined();
  });

  it("changes the units and decimals of the selected measurements only", () => {
    const m = (id: string): Markup =>
      ({ id, page: 0, kind: "measureLength", from: [0, 0], to: [72, 0], style: defaultStyle("measureLength"), meta, scale: 100, userUnit: 1, fmt: { ...DEFAULT_FORMAT }, labelSize: 8 }) as unknown as Markup;
    const ms = [m("a"), m("b")];
    const r = reformat(ms, { ...DEFAULT_FORMAT, decimals: 3 }, new Set(["a"]));
    expect(r.changed).toBe(1);
    expect((r.markups[0] as unknown as { fmt: { decimals: number } }).fmt.decimals).toBe(3);
    expect(r.markups[1]).toBe(ms[1]);
    // "Apply to all measurements": no ids.
    expect(reformat(ms, { ...DEFAULT_FORMAT, decimals: 3 }).changed).toBe(2);
  });
});
