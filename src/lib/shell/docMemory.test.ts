import { describe, expect, it } from "vitest";
import { type DocMemory, rememberDoc, sanitiseDocMemory, sanitiseDocs, sanitiseMapMode } from "./docMemory";

const mem = (t: number, over: Partial<DocMemory> = {}): DocMemory => ({
  page: 3, zoom: 2, x: 100, y: 200, rotation: 90, layout: "columns", columns: 3, nav: "document", map: "hide", mapSize: 1.5, t, ...over,
});

describe("remembered files", () => {
  it("keeps a good entry as it is", () => {
    expect(sanitiseDocMemory(mem(5))).toEqual(mem(5));
  });

  it("drops entries it can't use and repairs odd fields", () => {
    expect(sanitiseDocMemory(null)).toBeNull();
    expect(sanitiseDocMemory({ page: 1, zoom: 0, x: 0, y: 0 })).toBeNull(); // zoom 0
    expect(sanitiseDocMemory({ page: 1, zoom: 1 })).toBeNull(); // no position
    const fixed = sanitiseDocMemory({ page: 1.6, zoom: 1, x: 0, y: 0, rotation: 45, layout: "grid", columns: 99, nav: "x", map: "yes", mapSize: 99 })!;
    expect(fixed).toMatchObject({ page: 2, rotation: 0, layout: "continuous", columns: 6, nav: null, map: "auto", mapSize: 20 });
  });

  it("reads the mini map's mode, and the older on/off setting", () => {
    expect(sanitiseMapMode("show")).toBe("show");
    expect(sanitiseMapMode("hide")).toBe("hide");
    expect(sanitiseMapMode("auto")).toBe("auto");
    expect(sanitiseMapMode(true)).toBe("auto"); // on meant: shown when useful
    expect(sanitiseMapMode(false)).toBe("hide");
    expect(sanitiseMapMode(undefined)).toBe("auto");
    expect(sanitiseMapMode("nonsense")).toBe("auto");
  });

  it("sanitiseDocs keeps the usable ones", () => {
    expect(Object.keys(sanitiseDocs({ a: mem(1), b: { junk: true }, c: mem(2) }))).toEqual(["a", "c"]);
    expect(sanitiseDocs("nonsense")).toEqual({});
  });

  it("remembers, replacing an entry and dropping the least recently used beyond the cap", () => {
    let docs: Record<string, DocMemory> = {};
    docs = rememberDoc(docs, "a", mem(1), 2);
    docs = rememberDoc(docs, "b", mem(2), 2);
    docs = rememberDoc(docs, "a", mem(3, { page: 9 }), 2); // a used again
    expect(docs.a.page).toBe(9);
    docs = rememberDoc(docs, "c", mem(4), 2); // b is now the oldest
    expect(Object.keys(docs).sort()).toEqual(["a", "c"]);
  });
});
