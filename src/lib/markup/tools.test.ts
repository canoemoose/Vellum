// The tool registry: every tool's group, letter and kind; stepping through a shared letter; the
// Line preset; which tool a markup belongs to; the flat-or-grouped rule.

import { describe, expect, it } from "vitest";
import { GROUPS, TOOLS, groupFace, keyLabel, letterShortcuts, paletteGroups, paletteLayout, toolById, toolDefaults, toolForKey, toolForMarkup, toolTip } from "./tools";
import { KINDS, kindOf } from "./kinds";
import { type Markup, defaultStyle } from "./types";
import { defaultPrefs, sanitisePrefs, styleFor } from "./prefs";
import { SHORTCUTS } from "../shell/shortcuts";

const meta = { author: "", created: "2026-11-15T10:00:00Z", modified: "2026-11-15T10:00:00Z" };

describe("the tool registry", () => {
  it("gives every tool a unique id, a known group, a letter and an icon", () => {
    const ids = TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TOOLS) {
      expect(GROUPS.map((g) => g.id)).toContain(t.group);
      expect(t.key).toMatch(/^[a-z]?$/);
      expect(t.icon).toContain("<");
      expect(t.label.length).toBeGreaterThan(0);
    }
  });

  it("draws only kinds that exist, and every kind has a tool", () => {
    for (const t of TOOLS) if (t.kind) expect(Object.keys(KINDS)).toContain(t.kind);
    // Text markups are made from a text selection, not with a tool (kind.ts, ofText).
    // Annotations Vellum can only move came with the file, so have no tool either (kind.ts, fixed).
    for (const k of Object.keys(KINDS)) if (!kindOf(k as keyof typeof KINDS).ofText && !kindOf(k as keyof typeof KINDS).fixed) expect(TOOLS.some((t) => t.kind === k), k).toBe(true);
    expect(toolById("select")?.kind).toBeUndefined();
  });

  it("never shares a letter across groups, nor takes the view's own keys", () => {
    const groupOf = new Map<string, string>();
    for (const t of TOOLS.filter((x) => x.key)) {
      expect(groupOf.get(t.key) ?? t.group, t.id).toBe(t.group);
      groupOf.set(t.key, t.group);
    }
    // N switches navigation; [ and ] rotate the view (App.svelte); M is left unused.
    expect(TOOLS.some((t) => ["n", "m", "[", "]"].includes(t.key))).toBe(false);
  });

  it("orders tools by group and shows only groups that have tools", () => {
    const shown = paletteGroups().map((g) => g.group.id);
    expect(shown).toEqual(GROUPS.map((g) => g.id).filter((g) => TOOLS.some((t) => t.group === g)));
    expect(shown[0]).toBe("select");
    const order = TOOLS.map((t) => GROUPS.findIndex((g) => g.id === t.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("the nine plain tools are there, in their groups", () => {
    const want: Record<string, string> = { arrow: "lines", line: "lines", polyline: "lines", rect: "shapes", ellipse: "shapes", polygon: "shapes", cloud: "shapes", text: "text", ink: "pen" };
    for (const [id, g] of Object.entries(want)) expect(toolById(id)?.group).toBe(g);
  });
});

describe("letters (rule 8)", () => {
  it("are the agreed table", () => {
    const table: Record<string, string[]> = {
      v: ["select"], a: ["arrow"], l: ["line", "polyline"], r: ["rect"], e: ["ellipse"], c: ["cloud"], g: ["polygon"],
      t: ["text", "callout", "note"], p: ["ink"], h: ["highlighter"], d: ["measureLength", "measurePath", "measureArea", "measureAngle"],
      s: ["stamp", "signature"], i: ["image"],
    };
    const got: Record<string, string[]> = {};
    for (const t of TOOLS) if (t.key) (got[t.key] ??= []).push(t.id);
    expect(got).toEqual(table);
    // The Image tool sits in the Stamp group, after Signature.
    expect(TOOLS.filter((t) => t.group === "stamp").map((t) => t.id)).toEqual(["stamp", "signature", "image"]);
    // Calibrate has no letter.
    expect(toolById("measureCalibrate")!.key).toBe("");
  });

  it("pick the tool last used of those sharing the letter, else the first", () => {
    expect(toolForKey("v", "rect")).toBe("select");
    expect(toolForKey("R", "select")).toBe("rect");
    expect(toolForKey("l", "select")).toBe("line");
    expect(toolForKey("l", "select", { l: "polyline" })).toBe("polyline");
    expect(toolForKey("d", "arrow", { d: "measureArea" })).toBe("measureArea");
    // A remembered tool that isn't the letter's is ignored.
    expect(toolForKey("l", "select", { l: "arrow" })).toBe("line");
    expect(toolForKey("e", "ellipse")).toBe("ellipse"); // alone on its letter: stays
    expect(toolForKey("m", "select")).toBeNull();
    expect(toolForKey("n", "select")).toBeNull();
  });

  it("pressed again step on, and with Shift step back, round the end", () => {
    expect(toolForKey("l", "line")).toBe("polyline");
    expect(toolForKey("l", "polyline")).toBe("line");
    expect(toolForKey("d", "measureLength", {}, true)).toBe("measureAngle");
    expect(toolForKey("d", "measureAngle")).toBe("measureLength");
    expect(toolForKey("t", "callout", {}, true)).toBe("text");
    // Arrow isn't in the L family.
    expect(toolForKey("l", "arrow")).toBe("line");
  });

  it("read as the letter, the same for every tool sharing it", () => {
    expect(keyLabel(toolById("line")!)).toBe("L");
    expect(keyLabel(toolById("polyline")!)).toBe("L");
    expect(toolTip(toolById("rect")!)).toMatch(/^Rectangle \(R\): /);
    expect(toolTip(toolById("measureCalibrate")!)).toMatch(/^Calibrate: /);
  });

  it("are all in the shortcuts dialog, from the one table", () => {
    const markup = SHORTCUTS.find((g) => g.title === "Markup")!;
    for (const t of TOOLS.filter((x) => x.key)) {
      const row = markup.items.find((i) => i.keys === keyLabel(t));
      expect(row?.action, t.id).toContain(t.id === "select" ? "Select" : t.label);
    }
    expect(letterShortcuts().length).toBe(new Set(TOOLS.map((t) => t.key).filter(Boolean)).size);
    // The view's rotation moved to [ and ].
    const view = SHORTCUTS.find((g) => g.title === "View")!;
    expect(view.items.some((i) => i.keys === "] / [")).toBe(true);
  });
});

describe("presets and styles", () => {
  it("Line is the arrow kind with no ends, always", () => {
    const line = toolById("line")!;
    expect(line.kind).toBe("arrow");
    expect(toolDefaults(line).ends).toEqual(["none", "none"]);
    // A remembered style with ends can't turn the Line tool into an arrow.
    const p = sanitisePrefs({ styles: { line: { ...defaultStyle("arrow"), ends: ["open", "filled"], stroke: [0, 0, 1] } } });
    expect(styleFor(p, "line").ends).toEqual(["none", "none"]);
    expect(styleFor(p, "line").stroke).toEqual([0, 0, 1]);
    expect(styleFor(defaultPrefs(), "arrow").ends).toEqual(["none", "open"]);
  });

  it("finds the tool a markup belongs to", () => {
    const arrow = (ends: [string, string]) => ({ id: "a", page: 0, kind: "arrow", from: [0, 0], to: [10, 0], style: { ...defaultStyle("arrow"), ends }, meta }) as Markup;
    expect(toolForMarkup(arrow(["none", "none"]))?.id).toBe("line");
    expect(toolForMarkup(arrow(["none", "open"]))?.id).toBe("arrow");
    expect(toolForMarkup({ id: "r", page: 0, kind: "rect", rect: [0, 0, 1, 1], style: defaultStyle("rect"), meta } as Markup)?.id).toBe("rect");
  });

  it("remembers each letter's last tool, only if it has that letter", () => {
    const p = sanitisePrefs({ lastForKey: { l: "polyline", d: "arrow", z: "rect" } });
    expect(p.lastForKey).toEqual({ l: "polyline" });
    expect(defaultPrefs().lastForKey).toEqual({});
  });

  it("remembers each group's last tool, only if it's in that group", () => {
    const p = sanitisePrefs({ lastInGroup: { lines: "polyline", shapes: "arrow", pen: "nonsense" } });
    expect(p.lastInGroup).toEqual({ lines: "polyline" });
    expect(groupFace("lines", p.lastInGroup).id).toBe("polyline");
    expect(groupFace("shapes", p.lastInGroup).id).toBe("rect");
  });
});

describe("flat or grouped", () => {
  it("is flat only when the whole row fits", () => {
    expect(paletteLayout(400, 400)).toBe("flat");
    expect(paletteLayout(400, 600)).toBe("flat");
    expect(paletteLayout(400, 399)).toBe("grouped");
    // Not measured yet: grouped, the smaller, so nothing overflows on the first frame.
    expect(paletteLayout(0, 600)).toBe("grouped");
  });
});
