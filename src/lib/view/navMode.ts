// Which navigation suits a document, from its page size: drawings bigger than A4 navigate
// like CAD (wheel zooms at the cursor), A4 and smaller like a document (wheel scrolls).

import type { PageSize } from "./layout";

export type NavMode = "cad" | "document";

/** A4's long side, 297 mm, in points. */
const A4_LONG_PT = (297 / 25.4) * 72;
/** Slack for pages a fraction over A4 (US Letter is shorter; A4 with bleed or rounding). */
const SLACK = 1.02;

/** CAD for pages whose long side is bigger than A4's, Document otherwise. */
export function autoNavMode(size: PageSize | undefined): NavMode {
  if (!size) return "cad";
  return Math.max(size.w, size.h) > A4_LONG_PT * SLACK ? "cad" : "document";
}
