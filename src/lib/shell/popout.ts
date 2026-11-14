// Where a pop-out from the properties bar opens (the weight slider, the dash patterns): beside
// the control that opened it, on the side away from the bar's edge, kept inside the window. Pure.

export type Out = "down" | "up" | "left" | "right";

export const POPOUT_GAP = 8;
const MARGIN = 4;

/** The pop-out's top-left corner for a w x h pop-out opened from `a`, in a W x H window. */
export function popoutPosition(a: { left: number; top: number; right: number; bottom: number }, w: number, h: number, out: Out, W: number, H: number): { left: number; top: number } {
  let left = (a.left + a.right) / 2 - w / 2;
  let top = (a.top + a.bottom) / 2 - h / 2;
  if (out === "down") top = a.bottom + POPOUT_GAP;
  else if (out === "up") top = a.top - POPOUT_GAP - h;
  else if (out === "right") left = a.right + POPOUT_GAP;
  else left = a.left - POPOUT_GAP - w;
  return {
    left: Math.max(MARGIN, Math.min(W - w - MARGIN, left)),
    top: Math.max(MARGIN, Math.min(H - h - MARGIN, top)),
  };
}

/** The pop-out direction for a bar docked on an edge: away from it. */
export const outFrom = (edge: "top" | "bottom" | "left" | "right"): Out =>
  ({ top: "down", bottom: "up", left: "right", right: "left" } as const)[edge];
