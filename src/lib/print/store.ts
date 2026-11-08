// Persistence for the print dialog: last settings and named presets in localStorage under
// vellum.print.*. Every access is guarded: storage can be missing or full.

import { type Preset, type PrintSettings, DEFAULT_SETTINGS, sanitise, sanitisePresets } from "./model/settings";

const LAST = "vellum.print.last";
const PRESETS = "vellum.print.presets";
const PRESET = "vellum.print.preset";
const MANUAL_SNAP = "vellum.print.manualSnap";

function read(key: string): unknown {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : JSON.parse(v);
  } catch {
    return null;
  }
}

function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Storage full or unavailable: settings just won't persist.
  }
}

export function loadSettings(): PrintSettings {
  const raw = read(LAST);
  // Page range and Marquee belong to one print; copies go back to 1 each time.
  const s = raw ? sanitise(raw) : { ...DEFAULT_SETTINGS };
  return { ...s, copies: 1, range: "", pagesMode: s.pagesMode === "marquee" || s.pagesMode === "view" ? "current" : s.pagesMode };
}

export const saveSettings = (s: PrintSettings): void => write(LAST, s);

export const loadPresets = (): Preset[] => sanitisePresets(read(PRESETS));
export const savePresets = (p: Preset[]): void => write(PRESETS, p);

export const loadPresetName = (): string | null => {
  const v = read(PRESET);
  return typeof v === "string" ? v : null;
};
export const savePresetName = (n: string | null): void => write(PRESET, n);

export interface SnapPrefs {
  margins: boolean;
  pages: boolean;
  grid: boolean;
}

export function loadSnap(): SnapPrefs {
  const r = read(MANUAL_SNAP) as Partial<SnapPrefs> | null;
  return { margins: r?.margins !== false, pages: r?.pages !== false, grid: r?.grid === true };
}

export const saveSnap = (s: SnapPrefs): void => write(MANUAL_SNAP, s);
