import { describe, expect, it } from "vitest";
import { firstItem, itemByLetter, lastItem, menuKey, nextItem, nextMenu, type MenuItemLike } from "./menuNav";

const items: MenuItemLike[] = [
  {}, // 0 Open
  { separator: true }, // 1
  { disabled: true }, // 2
  { submenu: [] }, // 3 Recent
  {}, // 4 Print
];
const labels = ["Open…", null, "Export", "Open recent", "Print…"];

describe("nextItem", () => {
  it("skips separators and disabled items", () => {
    expect(nextItem(items, 0, 1)).toBe(3);
    expect(nextItem(items, 3, -1)).toBe(0);
  });
  it("wraps round", () => {
    expect(nextItem(items, 4, 1)).toBe(0);
    expect(nextItem(items, 0, -1)).toBe(4);
  });
  it("finds the first and last", () => {
    expect(firstItem(items)).toBe(0);
    expect(lastItem(items)).toBe(4);
  });
  it("returns -1 when nothing is selectable", () => {
    expect(nextItem([{ separator: true }, { disabled: true }], 0, 1)).toBe(-1);
    expect(nextItem([], 0, 1)).toBe(-1);
  });
});

describe("nextMenu", () => {
  it("wraps along the bar", () => {
    expect(nextMenu(4, 3, 1)).toBe(0);
    expect(nextMenu(4, 0, -1)).toBe(3);
    expect(nextMenu(0, 0, 1)).toBe(-1);
  });
});

describe("type-ahead", () => {
  it("finds the next item starting with the letter, after the current one", () => {
    expect(itemByLetter(labels, items, 0, "o")).toBe(3);
    expect(itemByLetter(labels, items, 3, "O")).toBe(0);
    expect(itemByLetter(labels, items, 0, "e")).toBe(-1); // Export is disabled
  });
});

describe("menuKey", () => {
  const st = { items, labels, index: 0, menu: 1, menuCount: 4, inSub: false };
  it("moves with the arrows, Home and End", () => {
    expect(menuKey("ArrowDown", st)).toEqual({ type: "move", index: 3 });
    expect(menuKey("ArrowUp", st)).toEqual({ type: "move", index: 4 });
    expect(menuKey("ArrowUp", { ...st, index: -1 })).toEqual({ type: "move", index: 4 });
    expect(menuKey("Home", { ...st, index: 4 })).toEqual({ type: "move", index: 0 });
    expect(menuKey("End", st)).toEqual({ type: "move", index: 4 });
  });
  it("switches menus with Left and Right", () => {
    expect(menuKey("ArrowRight", st)).toEqual({ type: "switchMenu", menu: 2 });
    expect(menuKey("ArrowLeft", st)).toEqual({ type: "switchMenu", menu: 0 });
  });
  it("opens and closes submenus", () => {
    expect(menuKey("ArrowRight", { ...st, index: 3 })).toEqual({ type: "openSub" });
    expect(menuKey("Enter", { ...st, index: 3 })).toEqual({ type: "openSub" });
    expect(menuKey("ArrowLeft", { ...st, inSub: true })).toEqual({ type: "closeSub" });
    expect(menuKey("Escape", { ...st, inSub: true })).toEqual({ type: "closeSub" });
    expect(menuKey("ArrowRight", { ...st, inSub: true })).toEqual({ type: "none" });
  });
  it("activates, closes and type-aheads", () => {
    expect(menuKey("Enter", st)).toEqual({ type: "activate" });
    expect(menuKey(" ", st)).toEqual({ type: "activate" });
    expect(menuKey("Enter", { ...st, index: -1 })).toEqual({ type: "none" });
    expect(menuKey("Escape", st)).toEqual({ type: "close" });
    expect(menuKey("Tab", st)).toEqual({ type: "close" });
    expect(menuKey("p", st)).toEqual({ type: "move", index: 4 });
    expect(menuKey("z", st)).toEqual({ type: "none" });
  });
  it("never type-aheads with Ctrl, Alt or Meta held: the shortcut runs instead", () => {
    expect(menuKey("p", { ...st, mods: { ctrl: true } })).toEqual({ type: "closeAndPass" });
    expect(menuKey("r", { ...st, mods: { ctrl: true } })).toEqual({ type: "closeAndPass" });
    expect(menuKey("p", { ...st, mods: { alt: true } })).toEqual({ type: "closeAndPass" });
    expect(menuKey("p", { ...st, mods: { meta: true } })).toEqual({ type: "closeAndPass" });
    expect(menuKey("ArrowDown", { ...st, mods: { ctrl: true } })).toEqual({ type: "closeAndPass" });
    expect(menuKey("p", { ...st, mods: { ctrl: false, alt: false, meta: false } })).toEqual({ type: "move", index: 4 });
  });
  it("closes and passes F-keys, but leaves F10 to the menu bar", () => {
    expect(menuKey("F1", st)).toEqual({ type: "closeAndPass" });
    expect(menuKey("F5", st)).toEqual({ type: "closeAndPass" });
    expect(menuKey("F10", st)).toEqual({ type: "pass" });
  });
  it("passes modifier keys on their own, so Alt still toggles the menu bar", () => {
    for (const k of ["Alt", "Control", "Shift", "Meta"]) expect(menuKey(k, { ...st, mods: { alt: k === "Alt" } })).toEqual({ type: "pass" });
  });
  it("swallows keys it doesn't use, rather than letting them reach the drawing", () => {
    for (const k of ["+", "-", "PageDown", "PageUp", "z"]) expect(menuKey(k, st)).toEqual({ type: "none" });
  });
});
