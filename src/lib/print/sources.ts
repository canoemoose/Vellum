// What the Pages choice means: the list of pages (or page regions) to lay out, from the
// shell's PrintContext. Pure apart from the types.

import type { PageRect, PrintContext, PrintDoc } from "./context";
import type { Source } from "./model/auto";
import type { PageRef } from "./model/job";
import { parseRange } from "./model/pages";
import type { PagesMode } from "./model/settings";

export function pageRef(doc: PrintDoc, page: number): PageRef {
  const s = doc.info.sizes[page] ?? doc.info.sizes[0] ?? { w: 595, h: 842 };
  return {
    docId: doc.docId,
    page,
    path: doc.path,
    kind: doc.info.kind,
    title: doc.title,
    w: s.w,
    h: s.h,
    drawingScale: doc.scale,
  };
}

export function activeDoc(ctx: Pick<PrintContext, "docs" | "activeDocId">): PrintDoc | null {
  return ctx.docs.find((d) => d.docId === ctx.activeDocId) ?? ctx.docs[0] ?? null;
}

function regionSource(doc: PrintDoc, r: PageRect): Source {
  return { ref: pageRef(doc, r.page), crop: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 } };
}

export type SourcesResult = { ok: true; sources: Source[] } | { ok: false; error: string };

export function pickSources(
  ctx: Pick<PrintContext, "docs" | "activeDocId" | "currentPage" | "viewRect">,
  mode: PagesMode,
  range: string,
  marquee: PageRect | null,
): SourcesResult {
  const doc = activeDoc(ctx);
  if (!doc) return { ok: false, error: "No document is open" };
  const n = doc.info.numPages;
  const page = Math.min(Math.max(0, ctx.currentPage), n - 1);
  switch (mode) {
    case "all":
      return { ok: true, sources: Array.from({ length: n }, (_, i) => ({ ref: pageRef(doc, i), crop: null })) };
    case "current":
      return { ok: true, sources: [{ ref: pageRef(doc, page), crop: null }] };
    case "range": {
      const r = parseRange(range, n);
      return r.ok ? { ok: true, sources: r.pages.map((p) => ({ ref: pageRef(doc, p), crop: null })) } : r;
    }
    case "view":
      return ctx.viewRect ? { ok: true, sources: [regionSource(doc, ctx.viewRect)] } : { ok: false, error: "Nothing of the page is on screen." };
    case "marquee":
      return marquee ? { ok: true, sources: [regionSource(doc, marquee)] } : { ok: false, error: "Drag an area on the page." };
  }
}

/** "Hall 3 — Stage Plan Rev C.pdf" without the extension, for default file names. */
export function stem(title: string): string {
  return title.replace(/\.[^.\\/]+$/, "");
}
