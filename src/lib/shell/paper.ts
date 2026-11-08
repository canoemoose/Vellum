// Paper-size naming and page-size text for the status bar ("A1 · 841 × 594 mm").

export const PT_TO_MM = 25.4 / 72;
export const MM_PER_IN = 25.4;

export type Units = "metric" | "imperial";

export interface NamedPaper {
  name: string;
  /** Short side, long side, mm. */
  w: number;
  h: number;
}

/** Sizes we name, short side first. ISO 216 A and B series, then US sizes. */
export const PAPERS: NamedPaper[] = [
  { name: "A0", w: 841, h: 1189 },
  { name: "A1", w: 594, h: 841 },
  { name: "A2", w: 420, h: 594 },
  { name: "A3", w: 297, h: 420 },
  { name: "A4", w: 210, h: 297 },
  { name: "A5", w: 148, h: 210 },
  { name: "A6", w: 105, h: 148 },
  { name: "B1", w: 707, h: 1000 },
  { name: "B2", w: 500, h: 707 },
  { name: "B3", w: 353, h: 500 },
  { name: "B4", w: 250, h: 353 },
  { name: "B5", w: 176, h: 250 },
  { name: "Letter", w: 215.9, h: 279.4 },
  { name: "Legal", w: 215.9, h: 355.6 },
  { name: "Tabloid", w: 279.4, h: 431.8 },
  { name: "ANSI C", w: 431.8, h: 558.8 },
  { name: "ANSI D", w: 558.8, h: 863.6 },
  { name: "ANSI E", w: 863.6, h: 1117.6 },
];

/** ISO 216 allows ±2 mm on sides over 600 mm; use that for everything (PDF rounding). */
export const PAPER_TOLERANCE_MM = 2;

/** The name of a page size in mm (either orientation), or null when it isn't a standard size. */
export function paperName(wMm: number, hMm: number, tol = PAPER_TOLERANCE_MM): string | null {
  const a = Math.min(wMm, hMm);
  const b = Math.max(wMm, hMm);
  for (const p of PAPERS) if (Math.abs(a - p.w) <= tol && Math.abs(b - p.h) <= tol) return p.name;
  return null;
}

/** Status bar page size: "A1 · 841 × 594 mm", "600 × 400 mm", "A4 · 8.27 × 11.69 in". */
export function pageSizeText(wPt: number, hPt: number, units: Units): string {
  const wMm = wPt * PT_TO_MM;
  const hMm = hPt * PT_TO_MM;
  const name = paperName(wMm, hMm);
  const dims =
    units === "imperial"
      ? `${(wMm / MM_PER_IN).toFixed(2)} × ${(hMm / MM_PER_IN).toFixed(2)} in`
      : `${Math.round(wMm)} × ${Math.round(hMm)} mm`;
  return name ? `${name} · ${dims}` : dims;
}

/**
 * The status bar's cursor position. The origin is the page's bottom-left corner with y up,
 * as in CAD. With a drawing scale the figures are real-world (metres, or feet in imperial);
 * without, they are on paper (mm, or inches).
 */
export function cursorText(
  xPt: number,
  yPt: number,
  pageHPt: number,
  ratio: number | null,
  units: Units,
): string {
  const xMm = xPt * PT_TO_MM;
  const yMm = (pageHPt - yPt) * PT_TO_MM;
  if (ratio) {
    if (units === "imperial") {
      const k = ratio / (MM_PER_IN * 12);
      return `X ${(xMm * k).toFixed(2)}  Y ${(yMm * k).toFixed(2)} ft`;
    }
    const k = ratio / 1000;
    return `X ${(xMm * k).toFixed(2)}  Y ${(yMm * k).toFixed(2)} m`;
  }
  if (units === "imperial") return `X ${(xMm / MM_PER_IN).toFixed(2)}  Y ${(yMm / MM_PER_IN).toFixed(2)} in`;
  return `X ${xMm.toFixed(1)}  Y ${yMm.toFixed(1)} mm`;
}
