import { describe, expect, it } from "vitest";
import { aSize, groupPapers } from "./paperOrder";

const paper = (name: string, w: number, h: number) => ({ name, w, h });

describe("paper order", () => {
  it("knows the A sizes either way round, within 2 mm", () => {
    expect(aSize({ w: 210, h: 297 })).toBe(4);
    expect(aSize({ w: 420, h: 297 })).toBe(3);
    expect(aSize({ w: 211.5, h: 296 })).toBe(4);
    expect(aSize({ w: 215.9, h: 279.4 })).toBeNull(); // Letter
    expect(aSize({ w: 250, h: 353 })).toBeNull(); // B4
  });

  it("puts A sizes first, largest first, and keeps the driver's order for the rest", () => {
    const list = [
      paper("Letter", 215.9, 279.4),
      paper("A4", 210, 297),
      paper("Legal", 215.9, 355.6),
      paper("A3", 297, 420),
      paper("A4 (borderless)", 210, 297),
      paper("Envelope DL", 110, 220),
      paper("A1", 594, 841),
    ];
    const g = groupPapers(list);
    expect(g.a.map((p) => p.name)).toEqual(["A1", "A3", "A4", "A4 (borderless)"]);
    expect(g.other.map((p) => p.name)).toEqual(["Letter", "Legal", "Envelope DL"]);
  });
});
