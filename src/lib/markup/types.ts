// The markup model: plain objects in Vellum page coordinates (points, y down, the page as
// rendered with its /Rotate applied). The common ground is in base.ts and each kind's own shape
// in its file under kinds/; this is where the rest of the app imports them from. Pure; see
// docs/editing-phase2-scope.md.

import type { MarkupKind, Style } from "./base";
import { kindOf } from "./kinds";

export * from "./base";

/** The agreed starting styles (docs/editing-phase2-scope.md, "Assumed" 5): each kind's own. */
export function defaultStyle(kind: MarkupKind): Style {
  return kindOf(kind).defaultStyle();
}
