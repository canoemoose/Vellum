// Where a movable, resizable dialog sits inside the app window (the Print and Manual layout
// dialogs). Pure: the action in components/floating.ts applies the boxes.

export interface FloatBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface Limits {
  /** The app window, CSS px. */
  vw: number;
  vh: number;
  minW: number;
  minH: number;
  /** Space kept clear round the window's edge. */
  margin: number;
}

/**
 * Keep a box inside the window: no bigger than the window less its margin (nor smaller than the
 * minimum, unless the window itself is), then moved back inside.
 */
export function clampBox(b: FloatBox, lim: Limits): FloatBox {
  const maxW = Math.max(1, lim.vw - 2 * lim.margin);
  const maxH = Math.max(1, lim.vh - 2 * lim.margin);
  const w = Math.min(maxW, Math.max(Math.min(lim.minW, maxW), b.w));
  const h = Math.min(maxH, Math.max(Math.min(lim.minH, maxH), b.h));
  const x = Math.min(lim.vw - lim.margin - w, Math.max(lim.margin, b.x));
  const y = Math.min(lim.vh - lim.margin - h, Math.max(lim.margin, b.y));
  return { x, y, w, h };
}

/** A box of the given size in the middle of the window. */
export function centred(w: number, h: number, lim: Limits): FloatBox {
  return clampBox({ x: (lim.vw - w) / 2, y: (lim.vh - h) / 2, w, h }, { ...lim, minW: 0, minH: 0 });
}

/** Dragged by the header. */
export function moved(b: FloatBox, dx: number, dy: number, lim: Limits): FloatBox {
  return clampBox({ ...b, x: b.x + dx, y: b.y + dy }, lim);
}

/**
 * Dragged by an edge or corner: that side follows the pointer, the opposite side stays put, down
 * to the minimum size and out to the window's margin.
 */
export function resized(b: FloatBox, edge: Edge, dx: number, dy: number, lim: Limits): FloatBox {
  let x0 = b.x;
  let y0 = b.y;
  let x1 = b.x + b.w;
  let y1 = b.y + b.h;
  const minW = Math.min(lim.minW, lim.vw - 2 * lim.margin);
  const minH = Math.min(lim.minH, lim.vh - 2 * lim.margin);
  if (edge.includes("w")) x0 = Math.min(x1 - minW, Math.max(lim.margin, x0 + dx));
  if (edge.includes("e")) x1 = Math.max(x0 + minW, Math.min(lim.vw - lim.margin, x1 + dx));
  if (edge.includes("n")) y0 = Math.min(y1 - minH, Math.max(lim.margin, y0 + dy));
  if (edge.includes("s")) y1 = Math.max(y0 + minH, Math.min(lim.vh - lim.margin, y1 + dy));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A saved box, if it's a usable one (anything else is ignored and the default used). */
export function parseBox(v: unknown): FloatBox | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (!ok(o.x) || !ok(o.y) || !ok(o.w) || !ok(o.h) || o.w <= 0 || o.h <= 0) return null;
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}
