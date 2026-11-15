// Quads for text markups from character boxes: plain, several lines, and text running in each
// of the four directions a page's rotation (or a CAD drawing's rotated text) gives it.

import { describe, expect, it } from "vitest";
import type { TextLayer } from "./layer";
import { lineQuads, quadAround, quadHeight } from "./quads";

/** Characters 6 x 10 pt, one box each, laid out from (x, y) in direction `dir`, with "\r\n" between lines. */
function layerOf(lines: { text: string; x: number; y: number; dir?: "right" | "down" | "up" | "left" }[]): TextLayer {
  const codes: number[] = [];
  const boxes: number[] = [];
  const flags: number[] = [];
  lines.forEach((ln, li) => {
    if (li > 0)
      for (const c of "\r\n") {
        codes.push(c.charCodeAt(0));
        boxes.push(0, 0, 0, 0);
        flags.push(1);
      }
    [...ln.text].forEach((ch, k) => {
      codes.push(ch.codePointAt(0)!);
      const d = ln.dir ?? "right";
      if (d === "right") boxes.push(ln.x + k * 6, ln.y, ln.x + k * 6 + 6, ln.y + 10);
      else if (d === "left") boxes.push(ln.x - k * 6 - 6, ln.y, ln.x - k * 6, ln.y + 10);
      else if (d === "down") boxes.push(ln.x, ln.y + k * 6, ln.x + 10, ln.y + k * 6 + 6);
      else boxes.push(ln.x, ln.y - k * 6 - 6, ln.x + 10, ln.y - k * 6);
      flags.push(2);
    });
  });
  return { n: codes.length, codes: Uint32Array.from(codes), boxes: Float32Array.from(boxes), flags: Uint8Array.from(flags), links: [] };
}

describe("lineQuads", () => {
  it("makes one quad for a run on one line, corners top left, top right, bottom left, bottom right", () => {
    const l = layerOf([{ text: "Hello", x: 100, y: 200 }]);
    expect(lineQuads(l, 0, 5)).toEqual([
      [[100, 200], [130, 200], [100, 210], [130, 210]],
    ]);
    // Part of the line: just those characters.
    expect(lineQuads(l, 1, 3)).toEqual([[[106, 200], [118, 200], [106, 210], [118, 210]]]);
  });

  it("makes one per line across several lines, skipping the generated line breaks", () => {
    const l = layerOf([
      { text: "First", x: 100, y: 200 },
      { text: "Second", x: 100, y: 214 },
      { text: "Third", x: 100, y: 228 },
    ]);
    const q = lineQuads(l, 2, l.n - 2);
    expect(q).toHaveLength(3);
    expect(q[0][0]).toEqual([112, 200]);
    expect(q[1][1]).toEqual([136, 214]);
    expect(q[2][3]).toEqual([118, 238]);
  });

  it("follows text running down the page: the glyphs' tops face right", () => {
    const q = lineQuads(layerOf([{ text: "Down", x: 50, y: 100, dir: "down" }]), 0, 4)[0];
    // Top left is the start of the line on the glyphs' top side (x = 60), bottom left on x = 50.
    expect(q).toEqual([[60, 100], [60, 124], [50, 100], [50, 124]]);
  });

  it("follows text running up the page: the glyphs' tops face left", () => {
    const q = lineQuads(layerOf([{ text: "Up", x: 50, y: 100, dir: "up" }]), 0, 2)[0];
    expect(q).toEqual([[50, 100], [50, 88], [60, 100], [60, 88]]);
  });

  it("follows upside-down text (a page turned half round)", () => {
    const q = lineQuads(layerOf([{ text: "Flip", x: 100, y: 50, dir: "left" }]), 0, 4)[0];
    expect(q).toEqual([[100, 60], [76, 60], [100, 50], [76, 50]]);
    expect(quadHeight(q)).toBe(10);
  });

  it("leaves a lone character reading left to right", () => {
    expect(lineQuads(layerOf([{ text: "X", x: 10, y: 10 }]), 0, 1)).toEqual([[[10, 10], [16, 10], [10, 20], [16, 20]]]);
  });

  it("makes an empty list for nothing selected", () => {
    expect(lineQuads(layerOf([{ text: "Hi", x: 0, y: 0 }]), 1, 1)).toEqual([]);
  });
});

describe("quadAround", () => {
  it("turns with diagonal text, spanning its boxes along and across the line", () => {
    const d: [number, number] = [Math.SQRT1_2, Math.SQRT1_2];
    const q = quadAround([[0, 0, 2, 2], [10, 10, 12, 12]], d);
    // Along the line from the first box's start to the last box's end.
    expect(Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1])).toBeCloseTo(12 * Math.SQRT2);
    // Top edge parallel to the reading direction.
    expect((q[1][1] - q[0][1]) / (q[1][0] - q[0][0])).toBeCloseTo(1);
  });
});
