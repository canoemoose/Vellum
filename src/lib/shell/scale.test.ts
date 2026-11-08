import { describe, expect, it } from "vitest";
import { formatRatio, inTitleBlockZone, parseScaleInput, pickDetectedScale, rememberScale, scaleStatusText } from "./scale";

const W = 2384; // A1 landscape, points
const H = 1684;

describe("status text", () => {
  it("covers the three states", () => {
    expect(scaleStatusText({ ratio: 100, source: "detected" })).toBe("Scale 1:100 (from title block)");
    expect(scaleStatusText({ ratio: 100, source: "manual" })).toBe("Scale 1:100");
    expect(scaleStatusText(null)).toBe("Scale not set");
  });
  it("formats fractional ratios", () => {
    expect(formatRatio(2.5)).toBe("1:2.5");
    expect(formatRatio(200)).toBe("1:200");
  });
});

describe("title block zone", () => {
  it("accepts the bottom-right quarter and the edge strips", () => {
    expect(inTitleBlockZone([2100, 1500, 2200, 1520], W, H)).toBe(true);
    expect(inTitleBlockZone([2250, 100, 2300, 120], W, H)).toBe(true); // right-hand strip
    expect(inTitleBlockZone([200, 1600, 260, 1620], W, H)).toBe(true); // bottom strip
  });
  it("rejects the middle and the top-left", () => {
    expect(inTitleBlockZone([1100, 800, 1200, 820], W, H)).toBe(false);
    expect(inTitleBlockZone([100, 100, 150, 120], W, H)).toBe(false);
  });
});

describe("pickDetectedScale", () => {
  const c = (ratio: number, x: number, y: number) => ({ ratio, text: `1:${ratio}`, bbox: [x, y, x + 40, y + 10] as [number, number, number, number] });
  it("takes the best candidate in a title-block position", () => {
    expect(pickDetectedScale([c(200, 2200, 1600)], W, H)).toBe(200);
  });
  it("skips candidates elsewhere on the page", () => {
    expect(pickDetectedScale([c(10, 600, 500), c(5, 700, 400)], W, H)).toBeNull();
    expect(pickDetectedScale([c(10, 600, 500), c(50, 2200, 1600)], W, H)).toBe(50);
  });
  it("skips tiny text (labels inside the drawing)", () => {
    const tiny = { ratio: 10, text: "1:10", bbox: [2200, 1600, 2205, 1601.4] as [number, number, number, number] };
    expect(pickDetectedScale([tiny], W, H)).toBeNull();
    expect(pickDetectedScale([tiny, c(100, 2200, 1600)], W, H)).toBe(100);
  });
  it("accepts the stage plan's title block 1:200", () => {
    // Measured from the test file: A1 landscape, 10 pt text near the bottom-right.
    expect(pickDetectedScale([{ ratio: 200, text: "1:200", bbox: [2058.05, 1340.58, 2090.19, 1350.73] }], 2384, 1684)).toBe(200);
  });
  it("never adopts 1:1", () => {
    expect(pickDetectedScale([c(1, 2200, 1600)], W, H)).toBeNull();
  });
  it("handles no candidates", () => {
    expect(pickDetectedScale([], W, H)).toBeNull();
  });
});

describe("parseScaleInput", () => {
  it("accepts the usual spellings", () => {
    expect(parseScaleInput("1:200")).toBe(200);
    expect(parseScaleInput(" 1 : 50 ")).toBe(50);
    expect(parseScaleInput("1/100")).toBe(100);
    expect(parseScaleInput("1250")).toBe(1250);
    expect(parseScaleInput("1:2.5")).toBe(2.5);
    expect(parseScaleInput("1:2,5")).toBe(2.5);
  });
  it("rejects nonsense and out-of-range values", () => {
    expect(parseScaleInput("")).toBeNull();
    expect(parseScaleInput("abc")).toBeNull();
    expect(parseScaleInput("2:100")).toBeNull();
    expect(parseScaleInput("0")).toBeNull();
    expect(parseScaleInput("1:1000000")).toBeNull();
  });
});

describe("rememberScale", () => {
  it("adds, replaces and removes", () => {
    let m = rememberScale({}, "a", 100);
    m = rememberScale(m, "b", 50);
    m = rememberScale(m, "a", 200);
    expect(Object.keys(m)).toEqual(["b", "a"]);
    expect(m.a).toBe(200);
    expect(rememberScale(m, "a", null)).toEqual({ b: 50 });
  });
  it("drops the oldest past the cap", () => {
    let m: Record<string, number> = {};
    for (let i = 0; i < 5; i++) m = rememberScale(m, `k${i}`, i + 1, 3);
    expect(Object.keys(m)).toEqual(["k2", "k3", "k4"]);
  });
});
