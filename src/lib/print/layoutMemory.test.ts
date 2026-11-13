import { describe, expect, it } from "vitest";
import { forgetLayout, rememberLayout, sanitiseLayouts } from "./layoutMemory";

const entry = (t: number) => ({ text: `{"t":${t}}`, margin: "printer", t });

describe("remembered manual layouts", () => {
  it("keeps one layout per file, the newest replacing the old", () => {
    let all = rememberLayout({}, "c:/a.pdf", entry(1));
    all = rememberLayout(all, "c:/a.pdf", entry(2));
    expect(all).toEqual({ "c:/a.pdf": entry(2) });
  });

  it("drops the least recently used past the cap", () => {
    let all = {};
    for (let i = 1; i <= 4; i++) all = rememberLayout(all, `f${i}`, entry(i), 3);
    expect(Object.keys(all).sort()).toEqual(["f2", "f3", "f4"]);
  });

  it("forgets a file's layout", () => {
    const all = rememberLayout({}, "a", entry(1));
    expect(forgetLayout(all, "a")).toEqual({});
    expect(forgetLayout(all, "b")).toBe(all);
  });

  it("reads back only usable entries", () => {
    expect(sanitiseLayouts({ a: { text: "x", margin: "5", t: 3 }, b: { text: "" }, c: null, d: { text: "y" } })).toEqual({
      a: { text: "x", margin: "5", t: 3 },
      d: { text: "y", margin: "printer", t: 0 },
    });
    expect(sanitiseLayouts("junk")).toEqual({});
  });
});
