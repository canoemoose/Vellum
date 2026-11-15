// Per-page drawing scales: a tab keeps its document scale (shell/scale.ts DocScale, on the tab)
// and adds overrides for single pages, for sets that mix scales. The status bar shows the
// scale of the page in view; measurements use their own page's. Overrides are remembered per
// file, like a hand-set document scale. Pure. See docs/editing-phase4-scope.md.

import { type DocScale, formatRatio, scaleStatusText } from "./scale";
import type { Units } from "./paper";

/** Page index (0-based) to its own scale. */
export type PageOverrides = Record<number, DocScale>;

/** The scale that applies to a page: its own, else the document's, else none. */
export function scaleForPage(doc: DocScale | null, pages: PageOverrides | undefined, page: number): DocScale | null {
  return pages?.[page] ?? doc;
}

/** Overrides with one page's set (or, with null, removed). */
export function withPageScale(pages: PageOverrides | undefined, page: number, s: DocScale | null): PageOverrides {
  const out: PageOverrides = { ...(pages ?? {}) };
  if (s) out[page] = s;
  else delete out[page];
  return out;
}

/** The status bar text for the page in view: "Scale 1:50 (this page)" when it has its own. */
export function pageScaleText(doc: DocScale | null, pages: PageOverrides | undefined, page: number, units: Units = "metric"): string {
  const own = pages?.[page];
  if (own) return `Scale ${formatRatio(own.ratio, units)} (this page)`;
  return scaleStatusText(doc, units);
}

/** Overrides as remembered in the settings: page index to ratio. */
export type RememberedPages = Record<string, number>;

export function toRemembered(pages: PageOverrides): RememberedPages {
  const out: RememberedPages = {};
  for (const [k, v] of Object.entries(pages)) out[k] = v.ratio;
  return out;
}

export function fromRemembered(r: RememberedPages | undefined): PageOverrides {
  const out: PageOverrides = {};
  for (const [k, v] of Object.entries(r ?? {})) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && typeof v === "number" && Number.isFinite(v) && v > 0) out[i] = { ratio: v, source: "manual" };
  }
  return out;
}

/**
 * Remembered overrides by file (pathKey), most recent last, capped; a file with none is
 * dropped. The settings keep these beside the hand-set document scales.
 */
export function rememberPages(map: Record<string, RememberedPages>, key: string, pages: PageOverrides, cap = 200): Record<string, RememberedPages> {
  const out: Record<string, RememberedPages> = {};
  for (const [k, v] of Object.entries(map)) if (k !== key) out[k] = v;
  if (Object.keys(pages).length) out[key] = toRemembered(pages);
  const keys = Object.keys(out);
  for (let i = 0; i < keys.length - cap; i++) delete out[keys[i]];
  return out;
}

/** Remembered overrides read back from stored settings, every value checked. */
export function sanitiseRememberedPages(raw: unknown): Record<string, RememberedPages> {
  const out: Record<string, RememberedPages> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const pages = toRemembered(fromRemembered(v && typeof v === "object" ? (v as RememberedPages) : undefined));
    if (Object.keys(pages).length) out[k] = pages;
  }
  return out;
}

/** "1 measurement re-valued", "3 measurements re-valued", or null for none. */
export function revaluedText(n: number): string | null {
  if (n <= 0) return null;
  return `${n} measurement${n === 1 ? "" : "s"} re-valued at the new scale`;
}
