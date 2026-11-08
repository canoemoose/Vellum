import { describe, expect, it } from "vitest";
import { accentVars, darken, resolveTheme } from "./theme";

describe("theme", () => {
  it("resolves System from the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("darkens towards black", () => {
    expect(darken("#ffffff", 0.5)).toBe("#808080");
    expect(darken("#e5484d", 0)).toBe("#e5484d");
    expect(darken("#e5484d", 1)).toBe("#000000");
    expect(darken("nonsense", 0.5)).toBe("nonsense");
  });
  it("derives the accent tokens", () => {
    expect(accentVars("#3b82f6")).toEqual({ "--accent": "#3b82f6", "--accent-soft": "#3b82f62e", "--accent-bd": darken("#3b82f6", 0.25) });
  });
});
