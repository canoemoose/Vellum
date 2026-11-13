import { describe, expect, it } from "vitest";
import { autoNavMode } from "./navMode";

const mm = (w: number, h: number) => ({ w: (w / 25.4) * 72, h: (h / 25.4) * 72 });

describe("navigation mode from page size", () => {
  it("A4 and smaller navigate like a document, either way round", () => {
    expect(autoNavMode(mm(210, 297))).toBe("document");
    expect(autoNavMode(mm(297, 210))).toBe("document");
    expect(autoNavMode({ w: 612, h: 792 })).toBe("document"); // US Letter
    expect(autoNavMode(mm(148, 210))).toBe("document"); // A5
    expect(autoNavMode(mm(212, 300))).toBe("document"); // A4 with a little bleed
  });

  it("bigger than A4 navigates like CAD", () => {
    expect(autoNavMode(mm(420, 297))).toBe("cad"); // A3
    expect(autoNavMode(mm(841, 594))).toBe("cad"); // A1
    expect(autoNavMode({ w: 746, h: 14400 })).toBe("cad"); // the tall aerial drawing
    expect(autoNavMode({ w: 612, h: 1008 })).toBe("cad"); // US Legal is longer than A4
  });

  it("no page yet falls back to CAD", () => {
    expect(autoNavMode(undefined)).toBe("cad");
  });
});
