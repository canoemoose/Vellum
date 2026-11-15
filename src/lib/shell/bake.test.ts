// The bake question on the first save after placing signatures, which markups it's about, the
// save's changes with the chosen ones baked in, and forgetting baked ones from the undo
// history. Also the Stamp picker's remembered settings.

import { describe, expect, it } from "vitest";
import { bakeQuestion, newSignatureIds, withBakes } from "./save";
import { History } from "../markup/history";
import type { Markup } from "../markup/types";
import { refOf, sanitiseStampPrefs, textFromRef } from "../markup/stamps";
import { sanitiseSettings } from "../settings";

describe("the bake question", () => {
  it("offers keeping movable first, says baking can't be undone once saved", () => {
    const q = bakeQuestion(1, false);
    expect(q.title).toBe("Bake in the signature?");
    expect([q.keep, q.bake]).toEqual(["Keep movable", "Bake in"]);
    expect(q.message).toMatch(/the signature you placed into the page,/);
    expect(q.message).toMatch(/can't be moved or lifted off; once saved, that can't be undone/);
    expect(q.message).toMatch(/it stays a stamp/);
  });

  it("counts several and names the copy", () => {
    const q = bakeQuestion(3, true);
    expect(q.title).toBe("Bake in 3 signatures?");
    expect(q.message).toMatch(/the 3 signatures you placed into the copy's page, or keep them movable/);
    expect(q.message).toMatch(/they become part of the drawing/);
  });

  it("is about signatures placed since the last save only", () => {
    const saved = [{ id: "old-sig" }];
    const now = [
      { id: "old-sig", kind: "stamp", signature: true },
      { id: "new-sig", kind: "stamp", signature: true },
      { id: "approved", kind: "stamp", signature: false },
      { id: "box", kind: "rect" },
    ];
    expect(newSignatureIds(saved, now)).toEqual(["new-sig"]);
    expect(newSignatureIds([], [{ id: "box", kind: "rect" }])).toEqual([]);
  });
});

describe("baked changes", () => {
  const spec = (nm: string) => ({ nm, page: 0 });
  it("turn the chosen additions into bakes and leave the rest", () => {
    const changes = [
      { op: "add", spec: spec("sig") },
      { op: "add", spec: spec("box") },
      { op: "replace", spec: spec("sig2") },
      { op: "delete", page: 0, nm: "gone" },
    ];
    expect(withBakes(changes, new Set(["sig", "sig2"]))).toEqual([
      { op: "bake", spec: spec("sig") },
      { op: "add", spec: spec("box") },
      { op: "replace", spec: spec("sig2") },
      { op: "delete", page: 0, nm: "gone" },
    ]);
    expect(withBakes(changes, new Set())).toBe(changes);
  });
});

describe("forgetting baked markups", () => {
  const m = (id: string) => ({ id }) as unknown as Markup;
  it("takes them out of the present, the past and the future", () => {
    const a = m("a"), sig = m("sig"), b = m("b");
    const h = new History([]);
    h.push([a]);
    h.push([a, sig]);
    h.push([a, sig, b]);
    h.undo(); // future holds [a, sig, b]
    h.forget(new Set(["sig"]));
    expect(h.present.map((x) => x.id)).toEqual(["a"]);
    h.redo();
    expect(h.present.map((x) => x.id)).toEqual(["a", "b"]);
    h.undo();
    h.undo();
    expect(h.present.map((x) => x.id)).toEqual(["a"]);
    h.undo();
    expect(h.present).toEqual([]);
    // Nothing to forget: the lists are left as they were.
    const before = h.present;
    h.forget(new Set());
    expect(h.present).toBe(before);
  });
});

describe("the Stamp picker's settings", () => {
  it("default to a second line in each stamp's own colour", () => {
    expect(sanitiseStampPrefs(undefined)).toEqual({ sub: true, colour: null, custom: "", last: {} });
    expect(sanitiseSettings({}).stamps).toEqual({ sub: true, colour: null, custom: "", last: {} });
  });
  it("keep good values and drop odd ones", () => {
    expect(sanitiseStampPrefs({ sub: false, colour: [0, 0.5, 1], custom: " checked  " })).toEqual({ sub: false, colour: [0, 0.5, 1], custom: "CHECKED", last: {} });
    expect(sanitiseStampPrefs({ colour: [2, 0, 0], custom: 5 })).toEqual({ sub: true, colour: null, custom: "", last: {} });
  });
  // Stage 8: picking the tool goes straight to placing what it last placed.
  it("remember the last stamp and signature by reference only", () => {
    const last = { stamp: { type: "text", label: " for  comment ", colour: [0, 0, 1] }, signature: "18a2b3c40001" };
    expect(sanitiseStampPrefs({ last }).last).toEqual({ stamp: { type: "text", label: "FOR COMMENT", colour: [0, 0, 1] }, signature: "18a2b3c40001" });
    expect(sanitiseStampPrefs({ last: { stamp: { type: "image", id: "abc123" } } }).last).toEqual({ stamp: { type: "image", id: "abc123" } });
    // Anything that isn't a reference (a picture, strokes, a path) is dropped.
    expect(sanitiseStampPrefs({ last: { stamp: { type: "image", png: "iVBOR" }, signature: { strokes: [[1, 2]] } } }).last).toEqual({});
    expect(sanitiseStampPrefs({ last: { stamp: { type: "image", id: "../../x" }, signature: "C:\\sig.png" } }).last).toEqual({});
    expect(sanitiseStampPrefs({ last: { stamp: { type: "text", label: "OK", colour: [3, 0, 0] } } }).last).toEqual({});
  });
  it("turn a picked stamp into its reference: text by wording and colour, an image by id", () => {
    expect(refOf({ type: "text", label: "APPROVED", sub: "x", colour: [0, 1, 0] })).toEqual({ type: "text", label: "APPROVED", colour: [0, 1, 0] });
    const img = { type: "image", png: "iVBOR", hash: "ab", w: 1, h: 1 } as const;
    expect(refOf(img, "abc")).toEqual({ type: "image", id: "abc" });
    // A picture with no library id (the Image tool's, a pasted one) isn't remembered.
    expect(refOf(img)).toBeUndefined();
    expect(JSON.stringify(refOf(img, "abc"))).not.toContain("iVBOR");
    expect(textFromRef({ type: "text", label: "APPROVED", colour: [0, 1, 0] }, null)).toEqual({ type: "text", label: "APPROVED", sub: null, colour: [0, 1, 0] });
  });
});
