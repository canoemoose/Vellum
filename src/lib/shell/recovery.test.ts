import { describe, expect, it } from "vitest";
import { RecoveryRecords, restoreTarget } from "./recovery";

function setup() {
  const log: string[] = [];
  const r = new RecoveryRecords({ write: (k) => void log.push(`write ${k}`), remove: (k) => void log.push(`delete ${k}`) });
  return { r, log };
}

describe("crash recovery records (review 0.2.0, 2)", () => {
  it("leaves a crash's record alone while the reopened tab is clean", () => {
    const { r, log } = setup();
    // Opening the file attaches its tab, which counts as a change: the tab is clean.
    r.keep("m-a", false, () => "{}");
    r.keep("m-a", false, () => "{}");
    expect(log).toEqual([]);
  });

  it("writes unsaved markups, and deletes its own record once they're undone", () => {
    const { r, log } = setup();
    r.keep("m-a", true, () => "{}");
    expect(r.wrote("m-a")).toBe(true);
    r.keep("m-a", false, () => "{}");
    expect(log).toEqual(["write m-a", "delete m-a"]);
    // Once gone it isn't deleted again (a later record from a crash elsewhere is left alone).
    r.keep("m-a", false, () => "{}");
    expect(log).toEqual(["write m-a", "delete m-a"]);
  });

  it("deletes any record when told to (Discard, Don't save, saved)", () => {
    const { r, log } = setup();
    r.drop("m-b");
    r.keep("m-c", true, () => "{}");
    r.drop("m-c");
    r.keep("m-c", false, () => "{}");
    expect(log).toEqual(["delete m-b", "write m-c", "delete m-c"]);
  });

  it("restores into the tab even when it's no longer on the canvas, or keeps the record", () => {
    expect(restoreTarget({ exists: true, active: true, docOpen: true, read: true })).toBe("here");
    expect(restoreTarget({ exists: true, active: true, docOpen: true, read: false })).toBe("here");
    expect(restoreTarget({ exists: true, active: false, docOpen: true, read: true })).toBe("background");
    expect(restoreTarget({ exists: true, active: false, docOpen: true, read: false })).toBe("keep");
    expect(restoreTarget({ exists: false, active: false, docOpen: false, read: true })).toBe("keep");
  });
});
