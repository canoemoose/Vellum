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
      expect(b!.fill, t.id).toBe(d.controls.fill);
      expect(b!.text, t.id).toBe(d.controls.text);
      expect(b!.weight, t.id).toBe(!d.lineless);
      expect(b!.pattern, t.id).toBe(!d.lineless && d.controls.pattern !== false);
      expect(b!.ends !== "none", t.id).toBe(d.controls.ends && !t.preset?.ends);
    }
  });

  it("gives Calibrate no bar, and stamps none yet", () => {
    expect(tool("measureCalibrate")).toBeNull();
    expect(tool("stamp")).toBeNull();
    expect(tool("signature")).toBeNull();
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
    expect(of("note", "rect")).toEqual({ colour: true, weight: false, pattern: false, ends: "none", fill: false, text: false, sides: false } satisfies Bar);
    // An arrow and a polyline: ends, keeping the arrow's rule.
    expect(of("arrow", "polyline")!.ends).toBe("arrow");
    // Anything with a stamp: nothing applies to them all.
    expect(of("rect", "stamp")).toBeNull();
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
