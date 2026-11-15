// A markup as the backend's annotation spec (src-tauri/src/annot/spec.rs), in PDF user space,
// with its appearance stream built from the same drawing operations as the overlay. The common
// part is here; each kind fills in its own (kinds/). Pure.

import type { Markup } from "./base";
import { opsBounds, opsFor } from "./ops";
import { drawnDash } from "./dash";
import { type Frame, rectToUser, toContent } from "./pdf";
import { type AnnotSpec, pdfDate } from "./annotation";
import { defOf } from "./kinds";

export * from "./annotation";

/** The annotation for a markup on a page with frame `f`. */
export function toSpec(m: Markup, f: Frame): AnnotSpec {
  const ops = opsFor(m);
  const content = toContent(f, ops);
  const box = rectToUser(f, opsBounds(ops));
  const s = m.style;
  const spec: AnnotSpec = {
    page: m.page,
    nm: m.id,
    subtype: "Square",
    rect: box,
    appearance: { ops: content.ops, bbox: box, opacity: content.opacity, fillOpacity: content.fillOpacity, fonts: content.fonts },
    author: m.meta.author || undefined,
    modified: pdfDate(m.meta.modified),
    created: pdfDate(m.meta.created),
    flags: 4, // Print: markups print (agreed default)
    colour: s.stroke,
    borderWidth: s.width,
    // /BS /D as drawn, so an app that redraws the markup spaces it the same.
    dash: drawnDash(s.dash, s.width) ?? undefined,
    // No annotation-wide /CA: the line and fill have their own opacities, in the appearance.
  };
  if (s.fill) spec.interior = s.fill;
  defOf(m).spec(m, f, spec);
  return spec;
}
