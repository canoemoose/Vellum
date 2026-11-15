// Phase 7b: a file's annotations into the model. Vellum's own come back exactly as drawn, for
// every kind; everything else is mapped from the standard keys; the lock rule.

import { describe, expect, it } from "vitest";
import { type Markup, type MarkupKind, type MarkupOf, type Pt, defaultStyle } from "./types";
import { toSpec } from "./spec";
import type { AnnotSpec } from "./annotation";
import type { Frame } from "./pdf";
import { KINDS, kindOf } from "./kinds";
import { regularVertices } from "./regular";
import { type FileAnnot, type PageAnnots, colourOf, freeToEdit, fromFile, parsePdfDate, stampHashes, textStyleOf, withStampImages } from "./fileAnnots";

const A4: Frame = { quarterTurns: 0, bbox: [0, 0, 595, 842] };
const meta = { author: "Matt James", created: "2026-11-14T09:00:00.000Z", modified: "2026-11-15T10:00:00.000Z" };

function mk<K extends MarkupKind>(kind: K, shape: Record<string, unknown>, style: Record<string, unknown> = {}): MarkupOf<K> {
  return { id: `vellum-${kind}`, page: 2, kind, style: { ...defaultStyle(kind), ...style }, meta, ...shape } as unknown as MarkupOf<K>;
}

const fmt = { units: "auto", decimals: 2 };
/** One of every kind Vellum draws (the foreign kind is never written from the model). */
const SAMPLES: Markup[] = [
  mk("rect", { rect: [100, 100, 200, 150] }, { fill: [0, 1, 0], dash: [6, 3] }),
  mk("arrow", { from: [100, 100], to: [200, 150] }, { ends: ["dot", "filled"] }),
  mk("cloud", { vertices: [[100, 100], [200, 100], [200, 150], [100, 150]], intensity: 2 }),
  mk("text", { rect: [100, 100, 260, 130], text: "Check £5 bolt", textStyle: { size: 12, colour: [0, 0, 1], family: "times", bold: true } }),
  mk("ink", { strokes: [[[100, 100], [150, 130], [200, 150]], [[110, 160], [130, 170]]] }),
  mk("ellipse", { rect: [100, 100, 200, 150] }),
  mk("polyline", { vertices: [[100, 100], [150, 150], [200, 100]] }),
  mk("polygon", { vertices: [[100, 100], [200, 100], [150, 150]] }),
  mk("highlighter", { strokes: [[[100, 100], [150, 130], [200, 150]]] }),
  mk("callout", { tip: [250, 180], elbow: [230, 160], rect: [100, 100, 220, 130], text: "Here", textStyle: { size: 10, colour: [0, 0, 0] } }),
  mk("textmark", { variant: "underline", quads: [[[100, 100], [200, 100], [100, 110], [200, 110]]], text: "Hello" }),
  mk("note", { at: [100, 100], text: "Check this" }),
  mk("measureLength", { from: [100, 100], to: [200, 150], scale: 100, userUnit: 1, fmt, labelSize: 8 }),
  mk("measurePath", { vertices: [[100, 100], [150, 150], [200, 100]], scale: 100, userUnit: 1, fmt, labelSize: 8 }),
  mk("measureArea", { vertices: [[100, 100], [200, 100], [150, 150]], scale: 100, userUnit: 1, fmt, labelSize: 8 }),
  mk("measureAngle", { vertices: [[200, 100], [100, 100], [150, 150]], scale: null, userUnit: 1, fmt, labelSize: 8 }),
  mk("measureCalibrate", { from: [100, 100], to: [200, 150], scale: null, userUnit: 1, fmt, labelSize: 8 }),
  mk("stamp", { rect: [100, 100, 200, 150], content: { type: "text", label: "APPROVED", sub: "15 Nov 2026", colour: [0, 0.5, 0] }, signature: false }),
  mk("stamp", { rect: [100, 100, 160, 130], content: { type: "strokes", strokes: [[10, 50, 90, 50, 90, 60]], pen: 2, colour: [0, 0, 0.5] }, signature: true }),
];

/** What annot_read would give for a written spec (the keys read.rs reads, as written). */
function readBack(s: AnnotSpec, index = 0): FileAnnot {
  return {
    index, subtype: s.subtype, nm: s.nm, rect: s.rect, flags: s.flags ?? 4,
    colour: s.colour ?? null, interior: s.interior ?? null, opacity: s.opacity ?? null,
    borderWidth: s.borderWidth ?? null, dash: s.dash ?? null, cloud: s.cloud ?? null,
    line: s.line ?? null, lineEnds: s.lineEnds ?? null, vertices: s.vertices ?? null, ink: s.ink ?? null,
    quadPoints: s.quadPoints ?? null, callout: s.callout ?? null, inset: s.inset ?? null, intent: s.intent ?? null,
    contents: s.contents ?? null, author: s.author ?? null, modified: s.modified ?? null, created: s.created ?? null,
    defaultAppearance: s.defaultAppearance ?? null, defaultStyle: s.defaultStyle ?? null, quadding: s.quadding ?? null,
    name: s.icon ?? s.stampName ?? null, rotate: s.rotate ?? null, vellum: s.vellum ?? null, measured: !!s.measure,
  };
}

const spec7 = (m: Markup) => toSpec(m, A4);
const page = (f: Frame, annots: FileAnnot[]): PageAnnots => ({ page: 2, frame: f, annots });
const one = (f: Frame, a: FileAnnot) => fromFile(page(f, [a]), new Set())[0];

describe("Vellum's own annotations", () => {
  it("come back exactly as drawn, for every kind, on every page rotation", () => {
    const kinds = new Set(SAMPLES.map((m) => m.kind));
    for (const k of Object.keys(KINDS) as MarkupKind[]) if (!kindOf(k).fixed) expect(kinds.has(k), `a sample of ${k}`).toBe(true);
    for (const quarterTurns of [0, 1, 2, 3]) {
      const f: Frame = { quarterTurns, bbox: [10, 20, 605, 862] };
      for (const m of SAMPLES) {
        const got = one(f, readBack(toSpec(m, f)));
        expect(got.origin.exact, `${m.kind} at ${quarterTurns}`).toBe(true);
        expect(got.markup, `${m.kind} at ${quarterTurns}`).toEqual(m);
        expect(got.origin).toMatchObject({ page: 2, index: 0, nm: m.id });
      }
    }
  });

  it("keep a regular polygon's Sides through a save and reopen; another app's polygon is freeform (stage 6)", () => {
    const regular = { centre: [150, 150] as Pt, radius: 40, angle: 0.2, sides: 7 };
    const m = mk("polygon", { vertices: regularVertices(regular), regular });
    for (const quarterTurns of [0, 1, 2, 3]) {
      const f: Frame = { quarterTurns, bbox: [10, 20, 605, 862] };
      const got = one(f, readBack(toSpec(m, f))).markup;
      expect(got).toEqual(m);
      expect(kindOf("polygon").sides!(got as MarkupOf<"polygon">)).toBe(7);
    }
    // Changed by another app since: from the standard keys, so freeform.
    const other = one(A4, { ...readBack(toSpec(m, A4)), modified: "D:20261116090000Z" }).markup as MarkupOf<"polygon">;
    expect(other.vertices.length).toBe(7);
    expect(kindOf("polygon").sides!(other)).toBeNull();
    expect(spec7(m).vertices?.length).toBe(14); // still a plain /Vertices polygon for other apps
  });

  it("are mapped from the standard keys instead once another app has changed them", () => {
    for (const m of SAMPLES) {
      const a = { ...readBack(toSpec(m, A4)), modified: "D:20261116090000Z" };
      const got = one(A4, a);
      expect(got.origin.exact).toBe(false);
      expect(got.markup.id).toBe(m.id);
      expect(got.markup.meta.modified).toBe("2026-11-16T09:00:00.000Z");
    }
  });

  it("aren't trusted where the page has turned since they were written", () => {
    const m = SAMPLES[0];
    const a = readBack(toSpec(m, A4));
    // The same annotation on a page now turned a quarter: the entry's page points no longer fit.
    const got = one({ quarterTurns: 1, bbox: [0, 0, 595, 842] }, a);
    expect(got.origin.exact).toBe(false);
    expect(got.markup.kind).toBe("rect");
  });

  it("keep an image stamp's picture by hash, filled in from the file", () => {
    const m = mk("stamp", { rect: [100, 100, 160, 130], content: { type: "image", png: "iVBORw0KGgo=", hash: "ab".repeat(32), w: 2, h: 1 }, signature: true });
    const got = one(A4, readBack(toSpec(m, A4)));
    expect(got.origin.exact).toBe(true);
    expect(stampHashes([got.markup])).toEqual(["ab".repeat(32)]);
    const filled = withStampImages([got.markup], { ["ab".repeat(32)]: "PNGDATA" })[0];
    expect(filled).toMatchObject({ content: { type: "image", png: "PNGDATA", hash: "ab".repeat(32) } });
    expect(stampHashes([filled])).toEqual([]);
  });
});

describe("other apps' annotations", () => {
  const base = (over: Partial<FileAnnot>): FileAnnot => ({ ...readBack({ page: 0, nm: "", subtype: "Square", rect: [0, 0, 0, 0], appearance: { ops: "", bbox: [0, 0, 0, 0], opacity: null, fillOpacity: null, fonts: {} } }), nm: null, ...over });
  const close = (a: Pt, b: Pt) => {
    expect(a[0]).toBeCloseTo(b[0], 3);
    expect(a[1]).toBeCloseTo(b[1], 3);
  };

  it("map a square, its border inside its box, with colour, fill, dash and opacity", () => {
    const got = one(A4, base({ subtype: "Square", rect: [100, 600, 200, 700], borderWidth: 2, colour: [0, 0, 1], interior: [1, 1, 0], dash: [3, 1], opacity: 0.5, inset: [1, 1, 1, 1], author: "Pat", modified: "D:20261101120000+01'00'" }));
    expect(got.markup).toMatchObject({ kind: "rect", rect: [102, 144, 198, 240], style: { stroke: [0, 0, 1], fill: [1, 1, 0], width: 2, dash: [3, 1], opacity: 0.5 } });
    expect(got.markup.meta).toEqual({ author: "Pat", created: "2026-11-01T11:00:00.000Z", modified: "2026-11-01T11:00:00.000Z" });
    expect(got.origin).toMatchObject({ exact: false, nm: null, subtype: "Square" });
  });

  it("map lines with their ends, polylines, polygons and clouds", () => {
    const line = one(A4, base({ subtype: "Line", line: [100, 700, 200, 650], lineEnds: ["Circle", "ClosedArrow"] })).markup as MarkupOf<"arrow">;
    expect(line.kind).toBe("arrow");
    close(line.from, [100, 142]);
    close(line.to, [200, 192]);
    expect(line.style.ends).toEqual(["dot", "filled"]);
    expect((one(A4, base({ subtype: "Line", line: [0, 0, 1, 1], lineEnds: ["Diamond", "ROpenArrow"] })).markup as MarkupOf<"arrow">).style.ends).toEqual(["none", "open"]);
    expect(one(A4, base({ subtype: "PolyLine", vertices: [0, 0, 10, 10, 20, 0] })).markup.kind).toBe("polyline");
    expect(one(A4, base({ subtype: "Polygon", vertices: [0, 0, 10, 10, 20, 0] })).markup.kind).toBe("polygon");
    const cloud = one(A4, base({ subtype: "Polygon", vertices: [0, 0, 10, 10, 20, 0], cloud: 2 })).markup as MarkupOf<"cloud">;
    expect(cloud).toMatchObject({ kind: "cloud", intensity: 2 });
    expect(one(A4, base({ subtype: "Square", rect: [0, 0, 50, 50], cloud: 1 })).markup.kind).toBe("cloud");
    expect(one(A4, base({ subtype: "Circle", rect: [0, 0, 50, 50] })).markup.kind).toBe("ellipse");
  });

  it("map ink, text boxes and callouts, notes and text markups", () => {
    const ink = one(A4, base({ subtype: "Ink", ink: [[0, 842, 10, 832], [20, 822]] })).markup as MarkupOf<"ink">;
    expect(ink.strokes).toEqual([[[0, 0], [10, 10]], [[20, 20]]]);
    const text = one(A4, base({ subtype: "FreeText", rect: [100, 600, 300, 650], contents: "Hi", defaultAppearance: "0 0 1 rg /TiBo 14 Tf", quadding: 2, colour: [1, 1, 0.8] })).markup as MarkupOf<"text">;
    expect(text).toMatchObject({ kind: "text", text: "Hi", rect: [100, 192, 300, 242], textStyle: { size: 14, colour: [0, 0, 1], family: "times", bold: true, italic: false, align: "right" }, style: { fill: [1, 1, 0.8] } });
    const call = one(A4, base({ subtype: "FreeText", intent: "FreeTextCallout", rect: [100, 600, 300, 700], inset: [50, 0, 0, 50], callout: [100, 600, 120, 620, 150, 625], lineEnds: ["OpenArrow"], contents: "Look" })).markup as MarkupOf<"callout">;
    expect(call).toMatchObject({ kind: "callout", tip: [100, 242], elbow: [120, 222], rect: [150, 192, 300, 242], text: "Look", style: { ends: ["none", "open"] } });
    const note = one(A4, base({ subtype: "Text", rect: [100, 700, 120, 720], contents: "Ring me", colour: [0, 1, 0] })).markup as MarkupOf<"note">;
    expect(note).toMatchObject({ kind: "note", at: [100, 122], text: "Ring me", style: { stroke: [0, 1, 0] } });
    const hl = one(A4, base({ subtype: "Highlight", quadPoints: [100, 700, 200, 700, 100, 690, 200, 690], colour: [1, 1, 0] })).markup as MarkupOf<"textmark">;
    expect(hl).toMatchObject({ kind: "textmark", variant: "highlight", quads: [[[100, 142], [200, 142], [100, 152], [200, 152]]], style: { opacity: 1 } });
    expect((one(A4, base({ subtype: "Squiggly", quadPoints: [0, 0, 1, 0, 0, 1, 1, 1] })).markup as MarkupOf<"textmark">).variant).toBe("underline");
    expect((one(A4, base({ subtype: "StrikeOut", quadPoints: [0, 0, 1, 0, 0, 1, 1, 1] })).markup as MarkupOf<"textmark">).variant).toBe("strike");
  });

  it("keep a type Vellum doesn't understand as one that can only be moved", () => {
    for (const subtype of ["FileAttachment", "Stamp", "Caret", "Sound", "Redact", "3D"]) {
      const got = one(A4, base({ subtype, rect: [100, 700, 124, 720], contents: "x" }));
      expect(got.markup).toMatchObject({ kind: "foreign", subtype, rect: [100, 122, 124, 142], moved: [0, 0], text: "x" });
      expect(kindOf("foreign").fixed).toBe(true);
    }
    // Malformed geometry falls back to it too, rather than to a broken markup.
    expect(one(A4, base({ subtype: "Line", line: null })).markup.kind).toBe("foreign");
    expect(one(A4, base({ subtype: "Ink", ink: [] })).markup.kind).toBe("foreign");
  });

  it("follow the page's rotation and box origin", () => {
    const f: Frame = { quarterTurns: 1, bbox: [10, 20, 610, 820] };
    const line = one(f, base({ subtype: "Line", line: [110, 220, 210, 220] })).markup as MarkupOf<"arrow">;
    // A quarter turn clockwise: user x runs down the page, user y across it.
    close(line.from, [200, 100]);
    close(line.to, [200, 200]);
  });
});

describe("ids", () => {
  it("are the /NM where there is one, else made from the page and position, never twice", () => {
    const a = (index: number, nm: string | null): FileAnnot => ({ ...readBack(toSpec(SAMPLES[0], A4)), vellum: null, index, nm });
    const used = new Set<string>(["taken"]);
    const got = fromFile(page(A4, [a(0, "x"), a(1, null), a(2, "x"), a(3, "taken"), a(4, null)]), used).map((g) => g.markup.id);
    expect(got).toEqual(["x", "file-p2-a1", "file-p2-a2", "file-p2-a3", "file-p2-a4"]);
    expect(new Set(got).size).toBe(5);
    // The same file read again gives the same ids (a crash-recovery record refers to them).
    expect(fromFile(page(A4, [a(0, "x"), a(1, null), a(2, "x"), a(3, "taken"), a(4, null)]), new Set(["taken"])).map((g) => g.markup.id)).toEqual(got);
  });
});

describe("the lock", () => {
  const exact = { page: 0, index: 0, nm: "v", subtype: "Square", exact: true };
  const m = SAMPLES[0];
  it("leaves your own Vellum markups free to edit, and nothing else", () => {
    expect(freeToEdit(exact, m, "Matt James")).toBe(true);
    expect(freeToEdit(exact, m, " matt james ")).toBe(true);
    expect(freeToEdit(exact, m, "Pat Smith")).toBe(false);
    expect(freeToEdit(exact, m, "")).toBe(false);
    expect(freeToEdit({ ...exact, exact: false }, m, "Matt James")).toBe(false);
  });
});

describe("conversions", () => {
  it("read colours in grey, RGB and CMYK", () => {
    expect(colourOf([0.5])).toEqual([0.5, 0.5, 0.5]);
    expect(colourOf([1, 0, 0])).toEqual([1, 0, 0]);
    expect(colourOf([0, 1, 1, 0])).toEqual([1, 0, 0]);
    expect(colourOf([])).toBeNull();
    expect(colourOf(null)).toBeNull();
  });

  it("read PDF dates, with and without a time zone", () => {
    expect(parsePdfDate("D:20261115100000Z")).toBe("2026-11-15T10:00:00.000Z");
    expect(parsePdfDate("D:20261115100000-05'00'")).toBe("2026-11-15T15:00:00.000Z");
    expect(parsePdfDate("D:2026")).toBe("2026-01-01T00:00:00.000Z");
    expect(parsePdfDate("yesterday")).toBeNull();
    expect(parsePdfDate(null)).toBeNull();
  });

  it("read a text style from /DA", () => {
    expect(textStyleOf("0 g /Helv 9 Tf", 0)).toMatchObject({ size: 9, colour: [0, 0, 0], family: "helvetica", bold: false, align: "left" });
    expect(textStyleOf("/Cour 8 Tf 1 0 0 rg", 1)).toMatchObject({ size: 8, colour: [1, 0, 0], family: "courier", align: "center" });
    expect(textStyleOf("/Helvetica-BoldOblique 10 Tf", null)).toMatchObject({ bold: true, italic: true });
    expect(textStyleOf(null, null)).toMatchObject({ size: 10, family: "helvetica" });
  });
});

describe("ids across pages", () => {
  it("stay unique when another app used one /NM on two pages", () => {
    const a = (nm: string): FileAnnot => ({ ...readBack(toSpec(SAMPLES[0], A4)), vellum: null, index: 0, nm });
    const used = new Set<string>();
    const ids = [fromFile({ page: 0, frame: A4, annots: [a("dup")] }, used), fromFile({ page: 1, frame: A4, annots: [a("dup")] }, used)].flat().map((x) => x.markup.id);
    expect(ids).toEqual(["dup", "file-p1-a0"]);
  });
});
