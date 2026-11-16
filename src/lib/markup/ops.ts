// A markup's drawing as operations in page coordinates (points, y down): paths and lines of
// text. The overlay paints these on the canvas (engine/markupPainter.ts) and pdf.ts turns the
// same operations into the annotation's appearance stream, so the screen and the file agree.
// The toolkit is draw.ts; each kind's drawing is in its file under kinds/. Pure.

import type { Markup } from "./base";
import type { Op } from "./draw";
import { defOf } from "./kinds";

export * from "./draw";
export { cloudChord } from "./kinds/cloud";

/** A markup's drawing. */
export function opsFor(m: Markup): Op[] {
  return defOf(m).ops(m);
}
