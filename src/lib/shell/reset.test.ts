import { describe, expect, it } from "vitest";
import { clearIfMarked, markForReset } from "./reset";

function store(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    clear: () => m.clear(),
  };
}

describe("resetting settings", () => {
  it("leaves what's stored alone at start unless a reset was asked for", () => {
    const s = store({ "vellum.settings.v1": "{}" });
    expect(clearIfMarked(s)).toBe(false);
    expect(s.m.size).toBe(1);
  });

  it("clears everything at the next start, once", () => {
    const s = store({ "vellum.settings.v1": "{}", "vellum.print.last": "{}" });
    expect(markForReset(s)).toBe(true);
    // The running app goes on writing until it closes: that goes too.
    s.setItem("vellum.settings.v1", '{"theme":"dark"}');
    expect(clearIfMarked(s)).toBe(true);
    expect(s.m.size).toBe(0);
    // The start after that keeps what the fresh run stored.
    s.setItem("vellum.settings.v1", "{}");
    expect(clearIfMarked(s)).toBe(false);
    expect(s.m.size).toBe(1);
  });

  it("says so when storage can't be written, and never throws", () => {
    const broken = {
      getItem: () => { throw new Error("no storage"); },
      setItem: () => { throw new Error("no storage"); },
      clear: () => {},
    };
    expect(markForReset(broken)).toBe(false);
    expect(clearIfMarked(broken)).toBe(false);
  });
});
