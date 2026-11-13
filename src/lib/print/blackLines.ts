// Black lines for the print preview: the same adaptive thresholding as the printed output
// (src-tauri/src/print/job.rs, black_lines), on RGBA canvas pixels. Each dot is judged against
// the paper around it, so a scan's texture and uneven tone drop out and its lines print black;
// mostly dark paper (a blueprint) is read inverted. Keep the two in step.

export const BLACK_SENSITIVITY_DEFAULT = 60;
/** Half the side of the neighbourhood a dot is compared with, in sheet points (1.5 mm). */
export const BLACK_RADIUS_PT = (1.5 / 25.4) * 72;
const PAPER_WHITE = 235;
const SOLID_DARK = 60;

const clampS = (s: number) => Math.min(100, Math.max(0, Math.round(s)));

/** How much darker than its surroundings a dot must be to count as a line, percent: 100 at
 * sensitivity 0 (nothing counts), 20 at the default 60, 5 at 100. */
export function blackMargin(sensitivity: number): number {
  const off = 100 - clampS(sensitivity);
  return 5 + Math.floor((95 * off * off) / 10000);
}

/** Darker than this always counts as a mark: solid black from half sensitivity up, fading out
 * below so the far end drops everything. */
export function blackSolid(sensitivity: number): number {
  return Math.floor((SOLID_DARK * Math.min(50, clampS(sensitivity))) / 50);
}

/** A dot's darkness: its darkest channel, so coloured lines count as dark as black ones. */
const markValue = (d: Uint8ClampedArray | Uint8Array, i: number) => Math.min(d[i], d[i + 1], d[i + 2]);

/** Whether most of the picture is dark (a blueprint). */
export function isDarkSheet(d: Uint8ClampedArray | Uint8Array): boolean {
  const n = d.length / 4;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) if (markValue(d, i) < 128) dark++;
  return n > 0 && dark * 2 > n;
}

/** A rectangle in pixels, end-exclusive. */
export interface PxRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Black lines page by page over a `w` x `h` RGBA picture, in place: each rectangle (a placed
 * page) is judged on its own, with its own blueprint check, so the paper round it doesn't count
 * as its surroundings. Pixels outside every rectangle are left alone.
 */
export function blackLinesIn(d: Uint8ClampedArray | Uint8Array, w: number, h: number, pages: PxRect[], sensitivity: number, radius: number): void {
  for (const p of pages) {
    const x0 = Math.max(0, Math.floor(p.x0));
    const y0 = Math.max(0, Math.floor(p.y0));
    const x1 = Math.min(w, Math.ceil(p.x1));
    const y1 = Math.min(h, Math.ceil(p.y1));
    if (x1 <= x0 || y1 <= y0) continue;
    const pw = x1 - x0;
    const part = new Uint8ClampedArray(pw * (y1 - y0) * 4);
    for (let y = y0; y < y1; y++) part.set(d.subarray((y * w + x0) * 4, (y * w + x1) * 4), (y - y0) * pw * 4);
    blackLines(part, pw, sensitivity, radius);
    for (let y = y0; y < y1; y++) d.set(part.subarray((y - y0) * pw * 4, (y - y0 + 1) * pw * 4), (y * w + x0) * 4);
  }
}

/** Black lines over a `w`-wide RGBA picture, in place. `radius` in px (at least 1). */
export function blackLines(d: Uint8ClampedArray | Uint8Array, w: number, sensitivity: number, radius: number, invert = isDarkSheet(d)): void {
  if (w <= 0) return;
  const h = Math.floor(d.length / 4 / w);
  const r = Math.max(1, Math.round(radius));
  const margin = blackMargin(sensitivity);
  const solid = blackSolid(sensitivity);
  const v = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const m = markValue(d, i * 4);
    v[i] = invert ? 255 - m : m;
  }
  const cols = new Float64Array(w);
  const prefix = new Float64Array(w + 1);
  let top = 0;
  let bottom = 0;
  for (let y = 0; y < h; y++) {
    const wantTop = Math.max(0, y - r);
    const wantBottom = Math.min(h, y + r + 1);
    for (; bottom < wantBottom; bottom++) for (let x = 0; x < w; x++) cols[x] += v[bottom * w + x];
    for (; top < wantTop; top++) for (let x = 0; x < w; x++) cols[x] -= v[top * w + x];
    for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + cols[x];
    const rows = bottom - top;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const mean = (prefix[x1] - prefix[x0]) / (rows * (x1 - x0));
      const val = v[y * w + x];
      const line = val < solid || (val < PAPER_WHITE && val * 100 < mean * (100 - margin));
      const out = line ? 0 : 255;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = out;
    }
  }
}
