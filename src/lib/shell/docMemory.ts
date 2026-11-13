// What Vellum remembers about each file between opens: where you were, how you were looking
// at it, and its mini map. Kept in settings, keyed like the drawing scales (pathKey), capped
// to the most recently used MAX_DOCS files. Pure, so it's tested.

import type { LayoutMode } from "../view/layout";
import { MAX_COLUMNS, MIN_COLUMNS } from "../view/layout";
import type { NavMode } from "../view/navMode";
import type { Rotation } from "../view/rotation";
import { MAP_SIZE_MAX, MAP_SIZE_MIN } from "../view/viewMath";

export const MAX_DOCS = 200;

/** The mini map: shown when it has something to show (automatic), always, or never. */
export type MapMode = "auto" | "show" | "hide";

/** A stored mini map setting. Older settings stored on/off: on meant automatic. */
export function sanitiseMapMode(v: unknown): MapMode {
  if (v === "auto" || v === "show" || v === "hide") return v;
  if (v === false) return "hide";
  return "auto";
}

export interface DocMemory {
  /** Where you were: the page, the zoom (1 = 100%), and the page point (unrotated points)
   * at the centre of the view. */
  page: number;
  zoom: number;
  x: number;
  y: number;
  rotation: Rotation;
  layout: LayoutMode;
  columns: number;
  /** A navigation mode you chose for this file; null while it follows the page size. */
  nav: NavMode | null;
  /** The mini map's mode, and its size (remembered only up to the guards). */
  map: MapMode;
  mapSize: number;
  /** Last used, ms since the epoch: the oldest go first past MAX_DOCS. */
  t: number;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** One remembered entry from whatever was stored, or null if it isn't usable. */
export function sanitiseDocMemory(raw: unknown): DocMemory | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!num(r.page) || !num(r.zoom) || !num(r.x) || !num(r.y) || r.zoom <= 0) return null;
  const rotation = ([0, 90, 180, 270] as const).find((d) => d === r.rotation) ?? 0;
  const layout: LayoutMode = r.layout === "single" || r.layout === "columns" ? r.layout : "continuous";
  return {
    page: Math.max(0, Math.round(r.page)),
    zoom: r.zoom,
    x: r.x,
    y: r.y,
    rotation,
    layout,
    columns: num(r.columns) ? Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.round(r.columns))) : MIN_COLUMNS,
    nav: r.nav === "cad" || r.nav === "document" ? r.nav : null,
    map: sanitiseMapMode(r.map),
    mapSize: num(r.mapSize) ? Math.min(MAP_SIZE_MAX, Math.max(MAP_SIZE_MIN, r.mapSize)) : 1,
    t: num(r.t) ? r.t : 0,
  };
}

/** Every usable entry from what was stored. */
export function sanitiseDocs(raw: unknown): Record<string, DocMemory> {
  const out: Record<string, DocMemory> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const m = sanitiseDocMemory(v);
    if (m) out[k] = m;
  }
  return out;
}

/** Remember `mem` for `key`, dropping the least recently used beyond `cap`. */
export function rememberDoc(docs: Record<string, DocMemory>, key: string, mem: DocMemory, cap = MAX_DOCS): Record<string, DocMemory> {
  const next = { ...docs, [key]: mem };
  const keys = Object.keys(next);
  if (keys.length <= cap) return next;
  keys.sort((a, b) => next[a].t - next[b].t);
  for (const k of keys.slice(0, keys.length - cap)) delete next[k];
  return next;
}
