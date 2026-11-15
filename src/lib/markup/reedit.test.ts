// Vellum's private re-edit entry: written into every spec, and trusted back only when the
// annotation hasn't changed since.

import { describe, expect, it } from "vitest";
import { type Markup, defaultStyle } from "./types";
import { toSpec } from "./spec";
import { REEDIT_VERSION, readReedit, reeditEntry } from "./reedit";
import type { Frame } from "./pdf";

const A4: Frame = { quarterTurns: 0, bbox: [0, 0, 595, 842] };
const meta = { author: "Tester", created: "2026-11-15T10:00:00Z", modified: "2026-11-15T10:30:00Z" };
const box = { id: "vellum-1", page: 0, kind: "text", rect: [100, 100, 260, 130], text: "Check (this) bolt, 5° off", textStyle: { size: 10, colour: [0, 0, 0] }, style: defaultStyle("text"), meta } as Markup;

describe("the re-edit entry", () => {
  it("is in every spec, with the version, the spec's own /M and the whole markup", () => {
    const spec = toSpec(box, A4);
    const e = JSON.parse(spec.vellum!);
    expect(e.v).toBe(REEDIT_VERSION);
    expect(e.m).toBe(spec.modified);
    expect(e.markup).toEqual(box);
  });

  it("reads back to the markup while /M matches", () => {
    const raw = reeditEntry(box);
    expect(readReedit(raw, "D:20261115103000Z")).toEqual(box);
  });

  it("is ignored once another app has changed the annotation, or if it can't be read", () => {
    const raw = reeditEntry(box);
    expect(readReedit(raw, "D:20261116090000Z")).toBeNull();
    expect(readReedit(raw, null)).toBeNull();
    expect(readReedit(null, "D:20261115103000Z")).toBeNull();
    expect(readReedit("{not json", "D:20261115103000Z")).toBeNull();
    expect(readReedit(JSON.stringify({ v: REEDIT_VERSION + 1, m: "D:20261115103000Z", markup: {} }), "D:20261115103000Z")).toBeNull();
  });
});
