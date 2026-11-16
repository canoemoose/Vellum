// The colours offered for lines and lettering: the context bar's palette, and a text stamp's
// (Matt's review: the same, not a smaller stamp-only set); and the fills, in the same order so a
// fill sits under its line colour when the bar stacks them (docs/edit-lock-brief.md, 8). Every
// group shows eight swatches: seven lines and a custom one; six fills, None and a custom one.
// Pure.

import type { Rgb } from "./base";

export const LINE_COLOURS: { name: string; c: Rgb }[] = [
  { name: "Red", c: [0.85, 0.1, 0.1] },
  { name: "Orange", c: [0.95, 0.5, 0.05] },
  { name: "Yellow", c: [0.95, 0.78, 0.0] },
  { name: "Green", c: [0.1, 0.6, 0.2] },
  { name: "Blue", c: [0.05, 0.35, 0.8] },
  { name: "Magenta", c: [0.75, 0.1, 0.6] },
  { name: "Black", c: [0, 0, 0] },
];

/**
 * The fills, slot for slot under the line colours: the pale of each hue, then White where the
 * lines have Magenta (the bar puts None under Black, and custom under custom). A colour saved
 * that's no longer here (Pale grey went) shows as the custom swatch, as any other does.
 */
export const FILL_COLOURS: { name: string; c: Rgb }[] = [
  { name: "Pale red", c: [1, 0.85, 0.85] },
  { name: "Pale orange", c: [1, 0.9, 0.78] },
  { name: "Pale yellow", c: [1, 0.97, 0.7] },
  { name: "Pale green", c: [0.85, 0.96, 0.85] },
  { name: "Pale blue", c: [0.85, 0.92, 1] },
  { name: "White", c: [1, 1, 1] },
];
