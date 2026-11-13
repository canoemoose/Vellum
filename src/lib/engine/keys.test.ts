import { describe, expect, it } from "vitest";
import { blockedWhileTyping, isFunctionKey, isTyping, isTypingTarget, isWebViewAccelerator, type KeyLike } from "./keys";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, ...mods });
const input = { tagName: "INPUT" };
const textarea = { tagName: "TEXTAREA" };
const div = { tagName: "DIV", isContentEditable: false };

describe("isTypingTarget", () => {
  it("counts inputs, selects, textareas and editable content", () => {
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("ignores everything else", () => {
    expect(isTypingTarget(div)).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
  it("reads the event target", () => {
    expect(isTyping(key("r", { target: textarea }))).toBe(true);
    expect(isTyping(key("r", { target: div }))).toBe(false);
  });
});

describe("blockedWhileTyping", () => {
  it("blocks bare keys in a field, including the textarea the old check missed", () => {
    for (const k of ["r", "R", "+", "-", "PageDown", "Home", " "]) {
      expect(blockedWhileTyping(key(k, { target: input }))).toBe(true);
      expect(blockedWhileTyping(key(k, { target: textarea }))).toBe(true);
    }
  });
  it("lets Ctrl and F-key shortcuts through in a field", () => {
    expect(blockedWhileTyping(key("0", { ctrlKey: true, target: input }))).toBe(false);
    expect(blockedWhileTyping(key("w", { ctrlKey: true, target: input }))).toBe(false);
    expect(blockedWhileTyping(key("o", { metaKey: true, target: input }))).toBe(false);
    expect(blockedWhileTyping(key("F1", { target: input }))).toBe(false);
    expect(blockedWhileTyping(key("F12", { target: input }))).toBe(false);
  });
  it("blocks nothing outside a field", () => {
    expect(blockedWhileTyping(key("r", { target: div }))).toBe(false);
    expect(blockedWhileTyping(key("PageDown"))).toBe(false);
  });
});

describe("isFunctionKey", () => {
  it("matches F1 to F24 only", () => {
    expect(isFunctionKey("F1")).toBe(true);
    expect(isFunctionKey("F12")).toBe(true);
    expect(isFunctionKey("F24")).toBe(true);
    expect(isFunctionKey("F")).toBe(false);
    expect(isFunctionKey("F0")).toBe(false);
    expect(isFunctionKey("F25")).toBe(false);
    expect(isFunctionKey("f")).toBe(false);
  });
});

describe("isWebViewAccelerator", () => {
  it("catches F5 and Ctrl+R/F/G/S/U/J/H in either case", () => {
    expect(isWebViewAccelerator(key("F5"))).toBe(true);
    for (const k of ["r", "f", "g", "s", "u", "j", "h", "R"]) expect(isWebViewAccelerator(key(k, { ctrlKey: true }))).toBe(true);
    expect(isWebViewAccelerator(key("r", { ctrlKey: true, shiftKey: true } as Partial<KeyLike>))).toBe(true);
  });
  it("leaves the app's own shortcuts and bare letters alone", () => {
    expect(isWebViewAccelerator(key("r"))).toBe(false);
    expect(isWebViewAccelerator(key("w", { ctrlKey: true }))).toBe(false);
    expect(isWebViewAccelerator(key("p", { ctrlKey: true }))).toBe(false);
    expect(isWebViewAccelerator(key("F1"))).toBe(false);
  });
});
