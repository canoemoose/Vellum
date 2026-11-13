// Every binding, for Help > Keyboard shortcuts. Navigation bindings mirror README.md's
// "Using it" table and src/lib/engine/input.ts; shell bindings are handled in App.svelte.
// Key notation: "+" joins keys and gestures that are pressed together ("Ctrl+wheel",
// "Space+drag", "Shift+click").

export interface Shortcut {
  keys: string;
  action: string;
  /** Only in one navigation mode ("CAD navigation", "Document navigation"); otherwise both. */
  mode?: "CAD" | "Document";
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Navigation",
    items: [
      { keys: "Middle-drag", action: "Pan" },
      { keys: "Space+drag", action: "Pan" },
      { keys: "Mouse wheel", action: "Zoom at cursor", mode: "CAD" },
      { keys: "Touchpad scroll", action: "Pan", mode: "CAD" },
      { keys: "Mouse wheel", action: "Scroll", mode: "Document" },
      { keys: "Mouse wheel past a page's end", action: "Turn the page (Single page layout)", mode: "Document" },
      { keys: "Ctrl+wheel", action: "Zoom at cursor" },
      { keys: "Shift+wheel", action: "Scroll sideways" },
      { keys: "Touchpad pinch", action: "Zoom" },
      { keys: "Double middle-click", action: "Fit page" },
      { keys: "Click a scrollbar's track", action: "Move a screenful that way", mode: "Document" },
      { keys: "N", action: "Switch between CAD and Document navigation" },
    ],
  },
  {
    title: "Mini map",
    items: [
      { keys: "Click", action: "Jump there" },
      { keys: "Drag", action: "Pan" },
      { keys: "Drag the top-left corner", action: "Resize the mini map" },
      { keys: "Double-click the top-left corner", action: "Default size" },
    ],
  },
  {
    title: "View",
    items: [
      { keys: "+ / -", action: "Zoom in / out" },
      { keys: "Ctrl+0", action: "Fit page" },
      { keys: "Ctrl+1", action: "Actual size" },
      { keys: "Ctrl+2", action: "Fit width" },
      { keys: "Ctrl+Shift+1 / 2 / 3", action: "Single page / Continuous / Columns" },
      { keys: "Page Up / Page Down", action: "Previous / next page" },
      { keys: "Home / End", action: "First / last page" },
      { keys: "R / Shift+R", action: "Rotate view clockwise / anticlockwise" },
      { keys: "Ctrl+B", action: "Show or hide the sidebar" },
      { keys: "Double-click the sidebar's edge", action: "Default sidebar width" },
      { keys: "F12 / Ctrl+Shift+D", action: "Performance overlay" },
    ],
  },
  {
    title: "Text and links",
    items: [
      { keys: "Ctrl+F", action: "Search the document" },
      { keys: "Enter / F3", action: "Next search result" },
      { keys: "Shift+Enter / Shift+F3", action: "Previous search result" },
      { keys: "Esc (in the search box)", action: "Clear the search" },
      { keys: "Drag over text", action: "Select text" },
      { keys: "Double-click / triple-click", action: "Select a word / a line" },
      { keys: "Ctrl+C", action: "Copy the selected text" },
      { keys: "Ctrl+A", action: "Select all the text on the page" },
      { keys: "Esc", action: "Clear the selection" },
      { keys: "Click a link", action: "Follow it (web links open in the browser)" },
    ],
  },
  {
    title: "Files and tabs",
    items: [
      { keys: "Ctrl+O", action: "Open" },
      { keys: "Ctrl+P", action: "Print" },
      { keys: "Ctrl+D", action: "Document properties" },
      { keys: "Ctrl+W", action: "Close tab" },
      { keys: "Middle-click a tab", action: "Close tab" },
      { keys: "Ctrl+Tab / Ctrl+Shift+Tab", action: "Next / previous tab" },
      { keys: "F1", action: "Keyboard shortcuts" },
      { keys: "Alt or F10", action: "Open the menus from the keyboard" },
    ],
  },
];

/** Groups filtered to the items whose keys or action contain every word of the query. */
export function filterShortcuts(groups: ShortcutGroup[], query: string): ShortcutGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return groups;
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((s) => {
        const hay = `${s.keys} ${s.action} ${s.mode ?? ""} ${g.title}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      }),
    }))
    .filter((g) => g.items.length > 0);
}

/** Status bar navigation hint for a mode, in the shortcuts dialog's words. */
export function navHint(mode: "cad" | "document"): string {
  return mode === "cad"
    ? "Middle-drag pan · Wheel zoom at cursor · Space+drag pan · Double middle-click fit"
    : "Wheel scroll · Ctrl+wheel zoom · Middle-drag pan · Space+drag pan";
}

/**
 * The PDFium build bundled with the app. Keep in step with VERSION in
 * tools/fetch-pdfium.mjs (a test checks it).
 */
export const PDFIUM_BUILD = "chromium/8138";
