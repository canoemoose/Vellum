import { describe, expect, it } from "vitest";
import {
  afterCheck, afterLater, CHECK_INTERVAL_MS, compareVersions, HANDOVER_MAX_AGE_MS, handoverOrder, isNewer, lastCheckedText,
  makeHandover, NO_MEMORY, parseVersion, progressPercent, readHandover, readUpdate, sanitiseMemory, shouldAnnounce,
  shouldAutoCheck, stateText,
} from "./update";

const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

describe("parseVersion", () => {
  it("reads releases, pre-releases and a leading v", () => {
    expect(parseVersion("0.1.2")).toEqual({ major: 0, minor: 1, patch: 2, pre: [] });
    expect(parseVersion("v1.20.3")).toEqual({ major: 1, minor: 20, patch: 3, pre: [] });
    expect(parseVersion("0.2.0-rc1")?.pre).toEqual(["rc1"]);
    expect(parseVersion("0.2.0-beta.2+build5")?.pre).toEqual(["beta", "2"]);
  });
  it("refuses anything that isn't a version", () => {
    for (const bad of ["", "1.2", "1.2.3.4", "latest", "1.2.x", "1.2.3-", "1.2.3-a..b", "<script>", null, undefined, 12, {}]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe("version order", () => {
  const sorted = ["0.1.0", "0.1.1-alpha", "0.1.1-alpha.1", "0.1.1-rc1", "0.1.1-rc2", "0.1.1", "0.1.2", "0.1.10", "0.2.0", "1.0.0"];
  it("sorts the way semantic versions do", () => {
    const shuffled = [...sorted].reverse();
    shuffled.sort((a, b) => compareVersions(parseVersion(a)!, parseVersion(b)!));
    expect(shuffled).toEqual(sorted);
  });
  it("compares numbers as numbers, not text", () => {
    expect(isNewer("0.1.10", "0.1.9")).toBe(true);
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("0.1.1-rc10", "0.1.1-rc9")).toBe(false); // one identifier, compared as text: use rc.10
    expect(isNewer("0.1.1-rc.10", "0.1.1-rc.9")).toBe(true);
  });
  it("a release is newer than its pre-releases, and a pre-release is newer than the release before", () => {
    expect(isNewer("0.1.1", "0.1.1-rc1")).toBe(true);
    expect(isNewer("0.1.1-rc1", "0.1.1")).toBe(false);
    expect(isNewer("0.1.1-rc1", "0.1.0")).toBe(true);
  });
  it("the same version, an older one, or rubbish is never newer", () => {
    expect(isNewer("0.1.1", "0.1.1")).toBe(false);
    expect(isNewer("v0.1.1", "0.1.1")).toBe(false);
    expect(isNewer("0.1.0", "0.1.1")).toBe(false);
    expect(isNewer("rubbish", "0.1.1")).toBe(false);
    expect(isNewer("0.1.2", "rubbish")).toBe(false);
  });
});

describe("readUpdate (what a check reported)", () => {
  it("accepts a newer version and drops a leading v", () => {
    expect(readUpdate({ version: "0.1.2", body: "notes" }, "0.1.1")).toEqual({ version: "0.1.2" });
    expect(readUpdate({ version: "v0.2.0" }, "0.1.1")).toEqual({ version: "0.2.0" });
  });
  it("refuses a malformed reply", () => {
    for (const bad of [null, undefined, "0.1.2", 5, [], {}, { version: null }, { version: 2 }, { version: "" }, { version: "newest" }, { version: "0.1" }]) {
      expect(readUpdate(bad, "0.1.1")).toBeNull();
    }
  });
  it("never offers the running version or a downgrade", () => {
    expect(readUpdate({ version: "0.1.1" }, "0.1.1")).toBeNull();
    expect(readUpdate({ version: "0.1.0" }, "0.1.1")).toBeNull();
    expect(readUpdate({ version: "0.1.2-rc1" }, "0.1.2")).toBeNull();
  });
  it("refuses when the running version can't be read", () => {
    expect(readUpdate({ version: "0.1.2" }, "")).toBeNull();
  });
});

describe("sanitiseMemory", () => {
  it("keeps what's valid", () => {
    expect(sanitiseMemory({ lastCheck: NOW, later: "0.1.2" })).toEqual({ lastCheck: NOW, later: "0.1.2" });
  });
  it("falls back for anything odd", () => {
    expect(sanitiseMemory(null)).toEqual(NO_MEMORY);
    expect(sanitiseMemory("x")).toEqual(NO_MEMORY);
    expect(sanitiseMemory({ lastCheck: "yesterday", later: 3 })).toEqual(NO_MEMORY);
    expect(sanitiseMemory({ lastCheck: NaN, later: "soon" })).toEqual(NO_MEMORY);
    expect(sanitiseMemory({ lastCheck: -5 })).toEqual(NO_MEMORY);
  });
});

describe("shouldAutoCheck", () => {
  const base = { enabled: true, bench: false, dev: false, lastCheck: null, now: NOW };
  it("checks on the first ever start", () => {
    expect(shouldAutoCheck(base)).toBe(true);
  });
  it("checks at most once a day", () => {
    expect(shouldAutoCheck({ ...base, lastCheck: NOW - 1000 })).toBe(false);
    expect(shouldAutoCheck({ ...base, lastCheck: NOW - 23 * HOUR })).toBe(false);
    expect(shouldAutoCheck({ ...base, lastCheck: NOW - CHECK_INTERVAL_MS })).toBe(true);
    expect(shouldAutoCheck({ ...base, lastCheck: NOW - 72 * HOUR })).toBe(true);
  });
  it("checks again if the clock has gone backwards", () => {
    expect(shouldAutoCheck({ ...base, lastCheck: NOW + 5 * HOUR })).toBe(true);
  });
  it("never checks when the setting is off, in a benchmark run, or in a development build", () => {
    expect(shouldAutoCheck({ ...base, enabled: false })).toBe(false);
    expect(shouldAutoCheck({ ...base, bench: true })).toBe(false);
    expect(shouldAutoCheck({ ...base, dev: true })).toBe(false);
  });
});

describe("Later", () => {
  it("quietens the automatic check for that version only", () => {
    const m = afterLater(NO_MEMORY, "0.1.2");
    expect(shouldAnnounce("0.1.2", m.later, false)).toBe(false);
    expect(shouldAnnounce("0.1.3", m.later, false)).toBe(true);
  });
  it("doesn't quieten a check the user asked for", () => {
    expect(shouldAnnounce("0.1.2", "0.1.2", true)).toBe(true);
  });
  it("announces when Later was never pressed", () => {
    expect(shouldAnnounce("0.1.2", null, false)).toBe(true);
  });
  it("is kept when a later check records its time", () => {
    expect(afterCheck(afterLater(NO_MEMORY, "0.1.2"), NOW)).toEqual({ lastCheck: NOW, later: "0.1.2" });
  });
});

describe("tabs across the restart", () => {
  const paths = ["C:\\a.pdf", "C:\\b.pdf", "C:\\c.png"];
  it("round-trips through JSON", () => {
    const h = makeHandover(paths, "C:\\b.pdf", NOW);
    expect(readHandover(JSON.parse(JSON.stringify(h)), NOW + 30_000)).toEqual(h);
  });
  it("opens the tab that was in front last, the rest in order", () => {
    expect(handoverOrder(makeHandover(paths, "C:\\a.pdf", NOW))).toEqual(["C:\\b.pdf", "C:\\c.png", "C:\\a.pdf"]);
    expect(handoverOrder(makeHandover(paths, null, NOW))).toEqual(paths);
  });
  it("forgets a front tab that isn't one of the files", () => {
    expect(makeHandover(paths, "C:\\z.pdf", NOW).active).toBeNull();
    expect(readHandover({ paths, active: "C:\\z.pdf", t: NOW }, NOW)?.active).toBeNull();
  });
  it("is dropped when it's old, from the future, empty or malformed", () => {
    expect(readHandover(makeHandover(paths, null, NOW), NOW + HANDOVER_MAX_AGE_MS + 1)).toBeNull();
    expect(readHandover(makeHandover(paths, null, NOW + HOUR), NOW)).toBeNull();
    expect(readHandover(makeHandover([], null, NOW), NOW)).toBeNull();
    for (const bad of [null, "x", {}, { paths: "a", t: NOW }, { paths, t: "now" }, { paths: [1, 2], t: NOW }]) {
      expect(readHandover(bad, NOW)).toBeNull();
    }
  });
  it("skips entries that aren't paths", () => {
    expect(readHandover({ paths: ["C:\\a.pdf", 7, "", null], active: null, t: NOW }, NOW)?.paths).toEqual(["C:\\a.pdf"]);
  });
});

describe("words", () => {
  it("names the version on offer", () => {
    expect(stateText({ kind: "available", version: "0.2.0" }, "0.1.1")).toBe("Vellum 0.2.0 is available");
  });
  it("answers a manual check", () => {
    expect(stateText({ kind: "upToDate" }, "0.1.1")).toBe("You're up to date. Vellum 0.1.1 is the latest version.");
    expect(stateText({ kind: "checkFailed" }, "0.1.1")).toMatch(/^Couldn't check for updates/);
  });
  it("says nothing when idle", () => {
    expect(stateText({ kind: "idle" }, "0.1.1")).toBeNull();
  });
  it("shows progress once the size is known", () => {
    expect(stateText({ kind: "downloading", version: "0.2.0", received: 0, total: null }, "0.1.1")).toBe("Downloading Vellum 0.2.0…");
    expect(stateText({ kind: "downloading", version: "0.2.0", received: 50, total: 200 }, "0.1.1")).toBe("Downloading Vellum 0.2.0: 25%");
  });
  it("counts the other windows", () => {
    expect(stateText({ kind: "blocked", version: "0.2.0", others: 1 }, "0.1.1")).toMatch(/^Another Vellum window is open/);
    expect(stateText({ kind: "blocked", version: "0.2.0", others: 3 }, "0.1.1")).toMatch(/^3 other Vellum windows are open/);
  });
  it("keeps progress between 0 and 100", () => {
    expect(progressPercent(300, 200)).toBe(100);
    expect(progressPercent(-1, 200)).toBe(0);
    expect(progressPercent(199, 200)).toBe(99);
    expect(progressPercent(10, 0)).toBeNull();
    expect(progressPercent(10, null)).toBeNull();
  });
  it("says when it last checked", () => {
    const at = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h).getTime();
    expect(lastCheckedText(null, NOW)).toBeNull();
    expect(lastCheckedText(at(2026, 10, 13, 8), at(2026, 10, 13, 20))).toBe("Last checked today");
    expect(lastCheckedText(at(2026, 10, 12, 23), at(2026, 10, 13, 1))).toBe("Last checked yesterday");
    expect(lastCheckedText(at(2026, 10, 1, 12), at(2026, 10, 13, 12))).toBe("Last checked 12 days ago");
    expect(lastCheckedText(at(2026, 10, 14, 12), at(2026, 10, 13, 12))).toBe("Last checked today");
  });
});
