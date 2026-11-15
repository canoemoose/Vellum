// Note: a sticky-note icon placed at a click, its wording typed in a small editor beside it
// (components/NoteLayer.svelte), shown when the pointer rests on it. Saved as a Text annotation
// with the wording in /Contents and /Name /Note; no Popup is written (other apps make their own).
// The icon is a fixed size on screen at any zoom, as other apps draw notes: its drawing is
// pinned (draw.ts, PathOp.pin), and its box for picking is the size it was last drawn (pin.ts).
// In the file it's written 20 points square at its place, with the NoZoom flag.

import { type MarkupBase, type Pt, type Rect, type Rgb, LINE_STYLE } from "../base";
import { type Op, type Seg } from "../draw";
import { pinned } from "../pin";
import { defineKind } from "./kind";

export interface NoteMarkup extends MarkupBase {
  kind: "note";
  /** The icon's top-left corner. */
  at: Pt;
  text: string;
}

declare module "../base" {
  interface MarkupKinds {
    note: NoteMarkup;
  }
}

/** The icon's size: CSS pixels on screen, points in the file. */
export const NOTE_SIZE = 20;

/** The icon's box on the page at the zoom it was last drawn. */
export function noteBox(m: NoteMarkup): Rect {
  const s = pinned(NOTE_SIZE);
  return [m.at[0], m.at[1], m.at[0] + s, m.at[1] + s];
}

/** The icon: a sheet with a turned-down corner and three lines of writing, in the note's colour. */
export function noteOps(m: NoteMarkup): Op[] {
  const [x, y] = m.at;
  const S = NOTE_SIZE;
  const fold = 6;
  const c = m.style.stroke;
  // The outline and writing: the colour darkened, so a pale note still reads on white.
  const ink: Rgb = [c[0] * 0.45, c[1] * 0.45, c[2] * 0.45];
  const P = (dx: number, dy: number): [number, number] => [x + dx, y + dy];
  const sheet: Seg[] = [["M", ...P(0.5, 0.5)], ["L", ...P(S - fold, 0.5)], ["L", ...P(S - 0.5, fold)], ["L", ...P(S - 0.5, S - 0.5)], ["L", ...P(0.5, S - 0.5)], ["Z"]];
  const corner: Seg[] = [["M", ...P(S - fold, 0.5)], ["L", ...P(S - fold, fold)], ["L", ...P(S - 0.5, fold)]];
  const lines: Seg[] = [4, 8, 12].flatMap((dy, i) => [["M", ...P(4, 5 + dy)], ["L", ...P(i === 2 ? 11 : 15, 5 + dy)]] as Seg[]);
  const o = m.style.opacity;
  const pin: Pt = m.at;
  return [
    { t: "path", segs: sheet, stroke: ink, fill: c, width: 1, dash: null, strokeOpacity: o, fillOpacity: o, pin },
    { t: "path", segs: [...corner, ...lines], stroke: ink, fill: null, width: 1.2, dash: null, strokeOpacity: o, fillOpacity: o, pin },
  ];
}

export const note = defineKind<NoteMarkup>({
  kind: "note",
  label: "Note",
  defaultStyle: () => ({ ...LINE_STYLE, stroke: [0.95, 0.78, 0.0], width: 1 }),
  controls: { fill: false, ends: false, text: false },
  // Placed centred on the click (in the icon's size on screen at this zoom).
  draw: { gesture: "place", make: (p) => ({ at: [p[0] - pinned(NOTE_SIZE / 2), p[1] - pinned(NOTE_SIZE / 2)], text: "" }) },
  ops: noteOps,
  spec(m, _f, spec) {
    spec.subtype = "Text";
    spec.contents = m.text;
    spec.icon = "Note";
    // Print, and NoZoom: a fixed size on screen in apps that honour it, as here.
    spec.flags = 4 | 8;
    delete spec.borderWidth;
    delete spec.dash;
    delete spec.interior;
  },
  bounds: noteBox,
  hits(m, p, t) {
    const b = noteBox(m);
    return p[0] >= b[0] - t && p[0] <= b[2] + t && p[1] >= b[1] - t && p[1] <= b[3] + t;
  },
  // No grips (it isn't resized); selected, it shows its box.
  handles: () => [],
  dragHandle: (m) => m,
  moveBy: (m, dx, dy) => ({ ...m, at: [m.at[0] + dx, m.at[1] + dy] }),
  lineless: true,
});
