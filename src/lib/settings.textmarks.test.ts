// Phase 7a's settings: the Markups tab is a sidebar tab that's remembered, and each text markup
// variant's remembered colour and opacity are checked when read back.

import { describe, expect, it } from "vitest";
import { sanitiseSettings } from "./settings";

describe("settings for text markups", () => {
  it("remember the Markups tab", () => {
    expect(sanitiseSettings({ sidebarTab: "markups" }).sidebarTab).toBe("markups");
    expect(sanitiseSettings({ sidebarTab: "nonsense" }).sidebarTab).toBe("pages");
  });

  it("keep each variant's colour and opacity, dropping anything odd", () => {
    const s = sanitiseSettings({
      textMarks: {
        highlight: { stroke: [0.1, 0.9, 0.2], opacity: 0.5 },
        underline: { stroke: [2, 0, 0], opacity: 1 },
        strike: { stroke: [0, 0, 0], opacity: 0 },
        bogus: { stroke: [0, 0, 0], opacity: 1 },
      },
    });
    expect(s.textMarks.highlight?.stroke).toEqual([0.1, 0.9, 0.2]);
    expect(s.textMarks.highlight?.opacity).toBe(0.5);
    expect(s.textMarks.underline).toBeUndefined();
    expect(s.textMarks.strike).toBeUndefined();
    expect(Object.keys(s.textMarks)).toEqual(["highlight"]);
    expect(sanitiseSettings({}).textMarks).toEqual({});
  });
});
