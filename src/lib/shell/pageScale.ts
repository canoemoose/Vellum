// Per-page drawing scales: a tab keeps its document scale (shell/scale.ts DocScale, on the tab)
// and adds overrides for single pages, for sets that mix scales. The status bar shows the
// scale of the page in view; measurements use their own page's. Overrides are remembered per
// file, like a hand-set document scale. Pure. See docs/editing-phase4-scope.md.

import { type DocScale, formatRatio, scaleStatusText } from "./scale";
import type { Units } from "./paper";

/** Page index (0-based) to its own scale. */
export type PageOverrides = Record<number, DocScale>;

/**
 * What each page's own title block says: page index to the scale found there, or null when
 * the page has been read and states none. A page not yet read is absent.
 */
export type DetectedPages = Record<number, number | null>;

/**
 * Where a page's scale came from:
 * - "this page": set for that page alone (This page only, or Calibrate on it);
 * - "document": set by hand for every page;
 * - "title block": the page's own title block;
 * - "borrowed": the page states none, so it takes the document's (page 1's title block):
 *   shown as a warning, since that may well be wrong (a detail sheet in a site-plan set);
 * - "pending": the page hasn't been read yet, so the document's stands in for now.
 */
export type ScaleFrom = "this page" | "document" | "title block" | "borrowed" | "pending";

export interface PageScale {
  scale: DocScale | null;
  from: ScaleFrom | null;
}

/**
 * The scale that applies to a page and where it came from. A scale set for the page wins;
 * then one set by hand for the whole document (an explicit "every page"); then the page's
 * own title block; then the document's, flagged as borrowed (Matt, 24 Nov: page 1's, with a
 * warning, rather than no scale).
 */
export function resolvePageScale(doc: DocScale | null, pages: PageOverrides | undefined, page: number, detected?: DetectedPages): PageScale {
  const own = pages?.[page];
  if (own) return { scale: own, from: "this page" };
  if (doc?.source === "manual") return { scale: doc, from: "document" };
  const d = detected?.[page];
  if (typeof d === "number") return { scale: { ratio: d, source: "detected" }, from: "title block" };
  if (!doc) return { scale: null, from: null };
  return { scale: doc, from: d === null ? "borrowed" : "pending" };
}

/** The scale that applies to a page: see resolvePageScale. */
export function scaleForPage(doc: DocScale | null, pages: PageOverrides | undefined, page: number, detected?: DetectedPages): DocScale | null {
  return resolvePageScale(doc, pages, page, detected).scale;
}

/**
 * The status bar's scale for the page in view, and whether to show it as a warning: a
 * borrowed scale ("Scale 1:5000 (from page 1)") or none ("Scale not set").
 */
export function pageScaleStatus(
  doc: DocScale | null,
  pages: PageOverrides | undefined,
  page: number,
  units: Units = "metric",
  detected?: DetectedPages,
): { text: string; warn: boolean } {
  const r = resolvePageScale(doc, pages, page, detected);
  if (!r.scale) return { text: "Scale not set", warn: true };
  const n = formatRatio(r.scale.ratio, units);
  switch (r.from) {
    case "this page":
      return { text: `Scale ${n} (this page)`, warn: false };
    case "title block":
      return { text: `Scale ${n} (from title block)`, warn: false };
    case "borrowed":
      return { text: `Scale ${n} (from page 1)`, warn: true };
    default:
      return { text: scaleStatusText(r.scale, units), warn: false };
  }
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
