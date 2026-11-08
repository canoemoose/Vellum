import { describe, expect, it } from "vitest";
import { DEFAULTS, SIDEBAR_MAX, sanitiseSettings } from "./settings";

describe("sanitiseSettings", () => {
  it("gives the defaults for nothing", () => {
    expect(sanitiseSettings(null)).toEqual(DEFAULTS);
    expect(sanitiseSettings("junk")).toEqual(DEFAULTS);
  });
  it("keeps the phase 0 settings", () => {
    const s = sanitiseSettings({ navMode: "document", layoutMode: "single" });
    expect(s.navMode).toBe("document");
    expect(s.layoutMode).toBe("single");
    expect(s.theme).toBe("dark");
  });
  it("keeps valid values", () => {
    const s = sanitiseSettings({
      theme: "system", accent: "#14b8a6", sidebarOpen: false, sidebarWidth: 250, sidebarTab: "outline",
      miniMap: false, units: "imperial", recent: ["C:\\a.pdf"], scales: { "c:\\a.pdf": 200 },
      window: { x: -8, y: 10, w: 1200, h: 800, maximised: true },
    });
    expect(s).toMatchObject({
      theme: "system", accent: "#14b8a6", sidebarOpen: false, sidebarWidth: 250, sidebarTab: "outline",
      miniMap: false, units: "imperial", recent: ["C:\\a.pdf"], scales: { "c:\\a.pdf": 200 },
      window: { x: -8, y: 10, w: 1200, h: 800, maximised: true },
    });
  });
  it("rejects bad values field by field", () => {
    const s = sanitiseSettings({
      theme: "purple", accent: "#123456", sidebarWidth: 5000, recent: ["ok", 3], scales: { a: -1, b: "x", c: 50 },
      window: { x: 1, y: 2, w: 0, h: 5 },
    });
    expect(s.theme).toBe("dark");
    expect(s.accent).toBe(DEFAULTS.accent);
    expect(s.sidebarWidth).toBe(SIDEBAR_MAX);
    expect(s.recent).toEqual(["ok"]);
    expect(s.scales).toEqual({ c: 50 });
    expect(s.window).toBeNull();
  });
});
