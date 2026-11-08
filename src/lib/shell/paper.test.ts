import { describe, expect, it } from "vitest";
import { cursorText, pageSizeText, paperName, PT_TO_MM } from "./paper";

const mmToPt = (mm: number) => mm / PT_TO_MM;

describe("paperName", () => {
  it("names ISO sizes in either orientation", () => {
    expect(paperName(841, 594)).toBe("A1");
    expect(paperName(594, 841)).toBe("A1");
    expect(paperName(210, 297)).toBe("A4");
    expect(paperName(1189, 841)).toBe("A0");
    expect(paperName(500, 707)).toBe("B2");
  });
  it("allows PDF rounding within 2 mm", () => {
    expect(paperName(842.0, 595.3)).toBe("A1");
    expect(paperName(209, 296)).toBe("A4");
  });
  it("names US sizes", () => {
    expect(paperName(215.9, 279.4)).toBe("Letter");
    expect(paperName(431.8, 279.4)).toBe("Tabloid");
  });
  it("returns null for anything else", () => {
    expect(paperName(600, 400)).toBeNull();
    expect(paperName(841, 600)).toBeNull();
  });
});

describe("pageSizeText", () => {
  it("formats a named page in mm", () => {
    expect(pageSizeText(mmToPt(841), mmToPt(594), "metric")).toBe("A1 · 841 × 594 mm");
  });
  it("formats a custom page without a name", () => {
    expect(pageSizeText(mmToPt(600), mmToPt(400), "metric")).toBe("600 × 400 mm");
  });
  it("formats inches", () => {
    expect(pageSizeText(612, 792, "imperial")).toBe("Letter · 8.50 × 11.00 in");
  });
});

describe("cursorText", () => {
  const h = mmToPt(594);
  it("gives paper mm from the bottom-left without a scale", () => {
    expect(cursorText(mmToPt(312.4), h - mmToPt(88), h, null, "metric")).toBe("X 312.4  Y 88.0 mm");
  });
  it("gives metres with a scale", () => {
    // 146.2 mm on paper at 1:100 = 14.62 m
    expect(cursorText(mmToPt(146.2), h - mmToPt(80.3), h, 100, "metric")).toBe("X 14.62  Y 8.03 m");
  });
  it("gives inches and feet in imperial", () => {
    expect(cursorText(72, h - 144, h, null, "imperial")).toBe("X 1.00  Y 2.00 in");
    // 1 inch on paper at 1:96 (1/8" = 1') = 8 ft
    expect(cursorText(72, h, h, 96, "imperial")).toBe("X 8.00  Y 0.00 ft");
  });
});
