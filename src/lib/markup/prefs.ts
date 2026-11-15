// What Vellum remembers about markup between sessions (part of the settings): each tool's last
// style and text style (rule 7: each tool its own), which files have had their first save confirmed, the author name if
// one was set by hand, and each tool group's last tool. Validated field by field, like the rest
// of the settings. Pure.

import { type MarkupKind, type Rgb, type Style, type TextStyle, DEFAULT_TEXT, arrowEnds, fullText } from "./types";
import { type Dock, DEFAULT_DOCK, sanitiseDock } from "../shell/dock";
import { kindOf } from "./kinds";
import { type ToolDef, GROUPS, TOOLS, toolById, toolDefaults, withPreset } from "./tools";

export interface MarkupPrefs {
  /** By tool id (a kind's own tool has the kind's name, so styles saved before tools had ids still apply). */
  styles: Partial<Record<string, Style>>;
  /** Each typing tool's last text style, by tool id (the text box and the callout apart). */
  texts: Partial<Record<string, TextStyle>>;
  /** pathKeys of files whose save into the original has been confirmed once. */
  confirmed: string[];
  /** Author written into markups; null means the account's display name. */
  author: string | null;
  /** Where the floating properties bar is docked. */
  dock: Dock;
  /** Each tool group's last tool (what a collapsed palette shows for it). */
  lastInGroup: Partial<Record<string, string>>;
  /** By letter, the last tool used of those sharing it (what the letter picks, rule 8). */
  lastForKey: Partial<Record<string, string>>;
}

const MAX_CONFIRMED = 500;

export function defaultPrefs(): MarkupPrefs {
  return { styles: {}, texts: {}, confirmed: [], author: null, dock: { ...DEFAULT_DOCK }, lastInGroup: {}, lastForKey: {} };
}

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

function rgb(v: unknown): Rgb | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const c = v.map((x) => num(x, 0, 1));
  return c.every((x) => x !== null) ? (c as Rgb) : null;
}

function style(v: unknown, tool: ToolDef & { kind: MarkupKind }): Style {
  const kind = tool.kind;
  const d = toolDefaults(tool);
  if (!v || typeof v !== "object") return d;
  const s = v as Record<string, unknown>;
  // Dots were once 0.1 pt dashes; they're now dashes of no length (round caps draw them).
  const raw = Array.isArray(s.dash) && s.dash.length && s.dash.every((x) => num(x, 0, 100) !== null) ? (s.dash as number[]).map((x) => (x === 0.1 ? 0 : x)) : null;
  const dash = raw && raw.some((x) => x > 0) ? raw : null;
  const out: Style = {
    stroke: rgb(s.stroke) ?? d.stroke,
    width: num(s.width, 0, 50) ?? d.width,
    fill: s.fill === null ? null : (rgb(s.fill) ?? d.fill),
    opacity: num(s.opacity, 0.05, 1) ?? d.opacity,
    // Before line and fill were split, one opacity covered both.
    fillOpacity: num(s.fillOpacity, 0.05, 1) ?? num(s.opacity, 0.05, 1) ?? d.fillOpacity,
    dash,
  };
  if (kindOf(kind).controls.ends) out.ends = arrowEnds({ ends: d.ends, ...s } as unknown as Style);
  return out;
}

export function sanitisePrefs(raw: unknown): MarkupPrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const styles: Partial<Record<string, Style>> = {};
  const rs = (p.styles && typeof p.styles === "object" ? p.styles : {}) as Record<string, unknown>;
  for (const t of TOOLS) if (t.kind && rs[t.id]) styles[t.id] = style(rs[t.id], t as ToolDef & { kind: MarkupKind });
  const lastInGroup: Partial<Record<string, string>> = {};
  const lg = (p.lastInGroup && typeof p.lastInGroup === "object" ? p.lastInGroup : {}) as Record<string, unknown>;
  for (const g of GROUPS) {
    const id = lg[g.id];
    if (typeof id === "string" && toolById(id)?.group === g.id) lastInGroup[g.id] = id;
  }
  const lastForKey: Partial<Record<string, string>> = {};
  const lk = (p.lastForKey && typeof p.lastForKey === "object" ? p.lastForKey : {}) as Record<string, unknown>;
  for (const [k, id] of Object.entries(lk)) if (typeof id === "string" && k && toolById(id)?.key === k) lastForKey[k] = id;
  // Before each tool had its own, one text style ("text") served both: it carries over to each.
  const textStyle = (v: unknown): TextStyle => {
    const t = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return fullText({ ...(t as Partial<TextStyle>), size: num(t.size, 4, 144) ?? DEFAULT_TEXT.size, colour: rgb(t.colour) ?? DEFAULT_TEXT.colour });
  };
  const rt = (p.texts && typeof p.texts === "object" ? p.texts : {}) as Record<string, unknown>;
  const texts: Partial<Record<string, TextStyle>> = {};
  for (const t of TOOLS) {
    if (!t.kind || !kindOf(t.kind).controls.text) continue;
    const v = rt[t.id] ?? p.text;
    if (v && typeof v === "object") texts[t.id] = textStyle(v);
  }
  return {
    styles,
    texts,
    confirmed: Array.isArray(p.confirmed) ? p.confirmed.filter((x): x is string => typeof x === "string").slice(-MAX_CONFIRMED) : [],
    author: typeof p.author === "string" && p.author.trim() ? p.author.trim().slice(0, 100) : null,
    dock: sanitiseDock(p.dock),
    lastInGroup,
    lastForKey,
  };
}

/** A tool's style: what it was last used with, or its default; its preset always applies. */
export function styleFor(p: MarkupPrefs, toolId: string): Style {
  const t = toolById(toolId);
  if (!t?.kind) throw new Error(`no drawing tool ${toolId}`);
  return withPreset(t, p.styles[toolId] ?? toolDefaults(t));
}

/** A typing tool's text style: what it was last used with, or the default. */
export function textFor(p: MarkupPrefs, toolId: string): TextStyle {
  return p.texts[toolId] ?? { ...DEFAULT_TEXT };
}

/** Record that a file's first save was confirmed (oldest dropped past the cap). */
export function confirm(p: MarkupPrefs, key: string): MarkupPrefs {
  const confirmed = [...p.confirmed.filter((k) => k !== key), key].slice(-MAX_CONFIRMED);
  return { ...p, confirmed };
}
