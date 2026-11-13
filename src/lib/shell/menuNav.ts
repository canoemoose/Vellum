// Keyboard navigation for the HTML menu bar, as pure functions over the menu structure.

export interface MenuItemLike {
  separator?: boolean;
  disabled?: boolean;
  submenu?: unknown[];
}

/** A menu item as the menu bar and context menus render it. */
export interface MenuItem extends MenuItemLike {
  label?: string;
  shortcut?: string;
  action?: () => void;
  /** Shows a tick (toggles) or a dot (radio choices). */
  checked?: boolean;
  radio?: boolean;
  submenu?: MenuItem[];
}

export interface Menu {
  label: string;
  items: MenuItem[];
}

const selectable = (it: MenuItemLike | undefined) => !!it && !it.separator && !it.disabled;

/**
 * The next selectable item from `from` in direction `dir`, wrapping round and skipping
 * separators and disabled items. `from` = -1 with dir 1 gives the first item; `from` =
 * items.length with dir -1 gives the last. Returns -1 when nothing is selectable.
 */
export function nextItem(items: MenuItemLike[], from: number, dir: 1 | -1): number {
  const n = items.length;
  if (!n) return -1;
  let i = from;
  for (let k = 0; k < n; k++) {
    i = (((i + dir) % n) + n) % n;
    if (selectable(items[i])) return i;
  }
  return -1;
}

export function firstItem(items: MenuItemLike[]): number {
  return nextItem(items, -1, 1);
}

export function lastItem(items: MenuItemLike[]): number {
  return nextItem(items, items.length, -1);
}

/** The menu `dir` steps along the bar, wrapping (Left / Right arrows). */
export function nextMenu(count: number, from: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  return (((from + dir) % count) + count) % count;
}

/**
 * The item whose label starts with the typed character (type-ahead), searching after the
 * current one and wrapping. Returns -1 when none matches.
 */
export function itemByLetter(labels: (string | null)[], items: MenuItemLike[], from: number, ch: string): number {
  const c = ch.toLowerCase();
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k + n) % n;
    if (selectable(items[i]) && labels[i]?.toLowerCase().startsWith(c)) return i;
  }
  return -1;
}

export type MenuKeyAction =
  | { type: "move"; index: number }
  | { type: "switchMenu"; menu: number }
  | { type: "openSub" }
  | { type: "closeSub" }
  | { type: "activate" }
  | { type: "close" }
  /** Let the key through with the menu still open (modifier keys, F10, which the menu bar owns). */
  | { type: "pass" }
  /** Close the menu, then let the key through so its shortcut runs (Ctrl+P, F1...). */
  | { type: "closeAndPass" }
  /** Nothing to do; the menu still swallows the key so it can't act on the drawing behind. */
  | { type: "none" };

/** Modifiers held with the key. */
export interface MenuKeyMods {
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
}

const MODIFIER_KEYS = new Set(["Control", "Alt", "AltGraph", "Shift", "Meta", "OS"]);

/**
 * What a key does inside an open menu. `inSub` says the focus is in a submenu (Left closes
 * it rather than moving to the previous menu). Keys the menu doesn't use are swallowed
 * ("none"), except shortcuts (Ctrl, Alt or Meta held, or an F-key), which close the menu and
 * then run: never type-ahead, so Ctrl+P prints rather than moving to "Print".
 */
export function menuKey(
  key: string,
  st: {
    items: MenuItemLike[];
    labels: (string | null)[];
    index: number;
    menu: number;
    menuCount: number;
    inSub: boolean;
    mods?: MenuKeyMods;
  },
): MenuKeyAction {
  const { items, index } = st;
  if (MODIFIER_KEYS.has(key) || key === "F10") return { type: "pass" };
  if (st.mods?.ctrl || st.mods?.alt || st.mods?.meta || /^F\d{1,2}$/.test(key)) return { type: "closeAndPass" };
  switch (key) {
    case "ArrowDown":
      return { type: "move", index: nextItem(items, index, 1) };
    case "ArrowUp":
      return { type: "move", index: index < 0 ? lastItem(items) : nextItem(items, index, -1) };
    case "Home":
      return { type: "move", index: firstItem(items) };
    case "End":
      return { type: "move", index: lastItem(items) };
    case "ArrowRight":
      if (index >= 0 && items[index]?.submenu && selectable(items[index])) return { type: "openSub" };
      return st.inSub ? { type: "none" } : { type: "switchMenu", menu: nextMenu(st.menuCount, st.menu, 1) };
    case "ArrowLeft":
      if (st.inSub) return { type: "closeSub" };
      return { type: "switchMenu", menu: nextMenu(st.menuCount, st.menu, -1) };
    case "Enter":
    case " ":
      if (index < 0) return { type: "none" };
      return items[index]?.submenu ? { type: "openSub" } : { type: "activate" };
    case "Escape":
      return st.inSub ? { type: "closeSub" } : { type: "close" };
    case "Tab":
      return { type: "close" };
    default:
      if (key.length === 1 && /\S/.test(key)) {
        const i = itemByLetter(st.labels, items, index, key);
        return i >= 0 ? { type: "move", index: i } : { type: "none" };
      }
      return { type: "none" };
  }
}
