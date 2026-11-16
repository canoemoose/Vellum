// The colours offered for lines and lettering: the context bar's palette, and a text stamp's
// (Matt's review: the same, not a smaller stamp-only set). Pure.

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
