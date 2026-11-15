// Imperial units for measuring (stage 5 [A9] of docs/editing-tool-consistency-brief.md): feet
// and inches with fractions, reading lengths typed in feet and inches, and architectural and
// engineering scales (1/4" = 1'-0" is 1:48, 1" = 20' is 1:240). Values everywhere else are held
// in millimetres and scales as ratios; this only writes and reads the text. Pure, and a leaf:
// markup/measure.ts builds its formatting on it, and the shell's scale box reads scales with it.

export const MM_PER_IN = 25.4;
export const MM_PER_FT = 304.8;
export const MM2_PER_FT2 = MM_PER_FT * MM_PER_FT;

/** The fraction precisions offered, as denominators: 1/2" to 1/64". */
export const FRACTIONS = [2, 4, 8, 16, 32, 64] as const;
export const DEFAULT_FRACTION = 16;

/** A denominator that's one of FRACTIONS, else the default. */
export const sanitiseFraction = (d: unknown): number => (FRACTIONS as readonly unknown[]).includes(d) ? (d as number) : DEFAULT_FRACTION;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** n/d in its lowest terms (16/32 is 1/2). A zero numerator gives [0, 1]. */
export function reduceFraction(n: number, d: number): [number, number] {
  if (n === 0) return [0, 1];
  const g = gcd(n, d);
  return [n / g, d / g];
}

/** Inches split for writing: rounded to the nearest 1/denom first, so the carry is right (11' 11 63/64" can round up to 12' 0"). */
export interface InchParts {
  neg: boolean;
  /** Whole feet: 0 unless split into feet. */
  ft: number;
  /** Whole inches, under 12 when split into feet. */
  inch: number;
  /** The fraction left over, reduced: [0, 1] for none. */
  num: number;
  den: number;
}

export function splitInches(inches: number, denom: number, feet: boolean): InchParts {
  const total = Math.round(Math.abs(inches) * denom); // in 1/denom inches
  const perFt = 12 * denom;
  const ft = feet ? Math.floor(total / perFt) : 0;
  const rest = total - ft * perFt;
  const [num, den] = reduceFraction(rest % denom, denom);
  // No "-0": a negative value that rounds to nothing reads as nothing.
  return { neg: inches < 0 && total > 0, ft, inch: Math.floor(rest / denom), num, den };
}

/** "4 1/2", "4", "1/2", "0": whole inches and a fraction, no mark. `whole` keeps a 0 before a fraction ("0 1/2"). */
function inchText(p: InchParts, whole = false): string {
  if (p.num === 0) return String(p.inch);
  return p.inch || whole ? `${p.inch} ${p.num}/${p.den}` : `${p.num}/${p.den}`;
}

/** Feet and inches with a fraction, as drawings write them: 12' 4 1/2", 12' 0", 3' 0 3/16". */
export function formatFeetInches(inches: number, denom: number = DEFAULT_FRACTION): string {
  const p = splitInches(inches, denom, true);
  return `${p.neg ? "-" : ""}${p.ft}' ${inchText(p, true)}"`;
}

/** Inches with a fraction: 148 1/2", 1/2", 0". */
export function formatFracInches(inches: number, denom: number = DEFAULT_FRACTION): string {
  const p = splitInches(inches, denom, false);
  return `${p.neg ? "-" : ""}${inchText(p)}"`;
}

// ---------------------------------------------------------------- reading typed lengths

const NUM = String.raw`(\d+(?:\.\d*)?|\.\d+)`;
const FRAC = String.raw`(\d+)\s*\/\s*(\d+)`;
// Feet (optional), then inches as a number with an optional fraction ("4 1/2", "4-1/2") or a
// fraction alone, then the inch mark (optional when there are feet before it).
const IMPERIAL = new RegExp(String.raw`^(?:${NUM}\s*'\s*(?:-\s*)?)?(?:(?:${NUM}(?:(?:\s+|\s*-\s*)${FRAC})?|${FRAC})\s*(")?)?$`);

/**
 * A length typed in feet and inches, or in either alone, as inches: 12' 4 1/2", 12'-4 1/2",
 * 12'4", 148.5", 1/2", 12.38 ft, 12 ft 4 in, 148.5 in. Typographic primes and quotes are taken
 * too. A number with no mark is inches only when `bare` says so (calibration takes a bare
 * number as millimetres, so it doesn't). Null when it isn't a length.
 */
export function parseImperial(s: string, bare: "in" | null = null): number | null {
  const t = s
    .trim()
    .toLowerCase()
    .replace(/[′’‘`´]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/''/g, '"')
    .replace(/(^|[\d\s.])(?:feet|foot|ft)\.?(?![a-z])/g, "$1'")
    .replace(/(^|[\d\s.])(?:inches|inch|in)\.?(?![a-z])/g, '$1"');
  const m = IMPERIAL.exec(t);
  if (!m) return null;
  const [, ft, whole, n1, d1, n2, d2, mark] = m;
  const n = n1 ?? n2, d = d1 ?? d2;
  const hasInches = whole !== undefined || n !== undefined;
  if (ft === undefined && !hasInches) return null;
  if (ft === undefined && !mark && bare !== "in") return null;
  if (d !== undefined && Number(d) === 0) return null;
  const inches = (ft ? Number(ft) * 12 : 0) + (whole ? Number(whole) : 0) + (n !== undefined ? Number(n) / Number(d) : 0);
  return Number.isFinite(inches) ? inches : null;
}

// ---------------------------------------------------------------- scales

const isWhole = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;

/**
 * A scale written as two lengths: 1/4" = 1'-0" (1:48), 1" = 20' (1:240), 3/32" = 1'. The left
 * may be a bare number of inches; the right needs its mark. Null when it isn't one.
 */
export function parseLengthScale(s: string): number | null {
  const parts = s.split("=");
  if (parts.length !== 2) return null;
  const paper = parseImperial(parts[0], "in");
  const real = parseImperial(parts[1]);
  if (paper === null || real === null || !(paper > 0) || !(real > 0)) return null;
  return real / paper;
}

/**
 * A ratio written the imperial way, when it is one: architectural (some 64ths of an inch to the
 * foot: 1/4" = 1'-0", 1 1/2" = 1'-0", 12" = 1'-0" at full size), else engineering (an inch to
 * whole feet: 1" = 20'). Null for any other ratio (1:100 stays 1:100).
 */
export function imperialScaleText(ratio: number): string | null {
  if (!(ratio >= 1) || !Number.isFinite(ratio)) return null;
  const perFoot = 12 / ratio; // inches on paper to a foot
  if (isWhole(perFoot * 64)) return `${inchText(splitInches(perFoot, 64, false))}" = 1'-0"`;
  if (isWhole(ratio / 12)) return `1" = ${Math.round(ratio / 12)}'`;
  return null;
}

/** The scales offered in an imperial view, as ratios: architectural (small to large) and engineering. */
export const ARCHITECTURAL_SCALES = [192, 128, 96, 64, 48, 32, 24, 16, 12, 8, 4];
export const ENGINEERING_SCALES = [120, 240, 360, 480, 600, 720, 1200];
