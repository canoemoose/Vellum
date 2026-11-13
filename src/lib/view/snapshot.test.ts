import { describe, expect, it } from "vitest";
import { SNAPSHOT_MAX_SIDE, snapshotSize } from "./snapshot";

describe("snapshotSize", () => {
  it("shrinks the longer side to the limit and keeps the aspect ratio", () => {
    expect(snapshotSize(2000, 1000, 500)).toEqual({ w: 500, h: 250 });
    expect(snapshotSize(1000, 2000, 500)).toEqual({ w: 250, h: 500 });
  });

  it("never enlarges a small canvas", () => {
    expect(snapshotSize(300, 200, 500)).toEqual({ w: 300, h: 200 });
  });

  it("keeps a very thin canvas at least a pixel across", () => {
    expect(snapshotSize(10000, 2, 500)).toEqual({ w: 500, h: 1 });
  });

  it("gives nothing for an empty or broken size", () => {
    expect(snapshotSize(0, 100)).toBeNull();
    expect(snapshotSize(100, -1)).toBeNull();
    expect(snapshotSize(Number.NaN, 100)).toBeNull();
    expect(snapshotSize(Infinity, 100)).toBeNull();
  });

  it("defaults to the card's limit", () => {
    expect(snapshotSize(4000, 2000)).toEqual({ w: SNAPSHOT_MAX_SIDE, h: SNAPSHOT_MAX_SIDE / 2 });
  });
});
