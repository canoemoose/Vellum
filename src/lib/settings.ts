// Persisted user settings. localStorage lives in the WebView2 profile under
// %LOCALAPPDATA%\io.github.canoemoose.vellum (the app identifier), so it survives restarts. Print presets and last
// print settings are WP-Print's, under their own vellum.print.* keys.

import { type LayoutMode, MAX_COLUMNS, MIN_COLUMNS } from "./view/layout";
import { type DocMemory, sanitiseDocs } from "./shell/docMemory";
import type { Units } from "./shell/paper";
import type { ThemePref } from "./shell/theme";
import type { Bounds } from "./shell/windowPlacement";

const KEY = "vellum.settings.v1";

export type SidebarTab = "pages" | "outline" | "search";

export interface WindowState extends Bounds {
  maximised: boolean;
}

export interface Settings {
  layoutMode: LayoutMode;
  /** Columns in the columns layout (MIN_COLUMNS to MAX_COLUMNS). */
  columns: number;
  theme: ThemePref;
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarTab: SidebarTab;
  units: Units;
  recent: string[];
  /** Hand-set drawing scales by file path (lower-cased), most recent last. */
  scales: Record<string, number>;
  /** What's remembered per file (where you were, layout, mini map...), by pathKey. */
  docs: Record<string, DocMemory>;
  /** Physical pixels; null until the window has been moved or resized once. */
  window: WindowState | null;
  /** Look for a new version on start, at most once a day (shell/update.ts). */
  updateCheck: boolean;
}

export const SIDEBAR_MIN = 160;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 196;

export const DEFAULTS: Settings = {
  layoutMode: "continuous",
  columns: 2,
  theme: "dark",
  sidebarOpen: true,
  sidebarWidth: SIDEBAR_DEFAULT,
  sidebarTab: "pages",
  units: "metric",
  recent: [],
  scales: {},
  docs: {},
  window: null,
  updateCheck: true,
};

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Settings from whatever was stored, every field checked; anything odd falls back to the default. */
export function sanitiseSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const w = s.window as Record<string, unknown> | null | undefined;
  const scales: Record<string, number> = {};
  if (s.scales && typeof s.scales === "object") {
    for (const [k, v] of Object.entries(s.scales as Record<string, unknown>)) if (num(v) && v > 0) scales[k] = v;
  }
  return {
    layoutMode: s.layoutMode === "single" || s.layoutMode === "columns" ? s.layoutMode : "continuous",
    columns: typeof s.columns === "number" && Number.isFinite(s.columns) ? Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.round(s.columns))) : 2,
    theme: s.theme === "light" || s.theme === "system" ? s.theme : "dark",
    sidebarOpen: typeof s.sidebarOpen === "boolean" ? s.sidebarOpen : DEFAULTS.sidebarOpen,
    sidebarWidth: num(s.sidebarWidth) ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, s.sidebarWidth)) : SIDEBAR_DEFAULT,
    sidebarTab: s.sidebarTab === "outline" || s.sidebarTab === "search" ? s.sidebarTab : "pages",
    units: s.units === "imperial" ? "imperial" : "metric",
    recent: Array.isArray(s.recent) ? s.recent.filter((p): p is string => typeof p === "string").slice(0, 10) : [],
    scales,
    docs: sanitiseDocs(s.docs),
    window:
      w && num(w.x) && num(w.y) && num(w.w) && num(w.h) && w.w > 0 && w.h > 0
        ? { x: w.x, y: w.y, w: w.w, h: w.h, maximised: w.maximised === true }
        : null,
    updateCheck: s.updateCheck !== false,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitiseSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return sanitiseSettings({});
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable: settings just won't persist.
  }
}
