import { describe, expect, it } from "vitest";
import { DASHES, dashOption, sameDash } from "./dash";
import { sanitisePrefs } from "./prefs";

describe("line patterns", () => {
  it("matches a style's dash to its pattern", () => {
    expect(dashOption(null)?.name).toBe("Solid");
    expect(dashOption([]))?.toEqual(DASHES[0]);
    expect(dashOption([4, 3])?.name).toBe("Dashed");
    expect(dashOption([5, 5])).toBeNull();
    expect(sameDash([1, 2], [1, 2, 3])).toBe(false);
  });

  it("offers only patterns the saved settings keep", () => {
    for (const o of DASHES) {
      const p = sanitisePrefs({ styles: { rect: { dash: o.dash } } });
      expect(sameDash(p.styles.rect!.dash, o.dash)).toBe(true);
    }
  });
});
