import fetchScript from "../../../tools/fetch-pdfium.mjs?raw";
import { describe, expect, it } from "vitest";
import { filterShortcuts, navHint, PDFIUM_BUILD, SHORTCUTS } from "./shortcuts";

describe("filterShortcuts", () => {
  it("returns everything for an empty query", () => {
    expect(filterShortcuts(SHORTCUTS, "  ")).toBe(SHORTCUTS);
  });
  it("matches keys and actions, every word", () => {
    const r = filterShortcuts(SHORTCUTS, "fit page");
    const all = r.flatMap((g) => g.items.map((i) => i.keys));
    expect(all).toContain("Ctrl+0");
    expect(all).toContain("Double middle-click");
    expect(all).not.toContain("Ctrl+1");
  });
  it("matches by group and mode, and drops empty groups", () => {
    expect(filterShortcuts(SHORTCUTS, "document wheel").flatMap((g) => g.items.map((i) => i.action))).toContain("Scroll");
    expect(filterShortcuts(SHORTCUTS, "zzz")).toEqual([]);
  });
});

describe("navHint", () => {
  it("uses the shortcuts dialog's words: the wheel zooms in CAD (a touchpad scroll pans)", () => {
    expect(navHint("cad")).toBe("Middle-drag pan · Wheel zoom at cursor · Space+drag pan · Double middle-click fit");
    expect(navHint("document")).toContain("Ctrl+wheel zoom");
  });
  it("writes key combinations with + throughout", () => {
    const all = [navHint("cad"), navHint("document"), ...SHORTCUTS.flatMap((g) => g.items.map((i) => i.keys))].join(" ");
    expect(all).not.toMatch(/ \+ wheel|Space-drag|Shift-click|Ctrl\+scroll/);
  });
});

describe("new keyboard routes", () => {
  it("lists Fit width, the layouts and the navigation switch", () => {
    const keys = SHORTCUTS.flatMap((g) => g.items.map((i) => i.keys));
    expect(keys).toContain("Ctrl+2");
    expect(keys).toContain("Ctrl+Shift+1 / 2 / 3");
    expect(keys).toContain("N");
  });
});

describe("PDFIUM_BUILD", () => {
  it("matches the version tools/fetch-pdfium.mjs downloads", () => {
    const m = /const VERSION = "([^"]+)"/.exec(fetchScript);
    expect(m?.[1]).toBe(PDFIUM_BUILD);
  });
});
