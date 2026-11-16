// Fields in a text stamp's wording (Matt's review of the stamp picker): {author}, {date},
// {time}, {file} and {page}, filled in when the stamp is placed; \{ and \} for braces as typed.

import { describe, expect, it } from "vitest";
import { DEFAULT_LINE, type FieldValues, cleanLabel, fillFields, filledStamp, hasFields, lineOf, sanitiseOwnTexts, sanitiseStampPrefs, subFor, withLine } from "./stamps";

const v: FieldValues = { author: "Matt James", now: new Date(2026, 10, 15, 9, 5), file: "GA-101 rev C.pdf", page: 3 };

describe("stamp fields", () => {
  it("fills in each field, in any case", () => {
    expect(fillFields(DEFAULT_LINE, v)).toBe("Matt James, 15 Nov 2026");
    expect(fillFields("{time} {DATE}", v)).toBe("09:05 15 Nov 2026");
    expect(fillFields("{file} p{page}", v)).toBe("GA-101 rev C.pdf p3");
  });

  it("drops an empty field's separator, so no author doesn't leave a stray comma", () => {
    expect(fillFields(DEFAULT_LINE, { ...v, author: "" })).toBe("15 Nov 2026");
    expect(fillFields("{date}, {author}", { ...v, author: " " })).toBe("15 Nov 2026");
    expect(fillFields("{author}, {file}, {date}", { ...v, file: "" })).toBe("Matt James, 15 Nov 2026");
  });

  it("leaves braces that aren't a field as typed, and takes \\{ and \\} as braces", () => {
    expect(fillFields("{drawing} by {author}", v)).toBe("{drawing} by Matt James");
    expect(fillFields("\\{author\\} is {author}", v)).toBe("{author} is Matt James");
  });

  it("knows when wording holds a field", () => {
    expect(hasFields("APPROVED")).toBe(false);
    expect(hasFields("CHECKED {DATE}")).toBe(true);
  });

  it("places a stamp with its fields filled in, the main line in capitals, an empty second line dropped", () => {
    const c = { type: "text" as const, label: cleanLabel("checked {author}"), sub: "{page}", colour: [0, 0, 0] as [number, number, number] };
    expect(filledStamp(c, v)).toMatchObject({ label: "CHECKED MATT JAMES", sub: "3" });
    expect(filledStamp(c, { ...v, page: null }).sub).toBeNull();
    expect(filledStamp({ ...c, sub: null }, v).sub).toBeNull();
  });

  it("keeps the wording with its fields, to be filled in again later, and only where there were fields", () => {
    const c = { type: "text" as const, label: "CHECKED", sub: "{author}, {date}", colour: [0, 0, 0] as [number, number, number] };
    const placed = filledStamp(c, v);
    expect(placed.fields).toEqual({ label: "CHECKED", sub: "{author}, {date}" });
    // Filled again a day later: the new date, from the kept wording.
    const later = filledStamp(placed, { ...v, now: new Date(2026, 10, 16) });
    expect(later.sub).toBe("Matt James, 16 Nov 2026");
    expect(later.fields).toEqual(placed.fields);
    expect(filledStamp({ ...c, sub: "As built" }, v).fields).toBeUndefined();
  });

  it("remembers the second line's wording, starting with the author and date", () => {
    expect(sanitiseStampPrefs({}).line).toBe(DEFAULT_LINE);
    expect(sanitiseStampPrefs({ line: "  Checked   {date} " }).line).toBe("Checked {date}");
    expect(sanitiseStampPrefs({ line: 42 }).line).toBe(DEFAULT_LINE);
  });
});

describe("your own text stamps (Matt's review: a list)", () => {
  it("keeps them tidied, in order, none twice, none built in, none empty", () => {
    const red: [number, number, number] = [0.85, 0.1, 0.1];
    expect(sanitiseOwnTexts([{ label: " checked ", colour: [0, 0, 1] }, { label: "CHECKED" }, { label: "approved" }, { label: "" }, { label: "as built" }, 5])).toEqual([
      { label: "CHECKED", colour: [0, 0, 1] },
      { label: "AS BUILT", colour: red },
    ]);
    expect(sanitiseOwnTexts(Array.from({ length: 60 }, (_, i) => ({ label: `S${i}` }))).length).toBe(40);
  });

  it("takes the old single remembered wording as the first", () => {
    expect(sanitiseStampPrefs({ custom: "not for construction" }).texts).toEqual([{ label: "NOT FOR CONSTRUCTION", colour: [0.85, 0.1, 0.1] }]);
    expect(sanitiseStampPrefs({ custom: "x", texts: [] }).texts).toEqual([]);
  });
});

describe("each stamp's own second line (Matt's review)", () => {
  const prefs = () => sanitiseStampPrefs({ texts: [{ label: "AS BUILT" }] });

  it("takes the default until a stamp has its own, and an empty one goes back to the default", () => {
    const p0 = prefs();
    expect(subFor(p0, "APPROVED")).toBe(DEFAULT_LINE);
    expect(subFor(p0, "AS BUILT")).toBe(DEFAULT_LINE);
    const p1 = withLine(withLine(p0, "AS BUILT", { line: "{date}" }), "APPROVED", { line: "Site: {author}" });
    expect(subFor(p1, "AS BUILT")).toBe("{date}");
    expect(subFor(p1, "APPROVED")).toBe("Site: {author}");
    expect(subFor(p1, "FOR COMMENT")).toBe(DEFAULT_LINE);
    expect(lineOf(withLine(p1, "AS BUILT", { line: "  " }), "AS BUILT")).toEqual({ on: true, own: "", wording: DEFAULT_LINE });
  });

  it("is on or off for each stamp on its own", () => {
    const p = withLine(prefs(), "FOR COMMENT", { sub: false });
    expect(subFor(p, "FOR COMMENT")).toBeNull();
    expect(subFor(p, "APPROVED")).toBe(DEFAULT_LINE);
    expect(subFor(withLine(p, "AS BUILT", { sub: false }), "AS BUILT")).toBeNull();
  });

  it("is kept with the settings, and nothing for a stamp that isn't one", () => {
    const p = withLine(withLine(prefs(), "AS BUILT", { sub: false, line: "{date}" }), "APPROVED", { line: "x {page}" });
    const again = sanitiseStampPrefs(JSON.parse(JSON.stringify(p)));
    expect(again.texts[0]).toMatchObject({ label: "AS BUILT", sub: false, line: "{date}" });
    expect(again.builtIn).toEqual({ APPROVED: { line: "x {page}" } });
    expect(withLine(p, "NOT A STAMP", { sub: false })).toBe(p);
  });
});
