import { describe, expect, it } from "vitest";
import { addRecent, exportFileName, formatBytes, formatZoom, joinPath, parsePageRange, parseZoom, removeRecent } from "./format";

describe("zoom", () => {
  it("formats", () => {
    expect(formatZoom(2.123)).toBe("212%");
    expect(formatZoom(1)).toBe("100%");
    expect(formatZoom(0.085)).toBe("8.5%");
    expect(formatZoom(0.05)).toBe("5.0%");
  });
  it("parses what people type", () => {
    expect(parseZoom("150")).toBe(1.5);
    expect(parseZoom(" 150 % ")).toBe(1.5);
    expect(parseZoom("1.5x")).toBe(1.5);
    expect(parseZoom("12,5")).toBe(0.125);
  });
  it("clamps and rejects", () => {
    expect(parseZoom("1")).toBe(0.05);
    expect(parseZoom("100000")).toBe(64);
    expect(parseZoom("0")).toBeNull();
    expect(parseZoom("fit")).toBeNull();
    expect(parseZoom("")).toBeNull();
  });
});

describe("recent files", () => {
  it("puts the newest first without duplicates", () => {
    expect(addRecent(["C:\\a.pdf", "C:\\b.pdf"], "c:\\B.pdf")).toEqual(["c:\\B.pdf", "C:\\a.pdf"]);
  });
  it("caps the list", () => {
    let l: string[] = [];
    for (let i = 0; i < 15; i++) l = addRecent(l, `C:\\${i}.pdf`);
    expect(l.length).toBe(10);
    expect(l[0]).toBe("C:\\14.pdf");
  });
  it("removes", () => {
    expect(removeRecent(["C:\\a.pdf", "C:\\b.pdf"], "C:\\A.PDF")).toEqual(["C:\\b.pdf"]);
  });
});

describe("parsePageRange", () => {
  it("treats empty as all pages", () => {
    expect(parsePageRange("", 3)).toEqual([0, 1, 2]);
  });
  it("parses pages and ranges", () => {
    expect(parsePageRange("1-3, 7", 10)).toEqual([0, 1, 2, 6]);
    expect(parsePageRange("7, 2, 2", 10)).toEqual([1, 6]);
    expect(parsePageRange("8-", 10)).toEqual([7, 8, 9]);
    expect(parsePageRange("2–3", 10)).toEqual([1, 2]);
  });
  it("explains what is wrong", () => {
    expect(parsePageRange("0", 5)).toBe("Pages run from 1 to 5");
    expect(parsePageRange("4-9", 5)).toBe("Pages run from 1 to 5");
    expect(parsePageRange("3-1", 5)).toBe('"3-1" runs backwards');
    expect(parsePageRange("a", 5)).toBe('"a" isn\'t a page or a range');
    expect(parsePageRange(",,", 5)).toBe("No pages chosen");
  });
});

describe("misc", () => {
  it("formats bytes", () => {
    expect(formatBytes(500)).toBe("500 bytes");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(12.4 * 1024 * 1024)).toBe("12.4 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.00 GB");
  });
  it("names exported pages", () => {
    expect(exportFileName("Plan Rev C.pdf", 2, 12, "png")).toBe("Plan Rev C p03.png");
    expect(exportFileName("photo.jpg", 0, 1, "jpg")).toBe("photo p1.jpg");
  });
  it("joins paths", () => {
    expect(joinPath("C:\\out\\", "a.png")).toBe("C:\\out\\a.png");
    expect(joinPath("C:/out", "a.png")).toBe("C:/out\\a.png");
  });
});
