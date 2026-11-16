// Note: a sticky-note icon placed at a click, its wording typed in a small editor beside it
// (components/NoteLayer.svelte), shown when the pointer rests on it, or all the time in a small
// box beside the icon when the note is pinned open. Saved as a Text annotation with the wording
// in /Contents and /Name /Note, and a Popup annotation beside it, /Open when pinned (so other
// apps show it open too), never printed: a callout is the tool for text that must print.
// The icon is a fixed size on screen at any zoom, as other apps draw notes: its drawing is
// pinned (draw.ts, PathOp.pin), and its box for picking is the size it was last drawn (pin.ts).
// In the file it's written 20 points square at its place, with the NoZoom flag.

import { type MarkupBase, type Pt, type Rect, type Rgb, LINE_STYLE } from "../base";
import { type Frame, rectToUser } from "../pdf";
import { r3 } from "../annotation";
import { type Op, type Seg } from "../draw";
import { pinned } from "../pin";
import { defineKind } from "./kind";

export interface NoteMarkup extends MarkupBase {
  kind: "note";
  /** The icon's top-left corner. */
  at: Pt;
  text: string;
  /** Pinned open: its text shows beside the icon all the time (/Open on its Popup). Absent on notes saved before pins: unpinned. */
  pinned?: boolean;
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

/** The pop-up's size in the file, in points (other apps draw their own window there). */
export const POPUP_W = 200;
export const POPUP_H = 120;

/**
 * The Popup annotation's box, in page points: beside the icon on its right as the page is
 * drawn upright, or on its left where the right has no room, its top level with the icon's,
 * kept on the page as far as it fits. `size` is the page's [width, height] in page points.
 */
export function popupRect(m: NoteMarkup, size: readonly [number, number], gap = 4): Rect {
  const [x, y] = m.at;
  const [pw, ph] = size;
  let x0 = x + NOTE_SIZE + gap;
  if (x0 + POPUP_W > pw && x - gap - POPUP_W >= 0) x0 = x - gap - POPUP_W;
  const y0 = Math.max(0, Math.min(y, ph - POPUP_H));
  return [x0, y0, x0 + POPUP_W, y0 + POPUP_H];
}

/** A page's size in page points (rotation applied) from its frame. */
export function frameSize(f: Frame): [number, number] {
  const w = f.bbox[2] - f.bbox[0], h = f.bbox[3] - f.bbox[1];
  return f.quarterTurns % 2 ? [h, w] : [w, h];
}

/**
 * Where a box `w` by `h` (CSS pixels) goes on screen beside a note's icon, whose corners are
 * `corners` on screen (a view rotation turns them, so the box is placed from their extent and
 * stays upright): right of the icon, its top level with the icon's. Given the drawing `area`,
 * it goes left of the icon where the right has no room and is kept inside the area with a
 * margin (the editor); without one it simply travels with the icon (a pinned note's box). Pure.
 */
export function besideIcon(corners: readonly (readonly [number, number])[], w: number, h: number, area: { w: number; h: number } | null, gap = 6, margin = 6): { x: number; y: number } {
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const l = Math.min(...xs), r = Math.max(...xs), t = Math.min(...ys);
  let x = r + gap;
  if (!area) return { x, y: t };
  if (x + w > area.w - margin && l - gap - w >= margin) x = l - gap - w;
  x = Math.max(margin, Math.min(x, area.w - w - margin));
  const y = Math.max(margin, Math.min(t, area.h - h - margin));
  return { x, y };
}

export const note = defineKind<NoteMarkup>({
  kind: "note",
  label: "Note",
  defaultStyle: () => ({ ...LINE_STYLE, stroke: [0.95, 0.78, 0.0], width: 1 }),
  controls: { fill: false, ends: false, text: false },
  // Placed centred on the click (in the icon's size on screen at this zoom).
  draw: { gesture: "place", make: (p) => ({ at: [p[0] - pinned(NOTE_SIZE / 2), p[1] - pinned(NOTE_SIZE / 2)], text: "" }) },
  ops: noteOps,
  spec(m, f, spec) {
    spec.subtype = "Text";
    spec.contents = m.text;
    spec.icon = "Note";
    // Print, and NoZoom: a fixed size on screen in apps that honour it, as here.
    spec.flags = 4 | 8;
    // Its pop-up, open when pinned (stage 7). Written for an unpinned note too, closed, as
    // other apps write them, so pinning and unpinning only ever change /Open.
    spec.popup = { rect: rectToUser(f, popupRect(m, frameSize(f))).map(r3) as [number, number, number, number], open: !!m.pinned };
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
  typesAfter: true,
  keepEmpty: () => true,
});
