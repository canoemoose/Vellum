import { describe, expect, it } from "vitest";
import { type Face, HELVETICA, baseFont, fontResource, glyphWidth, textWidth, toWinAnsi, wrap } from "./fonts";
import { type Markup, type TextStyle, DEFAULT_TEXT, defaultStyle, fullText } from "./types";
import { opsFor, type PathOp, type TextOp } from "./ops";
import { toContent } from "./pdf";
import { toSpec } from "./spec";
import { sanitisePrefs } from "./prefs";

const face = (family: Face["family"], bold = false, italic = false): Face => ({ family, bold, italic });
const meta = { author: "", created: "2026-11-14T12:00:00.000Z", modified: "2026-11-14T12:00:00.000Z" };
const A4 = { quarterTurns: 0, bbox: [0, 0, 595, 842] as [number, number, number, number] };
const box = (t: Partial<TextStyle>, text = "Check this bolt"): Markup => ({
  id: "t", page: 0, kind: "text", rect: [100, 100, 300, 140], text, textStyle: { ...DEFAULT_TEXT, ...t }, style: defaultStyle("text"), meta,
});

describe("standard fonts", () => {
  it("has Adobe's widths for each face", () => {
    // Spot checks against the AFM files.
    expect(glyphWidth(0x61, HELVETICA)).toBe(556); // a
    expect(glyphWidth(0x69, face("helvetica", true))).toBe(278); // i, bold
    expect(glyphWidth(0x20, face("times"))).toBe(250);
    expect(glyphWidth(0x41, face("times", false, true))).toBe(611); // A, italic
    expect(glyphWidth(0x41, face("times", true, true))).toBe(667); // A, bold italic
    expect(glyphWidth(0x69, face("courier", true))).toBe(600);
    // Italic Helvetica shares the upright widths.
    expect(textWidth("Hello", 10, face("helvetica", false, true))).toBe(textWidth("Hello", 10, HELVETICA));
    // WinAnsi's extra characters: euro, curly quotes, en dash.
    expect(toWinAnsi("€‘’–")).toEqual([0x80, 0x91, 0x92, 0x96]);
  });

  it("wraps by the face's own widths", () => {
    const text = "Check this bolt before the show starts";
    expect(wrap(text, 100, 10, face("courier")).length).toBeGreaterThan(wrap(text, 100, 10, face("times")).length);
  });

  it("names each face as PDF and Acrobat do", () => {
    expect(baseFont(face("times", true, true))).toBe("Times-BoldItalic");
    expect(baseFont(face("helvetica", false, true))).toBe("Helvetica-Oblique");
    expect(baseFont(face("courier"))).toBe("Courier");
    expect(fontResource(face("times", true))).toBe("TiBo");
    expect(fontResource(HELVETICA)).toBe("Helv");
  });
});

describe("text box styles", () => {
  it("reads older text styles with the defaults", () => {
    expect(fullText({ size: 12, colour: [0, 0, 0] })).toEqual({ ...DEFAULT_TEXT, size: 12 });
    expect(sanitisePrefs({ text: { size: 12, family: "times", bold: true, align: "middle" } }).text).toMatchObject({ family: "times", bold: true, align: "left" });
  });

  it("aligns each line within the box", () => {
    const ops = (align: TextStyle["align"]) => opsFor(box({ align })).find((o) => o.t === "text") as TextOp;
    const inner = 200 - 2 * (4 + 1);
    const w = textWidth("Check this bolt", 10);
    expect(ops("left").offsets[0]).toBe(0);
    expect(ops("center").offsets[0]).toBeCloseTo((inner - w) / 2);
    expect(ops("right").offsets[0]).toBeCloseTo(inner - w);
  });

  it("underlines and strikes through each line, as square-ended lines in the text's colour", () => {
    const ops = opsFor(box({ underline: true, strike: true, colour: [0, 0, 1] }));
    const deco = ops.find((o) => o.t === "path" && o.decoration) as PathOp;
    expect(deco.stroke).toEqual([0, 0, 1]);
    expect(deco.segs.filter((s) => s[0] === "M").length).toBe(2);
    expect(toContent(A4, ops).ops).toContain("1 j 0 J");
  });

  it("spaces lines by the chosen spacing", () => {
    const t = (spacing: number) => opsFor(box({ spacing })).find((o) => o.t === "text") as TextOp;
    expect(t(2).leading).toBe(20);
    expect(t(1).leading).toBe(10);
  });

  it("saves the face, alignment and decoration for apps that redraw the box", () => {
    const m = box({ family: "times", bold: true, align: "right", underline: true });
    const s = toSpec(m, A4);
    expect(s.appearance.fonts).toEqual({ TiBo: "Times-Bold" });
    expect(s.appearance.ops).toContain("/TiBo 10 Tf");
    expect(s.defaultAppearance).toContain("/TiBo 10 Tf");
    expect(s.defaultStyle).toContain("bold 10pt Times New Roman");
    expect(s.defaultStyle).toContain("text-align:right");
    expect(s.defaultStyle).toContain("text-decoration:underline");
    expect(s.quadding).toBe(2);
  });
});
