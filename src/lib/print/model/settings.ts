// Print settings and presets: types, defaults and (de)serialisation. Pure; the dialog keeps
// them in localStorage under vellum.print.* (src/lib/print/store.ts).

export type PagesMode = "all" | "current" | "range" | "view" | "marquee";
export type Sizing = "fit" | "actual" | "scale" | "tile" | "manual";
export type FitTo = "printable" | "paper";
export type ColourMode = "colour" | "greyscale" | "blackLines";

export { BLACK_SENSITIVITY_DEFAULT } from "../blackLines";
import { BLACK_SENSITIVITY_DEFAULT } from "../blackLines";
export type MarginMode = "printer" | "none" | "custom";
export type PageOrder = "across" | "down";
export type Duplex = "none" | "longEdge" | "shortEdge";
export type Quality = "image300" | "image600" | "vector";
export const N_UP = [1, 2, 4, 6, 9, 16] as const;
export type NUp = (typeof N_UP)[number];

/** Everything a preset stores (the brief: all but page range and copies). */
export interface PresetSettings {
  printer: string | null;
  sizing: Sizing;
  fitTo: FitTo;
  /** N of 1:N for To scale. */
  scaleRatio: number;
  /** To scale when the drawing scale isn't known: percent. */
  scalePercent: number;
  colour: ColourMode;
  /** Black lines: how faint a line still prints, 0-100 (print/blackLines.ts). */
  blackSensitivity: number;
  nUp: NUp;
  order: PageOrder;
  marginMode: MarginMode;
  customMarginMm: number;
  centre: boolean;
  autoRotate: boolean;
  borders: boolean;
  tileOverlapMm: number;
  /** Printer paper id (DMPAPER_*) and its name, so a preset survives a driver reinstall. */
  paperId: number | null;
  paperName: string | null;
  landscape: boolean;
  trayBySize: boolean;
  shrinkOversized: boolean;
  duplex: Duplex;
  collate: boolean;
  reverse: boolean;
  quality: Quality;
  stamp: boolean;
}

export interface PrintSettings extends PresetSettings {
  pagesMode: PagesMode;
  range: string;
  copies: number;
}

export const DEFAULT_SETTINGS: PrintSettings = {
  printer: null,
  pagesMode: "all",
  range: "",
  copies: 1,
  sizing: "fit",
  fitTo: "printable",
  scaleRatio: 100,
  scalePercent: 100,
  colour: "colour",
  blackSensitivity: BLACK_SENSITIVITY_DEFAULT,
  nUp: 1,
  order: "across",
  marginMode: "printer",
  customMarginMm: 10,
  centre: true,
  autoRotate: true,
  borders: false,
  tileOverlapMm: 10,
  paperId: null,
  paperName: null,
  landscape: true,
  trayBySize: false,
  shrinkOversized: false,
  duplex: "none",
  collate: true,
  reverse: false,
  quality: "image600",
  stamp: false,
};

export const PRESET_KEYS: (keyof PresetSettings)[] = [
  "printer", "sizing", "fitTo", "scaleRatio", "scalePercent", "colour", "blackSensitivity", "nUp", "order", "marginMode", "customMarginMm",
  "centre", "autoRotate", "borders", "tileOverlapMm", "paperId", "paperName", "landscape", "trayBySize",
  "shrinkOversized", "duplex", "collate", "reverse", "quality", "stamp",
];

export interface Preset {
  name: string;
  settings: PresetSettings;
}

export function presetFrom(name: string, s: PrintSettings): Preset {
  const settings = {} as Record<string, unknown>;
  for (const k of PRESET_KEYS) settings[k] = s[k];
  return { name, settings: settings as unknown as PresetSettings };
}

/** Apply a preset over current settings, keeping page range and copies. */
export function applyPreset(s: PrintSettings, p: Preset): PrintSettings {
  return sanitise({ ...s, ...p.settings, pagesMode: s.pagesMode, range: s.range, copies: s.copies });
}

const oneOf = <T>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);
const num = (v: unknown, d: number, lo: number, hi: number): number =>
  typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Coerce anything (old storage, hand-edited JSON) into valid settings. */
export function sanitise(raw: unknown): PrintSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    printer: strOrNull(r.printer),
    pagesMode: oneOf(r.pagesMode, ["all", "current", "range", "view", "marquee"] as const, d.pagesMode),
    range: typeof r.range === "string" ? r.range : d.range,
    copies: Math.round(num(r.copies, d.copies, 1, 999)),
    sizing: oneOf(r.sizing, ["fit", "actual", "scale", "tile", "manual"] as const, d.sizing),
    fitTo: oneOf(r.fitTo, ["printable", "paper"] as const, d.fitTo),
    scaleRatio: num(r.scaleRatio, d.scaleRatio, 0.01, 1e6),
    scalePercent: num(r.scalePercent, d.scalePercent, 1, 1000),
    colour: oneOf(r.colour, ["colour", "greyscale", "blackLines"] as const, d.colour),
    blackSensitivity: Math.round(num(r.blackSensitivity, d.blackSensitivity, 0, 100)),
    nUp: oneOf(r.nUp, N_UP, d.nUp),
    order: oneOf(r.order, ["across", "down"] as const, d.order),
    marginMode: oneOf(r.marginMode, ["printer", "none", "custom"] as const, d.marginMode),
    customMarginMm: num(r.customMarginMm, d.customMarginMm, 0, 100),
    centre: bool(r.centre, d.centre),
    autoRotate: bool(r.autoRotate, d.autoRotate),
    borders: bool(r.borders, d.borders),
    tileOverlapMm: num(r.tileOverlapMm, d.tileOverlapMm, 0, 100),
    paperId: typeof r.paperId === "number" ? r.paperId : null,
    paperName: strOrNull(r.paperName),
    landscape: bool(r.landscape, d.landscape),
    trayBySize: bool(r.trayBySize, d.trayBySize),
    shrinkOversized: bool(r.shrinkOversized, d.shrinkOversized),
    duplex: oneOf(r.duplex, ["none", "longEdge", "shortEdge"] as const, d.duplex),
    collate: bool(r.collate, d.collate),
    reverse: bool(r.reverse, d.reverse),
    quality: oneOf(r.quality, ["image300", "image600", "vector"] as const, d.quality),
    stamp: bool(r.stamp, d.stamp),
  };
}

export function sanitisePresets(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) return [];
  const out: Preset[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object" || typeof (p as Preset).name !== "string") continue;
    const s = sanitise((p as Preset).settings);
    out.push(presetFrom((p as Preset).name, s));
  }
  return out;
}

/** Standard drawing scales offered for To scale. */
export const SCALE_PRESETS = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000];
/** To scale's choices when the drawing scale isn't known (and the manual layout's). */
export const PERCENT_PRESETS = [10, 25, 33, 50, 75, 100, 150, 200, 400];

const STANDARD = [1, 2, 2.5, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000, 10000];

/** The smallest standard scale (largest picture) a page at 1:`n` still fits at: next N up. */
export function nextStandardRatio(n: number): number | null {
  return STANDARD.find((s) => s >= n - 1e-9) ?? null;
}

/** The standard scale nearest 1:`n` (in ratio terms): 1:206 -> 1:200. */
export function nearestStandardRatio(n: number): number {
  let best = STANDARD[0];
  for (const s of STANDARD) if (Math.abs(Math.log(s / n)) < Math.abs(Math.log(best / n))) best = s;
  return best;
}

/** Parse "1:200", "200", "1 : 12.5" into N. */
export function parseRatio(text: string): number | null {
  const m = /^\s*(?:1\s*[:/]\s*)?(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return n > 0 && isFinite(n) ? n : null;
}
