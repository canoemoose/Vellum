import { describe, expect, it } from "vitest";
import { contrastOnWhite, DEFAULT_INK, INKS, parseHex, recolour, toHex, tooLight } from "./ink";

describe("hex colours", () => {
  it("parses and writes #rrggbb and #rgb", () => {
    expect(parseHex("#1c3a94")).toEqual([0x1c, 0x3a, 0x94]);
    expect(parseHex("#FFF")).toEqual([255, 255, 255]);
    expect(parseHex(" #000000 ")).toEqual([0, 0, 0]);
    for (const bad of ["", "red", "#12", "#12345g", "123456"]) expect(parseHex(bad), bad).toBeNull();
    expect(toHex([28, 58, 148])).toBe("#1c3a94");
    expect(toHex([300, -4, 7.6])).toBe("#ff0008");
  });
});

describe("recolour", () => {
  it("sets every pixel's colour and keeps its alpha", () => {
    const px = new Uint8ClampedArray([10, 20, 30, 0, 40, 50, 60, 128, 1, 2, 3, 255]);
    recolour(px, [200, 100, 50]);
    expect([...px]).toEqual([200, 100, 50, 0, 200, 100, 50, 128, 200, 100, 50, 255]);
  });
});

describe("contrast on white (APCA)", () => {
  it("rates black near the top and white at nothing", () => {
    expect(contrastOnWhite([0, 0, 0])).toBeGreaterThan(105);
    expect(contrastOnWhite([255, 255, 255])).toBe(0);
  });

  it("passes the ready-made inks and dark colours, flags pale ones", () => {
    for (const ink of INKS) expect(tooLight(parseHex(ink.hex)!), ink.id).toBe(false);
    expect(tooLight(parseHex(DEFAULT_INK)!)).toBe(false);
    expect(tooLight([0x88, 0x88, 0x88])).toBe(false); // mid grey reads fine
    expect(tooLight([0xb0, 0x20, 0x20])).toBe(false); // a red pen
    expect(tooLight([0xff, 0xd7, 0x00])).toBe(true); // yellow
    expect(tooLight([0x87, 0xce, 0xeb])).toBe(true); // sky blue
    expect(tooLight([0xdd, 0xdd, 0xdd])).toBe(true); // pale grey
  });
});
