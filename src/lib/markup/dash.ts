// The line patterns the properties bar offers, in points for a 1 pt line. Heavier lines scale
// them with their weight (drawnDash), so dashes and dots keep apart instead of running into each
// other. Dots are dashes of no length: the round caps draw them as circles a line wide. Pure.

export interface DashOption {
  name: string;
  dash: number[] | null;
}

export const DASHES: DashOption[] = [
  { name: "Solid", dash: null },
  { name: "Dashed", dash: [4, 3] },
  { name: "Long dashes", dash: [10, 4] },
  { name: "Short dashes", dash: [2, 2] },
  { name: "Dotted", dash: [0, 3] },
  { name: "Dash dot", dash: [8, 3, 0, 3] },
];

export function sameDash(a: number[] | null, b: number[] | null): boolean {
  if (!a?.length || !b?.length) return !a?.length && !b?.length;
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
}

/** A pattern as drawn on a line of weight `width`: scaled up with it, never down. */
export function drawnDash(dash: number[] | null, width: number): number[] | null {
  if (!dash?.length) return null;
  const k = Math.max(1, width);
  return dash.map((v) => Math.round(v * k * 1000) / 1000);
}

/** The offered pattern a dash matches, or null for one set some other way. */
export const dashOption = (d: number[] | null): DashOption | null => DASHES.find((o) => sameDash(o.dash, d)) ?? null;
