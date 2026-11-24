import { describe, expect, it } from "vitest";
import {
  fromRemembered, pageScaleStatus, pageScaleText, rememberPages, resolvePageScale, revaluedText, sanitiseRememberedPages, scaleForPage, toRemembered,
  withPageScale,
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

describe("each page's own title block", () => {
  // A set like Fieldwork's: page 1 says 1:5000, pages 2 and 3 their own; page 4 here says
  // nothing (unlike Fieldwork's, which says 1:100), to cover borrowing.
  const detected = { 0: 5000, 1: 2500, 2: 500, 3: null };
  const fromP1 = { ratio: 5000, source: "detected" as const };

  it("measures each page at its own title block's scale", () => {
    expect(resolvePageScale(fromP1, {}, 0, detected)).toEqual({ scale: { ratio: 5000, source: "detected" }, from: "title block" });
    expect(resolvePageScale(fromP1, {}, 2, detected)).toEqual({ scale: { ratio: 500, source: "detected" }, from: "title block" });
  });

  it("measures on paper once the scale is cleared (App passes no title blocks)", () => {
    expect(resolvePageScale(null, {}, 2, undefined)).toEqual({ scale: null, from: null });
    expect(pageScaleStatus(null, {}, 2, "metric", undefined)).toEqual({ text: "Scale not set", warn: true });
    // A page's own scale still stands.
    expect(resolvePageScale(null, { 2: { ratio: 50, source: "manual" } }, 2, undefined).from).toBe("this page");
  });

  it("borrows page 1's scale for a page that states none, flagged", () => {
    expect(resolvePageScale(fromP1, {}, 3, detected)).toEqual({ scale: fromP1, from: "borrowed" });
    expect(pageScaleStatus(fromP1, {}, 3, "metric", detected)).toEqual({ text: "Scale 1:5000 (from page 1)", warn: true });
  });

  it("uses the document's scale, unflagged, for a page not read yet", () => {
    expect(resolvePageScale(fromP1, {}, 7, detected)).toEqual({ scale: fromP1, from: "pending" });
    expect(pageScaleStatus(fromP1, {}, 7, "metric", detected).warn).toBe(false);
  });

  it("lets a scale set by hand win: for the page, then for every page", () => {
    const pages = { 2: { ratio: 20, source: "manual" as const } };
    expect(resolvePageScale(fromP1, pages, 2, detected).from).toBe("this page");
    const everyPage = { ratio: 50, source: "manual" as const };
    expect(resolvePageScale(everyPage, {}, 2, detected)).toEqual({ scale: everyPage, from: "document" });
    expect(resolvePageScale(everyPage, {}, 3, detected).from).toBe("document");
    expect(pageScaleStatus(everyPage, {}, 3, "metric", detected)).toEqual({ text: "Scale 1:50", warn: false });
  });

  it("says Scale not set as a warning, and finds nothing to borrow without a document scale", () => {
    expect(resolvePageScale(null, {}, 3, detected)).toEqual({ scale: null, from: null });
    expect(pageScaleStatus(null, {}, 3, "metric", detected)).toEqual({ text: "Scale not set", warn: true });
    // A page's own title block still counts when page 1 states nothing.
    expect(scaleForPage(null, {}, 1, detected)?.ratio).toBe(2500);
  });
});
