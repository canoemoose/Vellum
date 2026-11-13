// Sticky page edges while dragging: when a pan brings a page edge to the viewport edge (or
// centres a page narrower than the view), the view holds there for HOLD_PX more of drag,
// then carries on from where the pointer is minus the hold, so it never jumps.

export const HOLD_PX = 24;

/** One axis (tx or ty) of a drag pan. Keep one per axis for the length of a drag. */
export class StickyAxis {
  private held: { at: number; over: number } | null = null;

  constructor(private readonly hold = HOLD_PX) {}

  /** Forget any hold (a drag ended, or something else moved the view). */
  reset(): void {
    this.held = null;
  }

  /**
   * Move from position `p` by `d`, given the `stops` (positions where an edge lines up).
   * Returns the new position: held at a stop, or moved on.
   */
  move(p: number, d: number, stops: number[]): number {
    if (this.held) {
      const h = this.held;
      if (Math.abs(p - h.at) > 0.5) {
        this.held = null; // the view moved some other way: start afresh
      } else {
        h.over += d;
        if (Math.abs(h.over) <= this.hold) return h.at;
        this.held = null;
        return h.at + h.over - Math.sign(h.over) * this.hold;
      }
    }
    if (d === 0) return p;
    const q = p + d;
    let best: number | null = null;
    for (const s of stops) {
      const crossed = d > 0 ? s > p && s <= q : s < p && s >= q;
      if (crossed && (best === null || Math.abs(s - p) < Math.abs(best - p))) best = s;
    }
    if (best === null) return q;
    const over = q - best;
    if (Math.abs(over) > this.hold) return best + over - Math.sign(over) * this.hold;
    this.held = { at: best, over };
    return best;
  }
}

/** A page's extent on one axis in screen pixels: [start, end). */
export interface Span {
  a: number;
  b: number;
}

/**
 * The translations on one axis that line a page up with a viewport of length `len`: its
 * start at the viewport start, its end at the viewport end, and, for a page shorter than
 * the viewport, its centre at the centre. `t` is the current translation; spans are in
 * screen pixels at that translation.
 */
export function alignStops(spans: Span[], t: number, len: number): number[] {
  const out: number[] = [];
  for (const { a, b } of spans) {
    out.push(t - a); // start at 0
    out.push(t + (len - b)); // end at len
    if (b - a < len) out.push(t + (len / 2 - (a + b) / 2)); // centred
  }
  return out;
}
