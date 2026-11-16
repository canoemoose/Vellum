// Stamps: text stamp layouts, signature strokes as paths, images as operations, the stamp kind
// (placing, aspect-locked resizing, picking, its annotation and its private copy). Every
// signature here is synthetic, made in the test.

import { describe, expect, it } from "vitest";
import type { Markup, Rect } from "./types";
import { type ImageOp, type PathOp, type TextOp, opsBounds, opsFor } from "./ops";
import { toSpec } from "./spec";
import { toContent, type Frame } from "./pdf";
import { reeditEntry } from "./reedit";
import { dragHandle, handles, hits, moveBy } from "./geometry";
import {
  type ImageContent, type StrokesContent, type TextContent, BUILT_IN, aspectOf, cleanLabel, contentOps, defaultSub, fromBase64,
  imageContent, imageResName, naturalSize, pngSize, sha256, stampDate, stampName, strokesBox, strokesContent, strokesOps, textOps, textSize, toBase64,
} from "./stamps";
import { SIGNATURE_WIDTH, STAMP_WIDTH, armStamp, boxAt, dragCorner, fitBox, stamp as stampKind } from "./kinds/stamp";
import { textWidth } from "./fonts";

const A4: Frame = { quarterTurns: 0, bbox: [0, 0, 595, 842] };
const meta = { author: "Tester", created: "2026-11-15T10:00:00Z", modified: "2026-11-15T10:00:00Z" };

const approved: TextContent = { type: "text", label: "Approved", sub: "Tester, 15 Nov 2026", colour: [0.1, 0.55, 0.2] };
const zigzag: StrokesContent = { type: "strokes", strokes: [[0, 20, 10, 0, 20, 20, 30, 0], [40, 10]], pen: 2, colour: [0, 0, 0.5] };

/** A tiny real PNG: 2 x 1 pixels (header only matters to pngSize; bytes go through as given). */
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x99, 0x1a, 0x0b, 0x2e,
]);

function mk(content: TextContent | StrokesContent | ImageContent, rect: Rect, signature = false): Markup {
  return { id: "st-1", page: 0, kind: "stamp", style: stampKind.defaultStyle(), meta, rect, content, signature } as Markup;
}

describe("text stamps", () => {
  it("lays out a border, bold capitals and a second line, centred", () => {
    const ops = textOps(approved);
    const [w, h] = textSize(approved);
    expect(ops.map((o) => o.t)).toEqual(["path", "text", "text"]);
    const main = ops[1] as TextOp;
    const sub = ops[2] as TextOp;
    expect(main.lines).toEqual(["APPROVED"]);
    expect(main.face.bold).toBe(true);
    expect(sub.lines).toEqual(["Tester, 15 Nov 2026"]);
    // Centred: equal room either side.
    const mw = textWidth("APPROVED", main.size, main.face);
    expect(main.offsets[0] * 2 + mw).toBeCloseTo(w);
    // Inside the box, the second line below the first.
    expect(sub.origin[1]).toBeGreaterThan(main.origin[1]);
    expect(sub.origin[1]).toBeLessThan(h);
    // The border is a closed path with rounded corners (curves).
    const border = ops[0] as PathOp;
    expect(border.segs.filter((s) => s[0] === "C").length).toBeGreaterThanOrEqual(4);
    expect(border.stroke).toEqual(approved.colour);
  });

  it("is shorter without a second line and as wide as its widest line", () => {
    const one = { ...approved, sub: null };
    expect(textSize(one)[1]).toBeLessThan(textSize(approved)[1]);
    expect(textOps(one)).toHaveLength(2);
    const long = { ...approved, sub: "A very long name indeed, with a long job title, 15 Nov 2026" };
    expect(textSize(long)[0]).toBeGreaterThan(textSize(approved)[0]);
  });

  it("names the built-in stamps as Acrobat does and cleans custom wording", () => {
    expect(BUILT_IN.map((b) => b.label)).toEqual(["APPROVED", "FOR COMMENT", "SUPERSEDED"]);
    expect(stampName({ ...approved }, false)).toBe("Approved");
    expect(stampName({ ...approved, label: "FOR COMMENT" }, false)).toBe("ForComment");
    expect(stampName({ ...approved, label: "Checked" }, false)).toBe("Custom");
    expect(stampName(zigzag, true)).toBe("Signature");
    expect(cleanLabel("  checked   by\nsite  ")).toBe("CHECKED BY SITE");
    expect(cleanLabel("x".repeat(100))).toHaveLength(60);
  });

  it("fills its second line from the author and the date", () => {
    const d = new Date(2026, 10, 5);
    expect(stampDate(d)).toBe("5 Nov 2026");
    expect(defaultSub("Matt", d)).toBe("Matt, 5 Nov 2026");
    expect(defaultSub("  ", d)).toBe("5 Nov 2026");
  });
});

describe("signature strokes", () => {
  it("become one path of curves through the midpoints, cropped to the ink", () => {
    const [op] = strokesOps(zigzag) as PathOp[];
    expect(op.stroke).toEqual(zigzag.colour);
    expect(op.width).toBe(2);
    const kinds = op.segs.map((s) => s[0]);
    // Four points: M, two curves, L to the end; then the dot: M and a tiny L.
    expect(kinds).toEqual(["M", "C", "C", "L", "M", "L"]);
    // Starts at the first point, less the box's corner (pen included).
    const b = strokesBox(zigzag);
    expect(b).toEqual([-1, -1, 41, 21]);
    expect(op.segs[0]).toEqual(["M", 1, 21]);
  });

  it("come from the library's stored form", () => {
    const c = strokesContent({ strokes: [[{ x: 1, y: 2 }, { x: 3, y: 4 }]], pen: 2.6, colour: "#0000ff" })!;
    expect(c.strokes).toEqual([[1, 2, 3, 4]]);
    expect(c.colour).toEqual([0, 0, 1]);
    expect(strokesContent({ strokes: [], pen: 2, colour: "#000000" })).toBeNull();
  });
});

describe("images", () => {
  it("read a PNG's size, hash it and round-trip base64", async () => {
    expect(pngSize(PNG)).toEqual([2, 1]);
    expect(pngSize(Uint8Array.from([1, 2, 3]))).toBeNull();
    expect(fromBase64(toBase64(PNG))).toEqual(PNG);
    const big = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(fromBase64(toBase64(big))).toEqual(big);
    const h = await sha256(PNG);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    const c = (await imageContent(PNG))!;
    expect([c.w, c.h, c.hash]).toEqual([2, 1, h]);
    expect(await imageContent(Uint8Array.from([1, 2]))).toBeNull();
  });

  it("are one operation filling the box, counted in the bounds", () => {
    const c: ImageContent = { type: "image", png: "AAAA", hash: "abc123", w: 200, h: 100 };
    const ops = contentOps(c, [10, 20, 110, 70]);
    expect(ops).toEqual([{ t: "image", rect: [10, 20, 110, 70], png: "AAAA", hash: "abc123" }]);
    expect(opsBounds(ops)).toEqual([10, 20, 110, 70]);
  });

  it("go into the appearance as a Do through a matrix that keeps them upright", () => {
    const op: ImageOp = { t: "image", rect: [10, 20, 110, 70], png: "AAAA", hash: "ABCDEF0123456789ff" };
    // Unrotated A4: bottom left of the picture at page (10, 70) = user (10, 772); 100 x 50.
    expect(toContent(A4, [op]).ops).toBe(`q\n100 0 0 50 10 772 cm\n/${imageResName(op.hash)} Do\nQ`);
    expect(imageResName(op.hash)).toBe("Imabcdef0123456789");
    // A page turned a quarter: the picture's x runs up the user space.
    const r1: Frame = { quarterTurns: 1, bbox: [0, 0, 595, 842] };
    expect(toContent(r1, [op]).ops).toContain("0 100 -50 0 70 10 cm");
  });
});

describe("the stamp kind", () => {
  it("places at the default size, centred, with the content's aspect", () => {
    armStamp(approved, false);
    const [w, h] = naturalSize(approved);
    const s = stampKind.draw.gesture === "place" ? stampKind.draw.make([300, 400], { textStyle: { size: 10, colour: [0, 0, 0] } }) : null;
    expect(s).not.toBeNull();
    const r = s!.rect;
    expect(r[2] - r[0]).toBeCloseTo(STAMP_WIDTH);
    expect((r[2] - r[0]) / (r[3] - r[1])).toBeCloseTo(w / h);
    expect((r[0] + r[2]) / 2).toBeCloseTo(300);
    expect((r[1] + r[3]) / 2).toBeCloseTo(400);
    armStamp(zigzag, true);
    const g = stampKind.draw.gesture === "place" ? stampKind.draw.make([0, 0], { textStyle: { size: 10, colour: [0, 0, 0] } }) : null;
    expect(g!.rect[2] - g!.rect[0]).toBeCloseTo(SIGNATURE_WIDTH);
    expect(g!.signature).toBe(true);
  });

  it("fits a dragged box to its aspect, and a tiny drag places at the default size", () => {
    // The zigzag's ink is 42 x 22 pad pixels.
    expect(fitBox(zigzag, [0, 0, 84, 10])).toEqual([0, 0, 84, 44]);
    const tall = fitBox(zigzag, [0, 0, 10, 50])!;
    expect(tall[2]).toBeCloseTo((50 * 42) / 22);
    expect(tall[3]).toBeCloseTo(50);
    expect(fitBox(zigzag, [0, 0, 3, 2])).toBeNull();
    expect(boxAt(zigzag, [50, 50], 42)).toEqual([29, 39, 71, 61]);
  });

  it("resizes from a corner with the opposite corner fixed and the aspect kept", () => {
    const r: Rect = [100, 100, 200, 150];
    expect(dragCorner(r, "se", [300, 160], 2)).toEqual([100, 100, 300, 200]);
    expect(dragCorner(r, "se", [210, 300], 2)).toEqual([100, 100, 500, 300]);
    expect(dragCorner(r, "nw", [0, 90], 2)).toEqual([0, 50, 200, 150]);
    // Past the fixed corner: held at the minimum, never turned inside out.
    expect(dragCorner(r, "ne", [50, 200], 2, 8)).toEqual([100, 146, 108, 150]);
    // Edge grips aren't offered; the rotate grip is (stage 8).
    const m = mk(approved, r);
    expect(handles(m).map((h) => h.id)).toEqual(["nw", "ne", "se", "sw", "rotate"]);
    const big = dragHandle(m, "se", [300, 400], false) as Markup & { rect: Rect };
    const a = aspectOf(approved);
    expect((big.rect[2] - big.rect[0]) / (big.rect[3] - big.rect[1])).toBeCloseTo(a);
  });

  it("is picked anywhere in its box, and moves", () => {
    const m = mk(zigzag, [100, 100, 184, 144], true);
    expect(hits(m, [150, 120], 2)).toBe(true);
    expect(hits(m, [99, 120], 2)).toBe(true);
    expect(hits(m, [90, 120], 2)).toBe(false);
    expect((moveBy(m, 5, 5) as Markup & { rect: Rect }).rect).toEqual([105, 105, 189, 149]);
  });

  it("draws its content scaled into its box", () => {
    const m = mk(zigzag, [100, 100, 184, 142], true);
    const [op] = opsFor(m) as PathOp[];
    // 42 pad pixels wide into 84 points: twice the size, pen too.
    expect(op.width).toBeCloseTo(4);
    expect(opsBounds([op])[0]).toBeGreaterThanOrEqual(98);
    expect(opsBounds([op])[2]).toBeLessThanOrEqual(186);
  });

  it("saves as a Stamp annotation with no border, named, printing", () => {
    const text = toSpec(mk(approved, [100, 100, 270, 150]), A4);
    expect(text.subtype).toBe("Stamp");
    expect(text.stampName).toBe("Approved");
    expect(text.flags).toBe(4);
    expect(text.borderWidth).toBeUndefined();
    expect(text.colour).toEqual(approved.colour);
    // No note text: Acrobat would show a comment icon on the stamp.
    expect(text.contents).toBeUndefined();
    expect(text.appearance.fonts).toEqual({ HeBo: "Helvetica-Bold", Helv: "Helvetica" });
    const sig = toSpec(mk(zigzag, [100, 100, 184, 142], true), A4);
    expect(sig.stampName).toBe("Signature");
    expect(sig.contents).toBeUndefined();
    expect(sig.colour).toBeUndefined();
  });

  it("puts an image in the appearance once, and its private copy refers to it by hash only", async () => {
    const c = (await imageContent(PNG))!;
    const m = mk(c, [100, 100, 200, 150], true);
    const spec = toSpec(m, A4);
    expect(spec.appearance.images).toEqual({ [imageResName(c.hash)]: { hash: c.hash, png: c.png } });
    expect(spec.appearance.ops).toContain(`/${imageResName(c.hash)} Do`);
    const entry = reeditEntry(m);
    expect(entry).not.toContain(c.png);
    expect(JSON.parse(entry).markup.content).toEqual({ type: "image", hash: c.hash, w: 2, h: 1 });
    expect(spec.vellum).toBe(entry);
  });
});
