// The Markups tab's list: grouping by page, the order on each page, each row's text, the seam
// for a kind's own words (measurements), and short dates.

import { describe, expect, it } from "vitest";
import { type Markup, type MarkupKind, type MarkupOf, defaultStyle } from "./types";
import { LIST_TEXT, listDate, listText, markupPages, rowFor } from "./listing";

const meta = { author: "Matt", created: "2026-11-15T10:00:00Z", modified: "2026-11-15T10:30:00Z" };
let n = 0;
function mk<K extends MarkupKind>(kind: K, page: number, shape: Record<string, unknown>): MarkupOf<K> {
  return { id: `m${++n}`, page, kind, style: defaultStyle(kind), meta, ...shape } as unknown as MarkupOf<K>;
}
const rect = (page: number, x: number, y: number) => mk("rect", page, { rect: [x, y, x + 20, y + 10] });

describe("markupPages", () => {
  it("groups by page in page order, each page top to bottom then left to right", () => {
    const a = rect(2, 50, 300);
    const b = rect(0, 400, 100);
    const c = rect(2, 10, 40);
    const d = rect(0, 100, 100);
    const e = rect(2, 200, 40);
    const pages = markupPages([a, b, c, d, e]);
    expect(pages.map((p) => p.page)).toEqual([0, 2]);
    expect(pages[0].rows.map((r) => r.id)).toEqual([d.id, b.id]);
    expect(pages[1].rows.map((r) => r.id)).toEqual([c.id, e.id, a.id]);
  });

  it("is empty with no markups", () => {
    expect(markupPages([])).toEqual([]);
  });
});

describe("rows", () => {
  it("name the type, carry the author and the time it was changed, and an icon", () => {
    const r = rowFor(rect(0, 0, 0));
    expect(r.label).toBe("Rectangle");
    expect(r.author).toBe("Matt");
    expect(r.modified).toBe(meta.modified);
    expect(r.icon).toContain("<rect");
    expect(r.text).toBe("");
  });

  it("show what a text box, callout or note says, on one line and cut short", () => {
    expect(listText(mk("text", 0, { rect: [0, 0, 100, 20], text: "Two\nlines", textStyle: { size: 10, colour: [0, 0, 0] } }))).toBe("Two lines");
    expect(listText(mk("note", 0, { at: [0, 0], text: "x".repeat(300) })).length).toBe(160);
    const tm = mk("textmark", 0, { variant: "strike", quads: [[[0, 0], [10, 0], [0, 10], [10, 10]]], text: "old wording" });
    expect(listText(tm)).toBe("“old wording”");
    expect(rowFor(tm).label).toBe("Strike through");
    expect(rowFor(tm).icon).toContain("M2.5 8h11");
  });

  it("show a kind's own words where one is registered (a measurement's values)", () => {
    LIST_TEXT.rect = (m: Markup) => `${m.kind}: 2.40 m x 1.20 m`;
    try {
      expect(listText(rect(0, 0, 0))).toBe("rect: 2.40 m x 1.20 m");
    } finally {
      delete LIST_TEXT.rect;
    }
  });
});

describe("listDate", () => {
  const now = new Date(2026, 10, 15, 16, 0);
  it("gives the time today, the day and month this year, and the year before that", () => {
    expect(listDate(new Date(2026, 10, 15, 9, 5).toISOString(), now)).toBe("09:05");
    expect(listDate(new Date(2026, 2, 3, 9, 5).toISOString(), now)).toBe("3 Mar");
    expect(listDate(new Date(2025, 11, 31).toISOString(), now)).toBe("31 Dec 2025");
    expect(listDate("nonsense", now)).toBe("");
  });

  // Measuring
  it("show a measurement's two values", () => {
    const m = mk("measureLength", 0, { from: [100, 100], to: [200, 100], scale: 100, userUnit: 1, fmt: { units: "auto", decimals: 2 }, labelSize: 8 });
    const text = listText(m);
    expect(text).toContain("at 1:100");
    expect(text).toContain("on paper");
  });
});

// Existing annotations (phase 7b)
describe("the file's annotations in the list", () => {
  it("are listed with the rest, marked locked where the lock says so, and name a type Vellum can only move", () => {
    const att = { ...mk("foreign", 0, { subtype: "FileAttachment", rect: [0, 50, 20, 70], moved: [0, 0], text: "spec.xlsx" }) };
    const pages = markupPages([rect(0, 0, 0), att], (m) => m.kind === "foreign");
    const rows = pages[0].rows;
    expect(rows.map((r) => [r.label, r.locked])).toEqual([["Rectangle", false], ["File attachment", true]]);
    expect(rows[1].text).toBe("spec.xlsx");
    expect(markupPages([rect(0, 0, 0)])[0].rows[0].locked).toBe(false);
  });
});
