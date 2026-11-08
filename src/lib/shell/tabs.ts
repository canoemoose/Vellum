// The document tab list as a pure model. The shell keeps one TabList in Svelte state and
// calls these functions; nothing here touches the viewer or the DOM.

/** Normalise a path for "is this file already open?" (Windows paths are case-insensitive). */
export function pathKey(path: string): string {
  return path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/** The file name part of a path. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export interface TabBase {
  id: number;
  path: string;
}

export interface TabList<T extends TabBase> {
  tabs: T[];
  activeId: number | null;
}

export function emptyTabs<T extends TabBase>(): TabList<T> {
  return { tabs: [], activeId: null };
}

export function findByPath<T extends TabBase>(list: TabList<T>, path: string): T | undefined {
  const k = pathKey(path);
  return list.tabs.find((t) => pathKey(t.path) === k);
}

export function activeTab<T extends TabBase>(list: TabList<T>): T | undefined {
  return list.tabs.find((t) => t.id === list.activeId);
}

/**
 * Add a tab after the active one (or at the end), unless the same file is already open.
 * Returns the new list and the tab that should become active (the existing one for a
 * duplicate). The new tab is not made active here: switching is the caller's job, since it
 * has to detach the current document first.
 */
export function addTab<T extends TabBase>(list: TabList<T>, tab: T): { list: TabList<T>; tab: T; existed: boolean } {
  const existing = findByPath(list, tab.path);
  if (existing) return { list, tab: existing, existed: true };
  const i = list.tabs.findIndex((t) => t.id === list.activeId);
  const tabs = [...list.tabs];
  tabs.splice(i < 0 ? tabs.length : i + 1, 0, tab);
  return { list: { ...list, tabs }, tab, existed: false };
}

/**
 * Remove a tab. When it was the active one, the tab to its right becomes active (or the one
 * to its left if it was last), like a browser.
 */
export function closeTab<T extends TabBase>(list: TabList<T>, id: number): TabList<T> {
  const i = list.tabs.findIndex((t) => t.id === id);
  if (i < 0) return list;
  const tabs = list.tabs.filter((t) => t.id !== id);
  let activeId = list.activeId;
  if (activeId === id) activeId = tabs.length ? tabs[Math.min(i, tabs.length - 1)].id : null;
  return { tabs, activeId };
}

/** The tab `dir` steps from the active one, wrapping round (Ctrl+Tab / Ctrl+Shift+Tab). */
export function cycle<T extends TabBase>(list: TabList<T>, dir: 1 | -1): T | undefined {
  if (!list.tabs.length) return undefined;
  const i = list.tabs.findIndex((t) => t.id === list.activeId);
  const n = list.tabs.length;
  return list.tabs[(((i < 0 ? 0 : i) + dir) % n + n) % n];
}

/** Move a tab to index `to` (clamped), keeping the active tab. */
export function moveTab<T extends TabBase>(list: TabList<T>, id: number, to: number): TabList<T> {
  const from = list.tabs.findIndex((t) => t.id === id);
  if (from < 0) return list;
  const tabs = [...list.tabs];
  const [t] = tabs.splice(from, 1);
  tabs.splice(Math.max(0, Math.min(tabs.length, to)), 0, t);
  return { ...list, tabs };
}

/**
 * Where a dragged tab lands: the index among the other tabs whose centre the pointer has
 * passed. `centres` are the x centres of the tabs in their current order, `from` the dragged
 * tab's index, `x` the pointer.
 */
export function dropIndex(centres: number[], from: number, x: number): number {
  let to = 0;
  for (let i = 0; i < centres.length; i++) {
    if (i === from) continue;
    if (x > centres[i]) to++;
  }
  return to;
}

/**
 * Shorten a file name in the middle, keeping the extension and the end of the name (where
 * revision letters usually are): "Hall 3 Stage Plan Rev C.pdf" -> "Hall 3 St…Rev C.pdf".
 */
export function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return "…";
  const keep = max - 1;
  const tail = Math.ceil(keep / 2);
  const head = keep - tail;
  return s.slice(0, head).trimEnd() + "…" + s.slice(s.length - tail).trimStart();
}
