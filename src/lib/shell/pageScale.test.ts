import { describe, expect, it } from "vitest";
import {
  fromRemembered, pageScaleText, rememberPages, revaluedText, sanitiseRememberedPages, scaleForPage, toRemembered, withPageScale,
} from "./pageScale";

const doc = { ratio: 100, source: "detected" as const };

describe("per-page scales", () => {
  it("uses a page's own scale over the document's", () => {
    const pages = withPageScale(undefined, 2, { ratio: 50, source: "manual" });
    expect(scaleForPage(doc, pages, 2)?.ratio).toBe(50);
    expect(scaleForPage(doc, pages, 0)?.ratio).toBe(100);
    expect(scaleForPage(null, pages, 0)).toBeNull();
    expect(scaleForPage(null, undefined, 0)).toBeNull();
  });

  it("removes a page's own scale", () => {
    const pages = withPageScale({ 2: { ratio: 50, source: "manual" } }, 2, null);
    expect(pages).toEqual({});
  });

  it("says in the status bar when the page in view has its own", () => {
    const pages = { 1: { ratio: 50, source: "manual" as const } };
    expect(pageScaleText(doc, pages, 1)).toBe("Scale 1:50 (this page)");
    expect(pageScaleText(doc, pages, 0)).toBe("Scale 1:100 (from title block)");
    expect(pageScaleText(null, {}, 0)).toBe("Scale not set");
  });

  it("is remembered per file, capped, and read back checked", () => {
    const pages = { 1: { ratio: 50, source: "manual" as const }, 4: { ratio: 98.7, source: "manual" as const } };
    expect(toRemembered(pages)).toEqual({ 1: 50, 4: 98.7 });
    expect(fromRemembered({ 1: 50, x: 3, 2: -1, 3: "a" } as never)).toEqual({ 1: { ratio: 50, source: "manual" } });
    let map = rememberPages({}, "a.pdf", pages);
    map = rememberPages(map, "b.pdf", { 0: { ratio: 20, source: "manual" } });
    expect(Object.keys(map)).toEqual(["a.pdf", "b.pdf"]);
    expect(Object.keys(rememberPages(map, "a.pdf", {}))).toEqual(["b.pdf"]);
    expect(Object.keys(rememberPages(map, "c.pdf", pages, 2))).toEqual(["b.pdf", "c.pdf"]);
    expect(sanitiseRememberedPages({ "a.pdf": { 1: 50 }, "b.pdf": { 1: "x" }, c: 4 })).toEqual({ "a.pdf": { 1: 50 } });
    expect(sanitiseRememberedPages(null)).toEqual({});
  });

  it("says how many measurements a new scale re-valued", () => {
    expect(revaluedText(0)).toBeNull();
    expect(revaluedText(1)).toBe("1 measurement re-valued at the new scale");
    expect(revaluedText(3)).toBe("3 measurements re-valued at the new scale");
  });
});
