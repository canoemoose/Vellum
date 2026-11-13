import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";

describe("theme", () => {
  it("resolves System from the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
