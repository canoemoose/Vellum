// Persisted user settings. localStorage lives in the WebView2 profile under
// %LOCALAPPDATA%\engineering.event.vellum, so it survives restarts. Print presets and last
// print settings are WP-Print's, under their own vellum.print.* keys.

import type { NavMode } from "./engine/viewer";
import type { LayoutMode } from "./view/layout";
import type { Units } from "./shell/paper";
import { ACCENTS, type ThemePref } from "./shell/theme";
import type { Bounds } from "./shell/windowPlacement";

const KEY = "vellum.settings.v1";

export type SidebarTab = "pages" | "outline";

export interface WindowState extends Bounds {
  maximised: boolean;
}

export interface Settings {
  navMode: NavMode;
  layoutMode: LayoutMode;
  theme: ThemePref;
  accent: string;
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarTab: SidebarTab;
  miniMap: boolean;
  units: Units;
  recent: string[];
  /** Hand-set drawing scales by file path (lower-cased), most recent last. */
  scales: Record<string, number>;
  /** Physical pixels; null until the window has been moved or resized once. */
  window: WindowState | null;
}

export const SIDEBAR_MIN = 160;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 196;

export const DEFAULTS: Settings = {
  navMode: "cad",
  layoutMode: "continuous",
  theme: "dark",
  accent: ACCENTS[0].hex,
  sidebarOpen: true,
  sidebarWidth: SIDEBAR_DEFAULT,
  sidebarTab: "pages",
  miniMap: true,
  units: "metric",
  recent: [],
  scales: {},
  window: null,
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
    navMode: s.navMode === "document" ? "document" : "cad",
    layoutMode: s.layoutMode === "single" ? "single" : "continuous",
    theme: s.theme === "light" || s.theme === "system" ? s.theme : "dark",
    accent: ACCENTS.some((a) => a.hex === s.accent) ? (s.accent as string) : DEFAULTS.accent,
    sidebarOpen: typeof s.sidebarOpen === "boolean" ? s.sidebarOpen : DEFAULTS.sidebarOpen,
    sidebarWidth: num(s.sidebarWidth) ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, s.sidebarWidth)) : SIDEBAR_DEFAULT,
    sidebarTab: s.sidebarTab === "outline" ? "outline" : "pages",
    miniMap: typeof s.miniMap === "boolean" ? s.miniMap : DEFAULTS.miniMap,
    units: s.units === "imperial" ? "imperial" : "metric",
    recent: Array.isArray(s.recent) ? s.recent.filter((p): p is string => typeof p === "string").slice(0, 10) : [],
    scales,
    window:
      w && num(w.x) && num(w.y) && num(w.w) && num(w.h) && w.w > 0 && w.h > 0
        ? { x: w.x, y: w.y, w: w.w, h: w.h, maximised: w.maximised === true }
        : null,
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
