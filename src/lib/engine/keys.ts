// Shared keyboard rules for the two key handlers (App.svelte for shell commands, input.ts for
// navigation), as pure functions over the event's fields so they can be tested without a DOM.

/** The parts of a KeyboardEvent these rules read. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
  target?: unknown;
}

interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
}

/** Whether keys sent to this element are text entry (fields, lists, editable content). */
export function isTypingTarget(t: unknown): boolean {
  if (!t || typeof t !== "object") return false;
  const el = t as ElementLike;
  return el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || !!el.isContentEditable;
}

export function isTyping(e: KeyLike): boolean {
  return isTypingTarget(e.target);
}

/** F1 to F24. */
export const isFunctionKey = (key: string): boolean => /^F([1-9]|1\d|2[0-4])$/.test(key);

/**
 * True when a shortcut must not act because the user is typing: bare keys (R, +, PageDown,
 * Space...) belong to the field. Ctrl and F-key shortcuts work everywhere.
 */
export function blockedWhileTyping(e: KeyLike): boolean {
  if (!isTyping(e)) return false;
  return !(e.ctrlKey || e.metaKey) && !isFunctionKey(e.key);
}

/**
 * WebView2's own accelerators, which must never reach the browser: reload (F5, Ctrl+R), find
 * (Ctrl+F, Ctrl+G), save page (Ctrl+S), view source (Ctrl+U), downloads (Ctrl+J), history
 * (Ctrl+H).
 */
export function isWebViewAccelerator(e: KeyLike): boolean {
  if (e.key === "F5") return true;
  const ctrl = e.ctrlKey || e.metaKey;
  return ctrl && ["r", "f", "g", "s", "u", "j", "h"].includes(e.key.toLowerCase());
}
