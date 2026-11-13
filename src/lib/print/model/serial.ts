// Saving and loading manual layouts as JSON, so a recurring site set doesn't have to be
// rebuilt. Sources are stored by file path and page; loading maps each path to an open
// document id (the dialog opens files that aren't open). Pure.

import type { Box, Margins, Rotation, Size } from "./geom";
import { quarter } from "./geom";
import type { PageRef } from "./job";
import type { ManualItem, ManualLayout } from "./manual";

export const LAYOUT_VERSION = 1;

export interface SavedSource {
  path: string;
  kind: "pdf" | "image";
  page: number;
  title: string;
  w: number;
  h: number;
  drawingScale: number | null;
}

export interface SavedItem {
  source: SavedSource;
  crop: Box | null;
  x: number;
  y: number;
  scale: number;
  rotation: Rotation;
  border: boolean;
  /** Layouts saved before the label had separate parts: one tick for page and scale. */
  label?: boolean;
  /** Null or missing: automatic. */
  showName?: boolean | null;
  showPage?: boolean;
  showScale?: boolean;
}

export interface SavedLayout {
  vellumLayout: number;
  paper: Size;
  margins: Margins;
  sheets: { items: SavedItem[] }[];
}

export function serialise(l: ManualLayout): string {
  const out: SavedLayout = {
    vellumLayout: LAYOUT_VERSION,
    paper: l.paper,
    margins: l.margins,
    sheets: l.sheets.map((s) => ({
      items: s.items.map((it) => ({
        source: {
          path: it.ref.path,
          kind: it.ref.kind,
          page: it.ref.page,
          title: it.ref.title,
          w: it.ref.w,
          h: it.ref.h,
          drawingScale: it.ref.drawingScale,
        },
        crop: it.crop,
        x: it.x,
        y: it.y,
        scale: it.scale,
        rotation: it.rotation,
        border: it.border,
        showName: it.showName,
        showPage: it.showPage,
        showScale: it.showScale,
      })),
    })),
  };
  return JSON.stringify(out, null, 2);
}

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const isBox = (v: unknown): v is Box =>
  !!v && typeof v === "object" && ["x0", "y0", "x1", "y1"].every((k) => isNum((v as Record<string, unknown>)[k]));

export type ParseResult = { ok: true; layout: SavedLayout } | { ok: false; error: string };

/** Parse and check a saved layout. */
export function parseLayout(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This isn't a Vellum layout file" };
  }
  const r = raw as Partial<SavedLayout>;
  if (!r || typeof r !== "object" || !isNum(r.vellumLayout)) return { ok: false, error: "This isn't a Vellum layout file" };
  if (r.vellumLayout > LAYOUT_VERSION) return { ok: false, error: "This layout was saved by a newer Vellum" };
  if (!r.paper || !isNum(r.paper.w) || !isNum(r.paper.h) || !Array.isArray(r.sheets)) {
    return { ok: false, error: "The layout file is damaged" };
  }
  const m = r.margins && typeof r.margins === "object" ? r.margins : { left: 0, top: 0, right: 0, bottom: 0 };
  const sheets = r.sheets.map((s) => ({
    items: (Array.isArray(s?.items) ? s.items : []).filter(
      (it): it is SavedItem =>
        !!it && !!it.source && typeof it.source.path === "string" && isNum(it.source.page) && isNum(it.source.w) &&
        isNum(it.source.h) && isNum(it.x) && isNum(it.y) && isNum(it.scale) && it.scale > 0,
    ),
  }));
  return {
    ok: true,
    layout: {
      vellumLayout: r.vellumLayout,
      paper: { w: r.paper.w, h: r.paper.h },
      margins: { left: Number(m.left) || 0, top: Number(m.top) || 0, right: Number(m.right) || 0, bottom: Number(m.bottom) || 0 },
      sheets,
    },
  };
}

/** Every file a saved layout needs. */
export function layoutPaths(s: SavedLayout): string[] {
  return [...new Set(s.sheets.flatMap((sh) => sh.items.map((it) => it.source.path)))];
}

/**
 * Build a layout from a saved one. `resolve(path)` gives the open document for a file (id,
 * page count) or null if it couldn't be opened; items whose file or page is gone are
 * dropped and reported.
 */
export function restore(
  s: SavedLayout,
  resolve: (path: string) => { docId: number; numPages: number; sizes?: Size[] } | null,
): { layout: ManualLayout; missing: string[] } {
  let next = 1;
  const missing = new Set<string>();
  const sheets = s.sheets.map((sh) => {
    const id = next++;
    const items: ManualItem[] = [];
    for (const it of sh.items) {
      const doc = resolve(it.source.path);
      if (!doc || it.source.page >= doc.numPages) {
        missing.add(it.source.path);
        continue;
      }
      // Prefer the page size the file has now (it may have been revised).
      const size = doc.sizes?.[it.source.page] ?? { w: it.source.w, h: it.source.h };
      const ref: PageRef = {
        docId: doc.docId,
        page: it.source.page,
        path: it.source.path,
        kind: it.source.kind === "image" ? "image" : "pdf",
        title: it.source.title,
        w: size.w,
        h: size.h,
        drawingScale: isNum(it.source.drawingScale) ? it.source.drawingScale : null,
      };
      items.push({
        id: next++,
        ref,
        crop: isBox(it.crop) ? it.crop : null,
        x: it.x,
        y: it.y,
        scale: it.scale,
        rotation: quarter(isNum(it.rotation) ? it.rotation : 0),
        border: !!it.border,
        // Older files: one "label" tick for page and scale, the name automatic.
        showName: typeof it.showName === "boolean" ? it.showName : it.label === false ? false : null,
        showPage: typeof it.showPage === "boolean" ? it.showPage : it.label !== false,
        showScale: typeof it.showScale === "boolean" ? it.showScale : it.label !== false,
      });
    }
    return { id, items };
  });
  return {
    layout: { paper: s.paper, margins: s.margins, sheets: sheets.length ? sheets : [{ id: next++, items: [] }], nextId: next },
    missing: [...missing],
  };
}
