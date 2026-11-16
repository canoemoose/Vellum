// Where the floating properties bar sits: against one edge of the drawing area, anywhere
// along it, snapping to the middle. Pure.

export type Edge = "top" | "bottom" | "left" | "right";

export interface Dock {
  edge: Edge;
  /** Where the bar's centre is along the edge, 0 (start) to 1 (end); 0.5 is the middle. */
  t: number;
}

export const DEFAULT_DOCK: Dock = { edge: "top", t: 0.5 };
/** Gap between the bar and the edge, CSS px. */
export const DOCK_MARGIN = 10;
/** Within this many CSS px of an edge's middle, the bar snaps to it. */
export const SNAP_PX = 24;

export const isSide = (e: Edge) => e === "left" || e === "right";

/**
 * The dock for a bar dragged to (x, y) in a W x H area: the nearest edge, the position along
 * it (kept so a w x h bar fits), snapped to the middle when close. The bar's size is as laid out
 * on that edge (vertical bars on the sides). `grip(edge)` is how far along the bar, from its
 * start, the pointer holds it (the grip), so the grip stays under the pointer rather than the
 * bar jumping to centre itself there.
 */
export function dockAt(
  x: number, y: number, W: number, H: number, size: (e: Edge) => { w: number; h: number },
  grip: (e: Edge) => number = (e) => (isSide(e) ? size(e).h : size(e).w) / 2, snap = SNAP_PX,
): Dock {
  const d: Record<Edge, number> = { top: y, bottom: H - y, left: x, right: W - x };
  const edge = (Object.keys(d) as Edge[]).reduce((a, b) => (d[b] < d[a] ? b : a));
  const { w, h } = size(edge);
  const len = isSide(edge) ? H : W;
  const half = (isSide(edge) ? h : w) / 2;
  // The bar's centre: the pointer, less the grip's distance from the bar's start, plus half the bar.
  let along = (isSide(edge) ? y : x) - grip(edge) + half;
  if (Math.abs(along - len / 2) <= snap) along = len / 2;
  const lo = Math.min(len / 2, half + DOCK_MARGIN);
  const hi = Math.max(len / 2, len - half - DOCK_MARGIN);
  along = Math.min(hi, Math.max(lo, along));
  return { edge, t: len > 0 ? along / len : 0.5 };
}

/** The bar's top-left corner in the area for a dock, kept inside the area. */
export function dockPosition(d: Dock, W: number, H: number, w: number, h: number): { left: number; top: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(lo, hi), Math.max(lo, v));
  switch (d.edge) {
    case "top":
      return { left: clamp(d.t * W - w / 2, DOCK_MARGIN, W - w - DOCK_MARGIN), top: DOCK_MARGIN };
    case "bottom":
      return { left: clamp(d.t * W - w / 2, DOCK_MARGIN, W - w - DOCK_MARGIN), top: Math.max(DOCK_MARGIN, H - h - DOCK_MARGIN) };
    case "left":
      return { left: DOCK_MARGIN, top: clamp(d.t * H - h / 2, DOCK_MARGIN, H - h - DOCK_MARGIN) };
    case "right":
      return { left: Math.max(DOCK_MARGIN, W - w - DOCK_MARGIN), top: clamp(d.t * H - h / 2, DOCK_MARGIN, H - h - DOCK_MARGIN) };
  }
}

export function sanitiseDock(v: unknown): Dock {
  const d = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const edge = d.edge === "bottom" || d.edge === "left" || d.edge === "right" ? d.edge : "top";
  const t = typeof d.t === "number" && Number.isFinite(d.t) ? Math.min(1, Math.max(0, d.t)) : 0.5;
  return { edge, t };
}
