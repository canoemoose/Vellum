// Persisted user settings. localStorage lives in the WebView2 profile under
// %LOCALAPPDATA%\engineering.event.vellum, so it survives restarts.

import type { NavMode } from "./engine/viewer";
import type { LayoutMode } from "./view/layout";

const KEY = "vellum.settings.v1";

export interface Settings {
  navMode: NavMode;
  layoutMode: LayoutMode;
}

const DEFAULTS: Settings = { navMode: "cad", layoutMode: "continuous" };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      navMode: s.navMode === "document" ? "document" : "cad",
      layoutMode: s.layoutMode === "single" ? "single" : "continuous",
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable: settings just won't persist.
  }
}
