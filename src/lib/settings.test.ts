import { describe, expect, it } from "vitest";
import { DEFAULTS, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, sanitiseSettings } from "./settings";

describe("sanitiseSettings", () => {
  it("gives the defaults for nothing", () => {
    expect(sanitiseSettings(null)).toEqual(DEFAULTS);
    expect(sanitiseSettings("junk")).toEqual(DEFAULTS);
  });
  it("keeps the phase 0 settings, dropping the old global navigation mode (now per document)", () => {
    const s = sanitiseSettings({ navMode: "document", layoutMode: "single" });
    expect("navMode" in s).toBe(false);
    // The accent was a setting until 12 November 2026; a saved one is dropped.
    expect("accent" in sanitiseSettings({ accent: "#3b82f6" })).toBe(false);
    expect(s.layoutMode).toBe("single");
    expect(s.theme).toBe("dark");
  });
  it("keeps valid values", () => {
    const s = sanitiseSettings({
      theme: "system", sidebarOpen: false, sidebarWidth: 250, sidebarTab: "outline",
      units: "imperial", recent: ["C:\\a.pdf"], scales: { "c:\\a.pdf": 200 },
      docs: { "c:\\a.pdf": { page: 2, zoom: 1.5, x: 10, y: 20, rotation: 0, layout: "single", columns: 2, nav: null, map: "hide", mapSize: 1, t: 1 } },
      window: { x: -8, y: 10, w: 1200, h: 800, maximised: true },
    });
    expect(s.docs["c:\\a.pdf"]).toMatchObject({ page: 2, layout: "single", map: "hide" });
    expect(s).toMatchObject({
      theme: "system", sidebarOpen: false, sidebarWidth: 250, sidebarTab: "outline",
      units: "imperial", recent: ["C:\\a.pdf"], scales: { "c:\\a.pdf": 200 },
      window: { x: -8, y: 10, w: 1200, h: 800, maximised: true },
    });
  });
  // docs/edit-lock-brief.md, 5: the sidebar is wider, for its three word tabs.
  it("pulls a remembered sidebar width below the new minimum up to it", () => {
    expect(SIDEBAR_DEFAULT).toBe(260);
    expect(SIDEBAR_MIN).toBe(220);
    expect(DEFAULTS.sidebarWidth).toBe(SIDEBAR_DEFAULT);
    expect(sanitiseSettings({ sidebarWidth: 196 }).sidebarWidth).toBe(SIDEBAR_MIN);
    expect(sanitiseSettings({ sidebarWidth: 300 }).sidebarWidth).toBe(300);
    expect(sanitiseSettings({}).sidebarWidth).toBe(SIDEBAR_DEFAULT);
  });

  it("rejects bad values field by field", () => {
    const s = sanitiseSettings({
      theme: "purple", sidebarWidth: 5000, recent: ["ok", 3], scales: { a: -1, b: "x", c: 50 },
      window: { x: 1, y: 2, w: 0, h: 5 },
    });
    expect(s.theme).toBe("dark");
    expect(s.sidebarWidth).toBe(SIDEBAR_MAX);
    expect(s.recent).toEqual(["ok"]);
    expect(s.scales).toEqual({ c: 50 });
    expect(s.window).toBeNull();
  });
});
