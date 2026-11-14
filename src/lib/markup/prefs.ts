// What Vellum remembers about markup between sessions (part of the settings): each tool's last
// style, the text style, which files have had their first save confirmed, and the author name
// if one was set by hand. Validated field by field, like the rest of the settings. Pure.

import { type MarkupKind, type Rgb, type Style, type TextStyle, DEFAULT_TEXT, defaultStyle } from "./types";

export interface MarkupPrefs {
  styles: Partial<Record<MarkupKind, Style>>;
  text: TextStyle;
  /** pathKeys of files whose save into the original has been confirmed once. */
  confirmed: string[];
  /** Author written into markups; null means the account's display name. */
  author: string | null;
}

export const KINDS: MarkupKind[] = ["rect", "arrow", "cloud", "text", "ink"];
const MAX_CONFIRMED = 500;

export function defaultPrefs(): MarkupPrefs {
  return { styles: {}, text: { ...DEFAULT_TEXT }, confirmed: [], author: null };
}

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

function rgb(v: unknown): Rgb | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const c = v.map((x) => num(x, 0, 1));
  return c.every((x) => x !== null) ? (c as Rgb) : null;
}

function style(v: unknown, kind: MarkupKind): Style {
  const d = defaultStyle(kind);
  if (!v || typeof v !== "object") return d;
  const s = v as Record<string, unknown>;
  const dash = Array.isArray(s.dash) && s.dash.length && s.dash.every((x) => num(x, 0.1, 100) !== null) ? (s.dash as number[]) : null;
  return {
    stroke: rgb(s.stroke) ?? d.stroke,
    width: num(s.width, 0, 50) ?? d.width,
    fill: s.fill === null ? null : (rgb(s.fill) ?? d.fill),
    opacity: num(s.opacity, 0.05, 1) ?? d.opacity,
    dash,
  };
}

export function sanitisePrefs(raw: unknown): MarkupPrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const styles: Partial<Record<MarkupKind, Style>> = {};
  const rs = (p.styles && typeof p.styles === "object" ? p.styles : {}) as Record<string, unknown>;
  for (const k of KINDS) if (rs[k]) styles[k] = style(rs[k], k);
  const t = (p.text && typeof p.text === "object" ? p.text : {}) as Record<string, unknown>;
  return {
    styles,
    text: { size: num(t.size, 4, 144) ?? DEFAULT_TEXT.size, colour: rgb(t.colour) ?? DEFAULT_TEXT.colour },
    confirmed: Array.isArray(p.confirmed) ? p.confirmed.filter((x): x is string => typeof x === "string").slice(-MAX_CONFIRMED) : [],
    author: typeof p.author === "string" && p.author.trim() ? p.author.trim().slice(0, 100) : null,
  };
}

/** A tool's style: what it was last used with, or the default. */
export function styleFor(p: MarkupPrefs, kind: MarkupKind): Style {
  return p.styles[kind] ?? defaultStyle(kind);
}

/** Record that a file's first save was confirmed (oldest dropped past the cap). */
export function confirm(p: MarkupPrefs, key: string): MarkupPrefs {
  const confirmed = [...p.confirmed.filter((k) => k !== key), key].slice(-MAX_CONFIRMED);
  return { ...p, confirmed };
}
