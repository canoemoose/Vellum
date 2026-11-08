// Every binding, for Help > Keyboard shortcuts. Navigation bindings mirror README.md's
// "Using it" table and src/lib/engine/input.ts; shell bindings are handled in App.svelte.

export interface Shortcut {
  keys: string;
  action: string;
  /** Only in one navigation mode; otherwise both. */
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
      { keys: "Space + drag", action: "Pan" },
      { keys: "Mouse wheel", action: "Zoom at cursor", mode: "CAD" },
      { keys: "Touchpad scroll", action: "Pan", mode: "CAD" },
      { keys: "Mouse wheel", action: "Scroll", mode: "Document" },
      { keys: "Ctrl + wheel", action: "Zoom at cursor" },
      { keys: "Shift + wheel", action: "Scroll sideways" },
      { keys: "Touchpad pinch", action: "Zoom" },
      { keys: "Double middle-click", action: "Fit page", mode: "CAD" },
    ],
  },
  {
    title: "View",
    items: [
      { keys: "+ / -", action: "Zoom in / out" },
      { keys: "Ctrl+0", action: "Fit page" },
      { keys: "Ctrl+1", action: "Actual size" },
      { keys: "Page Up / Page Down", action: "Previous / next page" },
      { keys: "Home / End", action: "First / last page" },
      { keys: "R / Shift+R", action: "Rotate view clockwise / anticlockwise" },
      { keys: "Ctrl+B", action: "Show or hide the sidebar" },
      { keys: "F12", action: "Performance overlay" },
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

/** Status bar navigation hint for a mode. */
export function navHint(mode: "cad" | "document"): string {
  return mode === "cad"
    ? "Middle-drag pan · Scroll zoom at cursor · Space-drag pan · Double-middle-click fit"
    : "Scroll to move · Ctrl+scroll zoom · Middle-drag pan · Space-drag pan";
}

/**
 * The PDFium build bundled with the app. Keep in step with VERSION in
 * tools/fetch-pdfium.mjs (a test checks it).
 */
export const PDFIUM_BUILD = "chromium/8138";
