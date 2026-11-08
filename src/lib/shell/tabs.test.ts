import { describe, expect, it } from "vitest";
import {
  activeTab, addTab, closeTab, cycle, dropIndex, emptyTabs, fileName, findByPath, moveTab, pathKey, truncateMiddle,
  type TabList,
} from "./tabs";

interface T { id: number; path: string }
const list = (ids: number[], active: number | null): TabList<T> => ({
  tabs: ids.map((id) => ({ id, path: `C:\\d\\${id}.pdf` })),
  activeId: active,
});
const ids = (l: TabList<T>) => l.tabs.map((t) => t.id);

describe("paths", () => {
  it("compares Windows paths case- and slash-insensitively", () => {
    expect(pathKey("C:/Drawings/Plan.PDF")).toBe(pathKey("c:\\drawings\\plan.pdf"));
  });
  it("takes the file name from either separator", () => {
    expect(fileName("C:\\a\\b c (1).pdf")).toBe("b c (1).pdf");
    expect(fileName("/x/y.png")).toBe("y.png");
    expect(fileName("plain.pdf")).toBe("plain.pdf");
  });
});

describe("addTab", () => {
  it("inserts after the active tab", () => {
    const r = addTab(list([1, 2, 3], 1), { id: 9, path: "C:\\new.pdf" });
    expect(ids(r.list)).toEqual([1, 9, 2, 3]);
    expect(r.existed).toBe(false);
  });
  it("appends when nothing is active", () => {
    const r = addTab(emptyTabs<T>(), { id: 9, path: "C:\\new.pdf" });
    expect(ids(r.list)).toEqual([9]);
  });
  it("returns the existing tab for a file that is already open", () => {
    const l = list([1, 2], 1);
    const r = addTab(l, { id: 9, path: "c:/D/2.PDF" });
    expect(r.existed).toBe(true);
    expect(r.tab.id).toBe(2);
    expect(r.list).toBe(l);
    expect(findByPath(l, "C:\\d\\1.pdf")?.id).toBe(1);
  });
});

describe("closeTab", () => {
  it("activates the right-hand neighbour when closing the active tab", () => {
    expect(closeTab(list([1, 2, 3], 2), 2)).toEqual(list([1, 3], 3));
  });
  it("activates the left neighbour when closing the last tab", () => {
    expect(closeTab(list([1, 2, 3], 3), 3).activeId).toBe(2);
  });
  it("keeps the active tab when closing another", () => {
    expect(closeTab(list([1, 2, 3], 1), 3).activeId).toBe(1);
  });
  it("leaves nothing active when the only tab closes", () => {
    expect(closeTab(list([1], 1), 1)).toEqual({ tabs: [], activeId: null });
  });
  it("ignores unknown ids", () => {
    const l = list([1], 1);
    expect(closeTab(l, 5)).toBe(l);
  });
});

describe("cycle", () => {
  it("wraps both ways", () => {
    expect(cycle(list([1, 2, 3], 3), 1)?.id).toBe(1);
    expect(cycle(list([1, 2, 3], 1), -1)?.id).toBe(3);
    expect(cycle(list([1, 2, 3], 2), 1)?.id).toBe(3);
  });
  it("returns nothing with no tabs", () => {
    expect(cycle(emptyTabs<T>(), 1)).toBeUndefined();
  });
  it("finds the active tab", () => {
    expect(activeTab(list([1, 2], 2))?.id).toBe(2);
  });
});

describe("reordering", () => {
  it("moves a tab and clamps the index", () => {
    expect(ids(moveTab(list([1, 2, 3], 1), 1, 2))).toEqual([2, 3, 1]);
    expect(ids(moveTab(list([1, 2, 3], 1), 3, -4))).toEqual([3, 1, 2]);
    expect(moveTab(list([1, 2, 3], 1), 1, 2).activeId).toBe(1);
  });
  it("works out the drop index from tab centres", () => {
    const c = [50, 150, 250];
    expect(dropIndex(c, 0, 10)).toBe(0);
    expect(dropIndex(c, 0, 160)).toBe(1);
    expect(dropIndex(c, 0, 300)).toBe(2);
    expect(dropIndex(c, 2, 100)).toBe(1);
    expect(dropIndex(c, 2, 0)).toBe(0);
  });
});

describe("truncateMiddle", () => {
  it("leaves short names alone", () => {
    expect(truncateMiddle("Plan.pdf", 20)).toBe("Plan.pdf");
  });
  it("keeps the start and the end", () => {
    const s = truncateMiddle("Hall 3 Stage Plan Revision C.pdf", 16);
    expect(s.length).toBeLessThanOrEqual(16);
    expect(s.startsWith("Hall")).toBe(true);
    expect(s.endsWith("C.pdf")).toBe(true);
    expect(s).toContain("…");
  });
  it("copes with tiny limits", () => {
    expect(truncateMiddle("abcdef", 1)).toBe("…");
    expect(truncateMiddle("abcdef", 3)).toBe("a…f");
  });
});
