// Line weight steps for the properties bar's spinner: quarter points below 1 pt, half points
// up to 4 pt, whole points above, so the common CAD weights are each one click apart. Pure.

export const MAX_WEIGHT = 20;

/** The step size at a weight, going up (going down, the step just below it). */
function stepAt(w: number): number {
  return w < 1 ? 0.25 : w < 4 ? 0.5 : 1;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** The next weight up (dir 1) or down (dir -1), on the step grid, kept within [min, MAX_WEIGHT]. */
export function stepWeight(w: number, dir: 1 | -1, min: number): number {
  const eps = 1e-9;
  let next: number;
  if (dir > 0) {
    const s = stepAt(w + eps);
    next = Math.floor(w / s + eps) * s + s;
  } else {
    const s = stepAt(w - eps);
    next = Math.ceil(w / s - eps) * s - s;
  }
  return clampWeight(next, min);
}

export function clampWeight(w: number, min: number): number {
  return round(Math.min(MAX_WEIGHT, Math.max(min, w)));
}

/** A typed weight ("1.5", "2 pt", "0,5"), or null if it isn't one. */
export function parseWeight(s: string, min: number): number | null {
  const m = /^\s*(\d+(?:[.,]\d*)?|[.,]\d+)\s*(?:pt)?\s*$/i.exec(s);
  if (!m) return null;
  return clampWeight(Number(m[1].replace(",", ".")), min);
}

/** How a weight reads in the field: "1.5", "0.25". */
export const showWeight = (w: number) => String(round(w));

/** Every weight on the step grid from `min` to MAX_WEIGHT: the stops of the weight slider. */
export function weightSteps(min: number): number[] {
  const out = [clampWeight(min, min)];
  for (;;) {
    const next = stepWeight(out[out.length - 1], 1, min);
    if (next <= out[out.length - 1]) return out;
    out.push(next);
  }
}

/** The slider stop nearest a weight (an off-grid weight sits at its nearest stop). */
export function nearestStep(steps: number[], w: number): number {
  let best = 0;
  for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i] - w) < Math.abs(steps[best] - w)) best = i;
  return best;
}
