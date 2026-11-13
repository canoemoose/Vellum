// Manual layouts remembered per file: the layout you last made when printing from a file comes
// back the next time you open Manual layout from it. Kept apart from the settings (layouts are
// far bigger than a file's zoom and page), keyed like them (pathKey), capped to the most
// recently used MAX_LAYOUTS. The layout itself is the saved-file text (model/serial.ts), so a
// remembered layout reopens exactly as a saved one does, missing files and all.

export const MAX_LAYOUTS = 50;
const STORE = "vellum.manualLayouts";

export interface RememberedLayout {
  /** serialise()d layout. */
  text: string;
  /** The margins choice in the dialog ("printer", or millimetres). */
  margin: string;
  /** Last saved, ms since the epoch: the oldest go first past MAX_LAYOUTS. */
  t: number;
}

/** Every usable entry from whatever was stored. */
export function sanitiseLayouts(raw: unknown): Record<string, RememberedLayout> {
  const out: Record<string, RememberedLayout> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (typeof r.text !== "string" || !r.text) continue;
    out[k] = {
      text: r.text,
      margin: typeof r.margin === "string" ? r.margin : "printer",
      t: typeof r.t === "number" && Number.isFinite(r.t) ? r.t : 0,
    };
  }
  return out;
}

/** Remember `entry` for `key`, dropping the least recently used beyond `cap`. */
export function rememberLayout(
  all: Record<string, RememberedLayout>, key: string, entry: RememberedLayout, cap = MAX_LAYOUTS,
): Record<string, RememberedLayout> {
  const next = { ...all, [key]: entry };
  const keys = Object.keys(next);
  if (keys.length <= cap) return next;
  keys.sort((a, b) => next[a].t - next[b].t);
  for (const k of keys.slice(0, keys.length - cap)) delete next[k];
  return next;
}

export function forgetLayout(all: Record<string, RememberedLayout>, key: string): Record<string, RememberedLayout> {
  if (!(key in all)) return all;
  const next = { ...all };
  delete next[key];
  return next;
}

// ---- Storage (browser only; failures just mean nothing is remembered) ----

function loadAll(): Record<string, RememberedLayout> {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? sanitiseLayouts(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function saveAll(all: Record<string, RememberedLayout>) {
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch (e) {
    console.warn("manual layout not remembered:", String(e));
  }
}

export function loadLayoutFor(key: string): RememberedLayout | null {
  return loadAll()[key] ?? null;
}

export function storeLayoutFor(key: string, text: string, margin: string) {
  saveAll(rememberLayout(loadAll(), key, { text, margin, t: Date.now() }));
}

export function forgetLayoutFor(key: string) {
  saveAll(forgetLayout(loadAll(), key));
}
