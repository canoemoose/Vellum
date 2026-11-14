// The line patterns the properties bar offers, in points on paper. Dots are near-zero dashes
// drawn with round caps. Pure.

export interface DashOption {
  name: string;
  dash: number[] | null;
}

export const DASHES: DashOption[] = [
  { name: "Solid", dash: null },
  { name: "Dashed", dash: [4, 3] },
  { name: "Long dashes", dash: [10, 4] },
  { name: "Short dashes", dash: [2, 2] },
  { name: "Dotted", dash: [0.1, 3] },
  { name: "Dash dot", dash: [8, 3, 0.1, 3] },
];

export function sameDash(a: number[] | null, b: number[] | null): boolean {
  if (!a?.length || !b?.length) return !a?.length && !b?.length;
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
}

/** The offered pattern a dash matches, or null for one set some other way. */
export const dashOption = (d: number[] | null): DashOption | null => DASHES.find((o) => sameDash(o.dash, d)) ?? null;
