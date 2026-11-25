import { describe, expect, it } from "vitest";
import { type FileInfo, copyName, forbidsComments, recoveryKey, saveConfirmation, unsavedMessage } from "./save";
import { sanitisePrefs, confirm, styleFor, defaultPrefs } from "../markup/prefs";

const plain: FileInfo = { bytes: 1, objects: 1, pages: 1, xrefStream: false, encryption: null, permissions: null, recovered: false, signatures: 0, docmdp: null, loadMs: 1 };

describe("first-save confirmation", () => {
  it("says an ordinary save appends and changes nothing else", () => {
    const c = saveConfirmation("plan.pdf", plain);
    expect(c.kind).toBe("append");
    expect(c.message).toContain("nothing already in it changes");
    expect(c.warnings).toEqual([]);
    expect(c.note).toBeNull();
  });

  it("says a malformed file is rewritten", () => {
    const c = saveConfirmation("plan.pdf", { ...plain, recovered: true });
    expect(c.kind).toBe("rewrite");
    expect(c.message).toContain("This file has errors; saving rewrites it.");
  });

  it("warns about certified files and files that forbid comments, and notes signatures", () => {
    expect(saveConfirmation("a.pdf", { ...plain, signatures: 1, docmdp: 2 }).warnings[0]).toContain("form filling only");
    expect(saveConfirmation("a.pdf", { ...plain, signatures: 1, docmdp: 1 }).warnings[0]).toContain("no changes allowed");
    const allowed = saveConfirmation("a.pdf", { ...plain, signatures: 1, docmdp: 3 });
    expect(allowed.warnings).toEqual([]);
    expect(allowed.note).toContain("signature stays valid");
    const locked = { ...plain, encryption: "V5 R6", permissions: -1068 };
    expect(forbidsComments(locked)).toBe(true);
    expect(forbidsComments({ ...locked, permissions: -1028 })).toBe(false);
    expect(saveConfirmation("a.pdf", locked).warnings[0]).toContain("comments shouldn't be added");
  });
});

describe("keys and names", () => {
  it("makes recovery keys that are safe file names and differ per file", () => {
    const a = recoveryKey("c:/drawings/a.pdf");
    expect(a).toMatch(/^m-[0-9a-f]{16}$/);
    expect(recoveryKey("c:/drawings/b.pdf")).not.toBe(a);
    expect(recoveryKey("c:/drawings/a.pdf")).toBe(a);
  });

  it("asks about unsaved files by name", () => {
    expect(unsavedMessage(["a.pdf"])).toBe("Save your markups on a.pdf before closing?");
    expect(unsavedMessage(["a", "b", "c", "d", "e", "f"])).toContain("6 files have unsaved markups: a, b, c and 3 more");
  });

  it("suggests a name for a copy", () => {
    expect(copyName("C:\\x\\Stage plan.PDF")).toBe("Stage plan (marked up).pdf");
    expect(copyName("C:/x/scan")).toBe("scan (marked up).pdf");
  });
});

describe("markup preferences", () => {
  it("keeps good values and drops bad ones", () => {
    const p = sanitisePrefs({
      styles: { rect: { stroke: [0, 0, 1], width: 3, fill: null, opacity: 0.5, dash: [4, 3] }, arrow: { stroke: [9, 9, 9], width: -1 } },
      text: { size: 1000, colour: [1, 0, 0] },
      confirmed: ["a", 3, "b"],
      author: "  Crew lead  ",
    });
    expect(p.styles.rect).toEqual({ stroke: [0, 0, 1], width: 3, fill: null, opacity: 0.5, fillOpacity: 0.5, dash: [4, 3] });
    expect(p.styles.arrow!.stroke).toEqual(styleFor(defaultPrefs(), "arrow").stroke);
    expect(p.texts.text!.size).toBe(10);
    expect(p.texts.text!.colour).toEqual([1, 0, 0]);
    expect(p.confirmed).toEqual(["a", "b"]);
    expect(p.author).toBe("Crew lead");
    expect(sanitisePrefs("rubbish")).toEqual(defaultPrefs());
  });

  it("remembers confirmed files once each", () => {
    const p = confirm(confirm(defaultPrefs(), "a"), "a");
    expect(p.confirmed).toEqual(["a"]);
  });
});

// Existing annotations (phase 7b)
import { forbidsChanges, unlockWarnings, winAnsiNote } from "./save";
import { outsideWinAnsi } from "../markup/fonts";

describe("unlocking Edit file", () => {
  it("goes ahead without a word on an ordinary file", () => {
    expect(unlockWarnings("plan.pdf", plain)).toEqual([]);
    expect(unlockWarnings("plan.pdf", null)).toEqual([]);
  });

  it("says so if the file is signed, certified, or asks not to be changed", () => {
    expect(unlockWarnings("a.pdf", { ...plain, signatures: 1 })[0]).toContain("a.pdf is signed");
    expect(unlockWarnings("a.pdf", { ...plain, signatures: 1, docmdp: 1 })[0]).toContain("certified (no changes allowed)");
    expect(unlockWarnings("a.pdf", { ...plain, signatures: 1, docmdp: 2 })).toHaveLength(1);
    // /P without "modify" (8) or without "comments" (32).
    const all = -4;
    expect(forbidsChanges({ ...plain, encryption: "V2 R3", permissions: all })).toBe(false);
    expect(forbidsChanges({ ...plain, encryption: "V2 R3", permissions: all & ~8 })).toBe(true);
    expect(forbidsChanges({ ...plain, encryption: "V2 R3", permissions: all & ~32 })).toBe(true);
    expect(forbidsChanges({ ...plain, permissions: 0 })).toBe(false); // not encrypted: no permissions apply
    expect(unlockWarnings("a.pdf", { ...plain, encryption: "V2 R3", permissions: all & ~8 })).toEqual(["a.pdf's permissions ask for it not to be changed."]);
  });
});

describe("text other PDF apps can't show (review 0.2.0, 12)", () => {
  const add = (subtype: string, contents: string) => ({ op: "add", spec: { subtype, contents } });
  it("names the characters a save draws as ? for other apps", () => {
    expect(winAnsiNote([add("FreeText", "Δ 5 mm ≥ 3 → Ø ✓ Δ")])).toBe('Other PDF apps show Δ ≥ → ✓ as "?" in these markups; Vellum shows them as typed.');
    expect(outsideWinAnsi("Café £5 – “ok” ½")).toEqual([]);
  });
  it("says nothing for plain text, or for text that's never drawn (a note, a highlight's comment)", () => {
    expect(winAnsiNote([add("FreeText", "Check the bolts, 25 °C")])).toBeNull();
    expect(winAnsiNote([add("Text", "Δ"), add("Highlight", "Ω"), { op: "delete" }])).toBeNull();
  });
  it("keeps the list short", () => {
    expect(winAnsiNote([add("FreeText", "αβγδεζ")])).toContain("α β γ δ ε …");
  });
});
