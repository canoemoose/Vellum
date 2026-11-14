// Drawn signatures: strokes captured with a mouse or pen, cleaned up as each stroke ends, and
// drawn as smooth curves. Pure (no DOM), so it's tested; rendering goes through the small
// `Ctx` interface, which a canvas 2D context satisfies.
//
// Capture keeps every pointer position (coalesced events included), which is thousands of
// points for a signature. When a stroke ends it is:
//  1. thinned: points closer than MIN_STEP to the last kept one are dropped (a pen at rest
//     reports the same spot over and over);
//  2. smoothed: a [1 2 1] average, twice, with the ends pinned (takes out hand and digitiser
//     jitter without rounding off the stroke's start and end);
//  3. simplified: Ramer-Douglas-Peucker to within TOLERANCE, so straight runs keep only their
//     ends and curves keep what they need.
// It's then drawn as quadratic curves through the midpoints between points, which is smooth
// even where the simplified points are far apart.
//
// Pressure is ignored (agreed default: ink annotations have one width).

export interface Pt {
  x: number;
  y: number;
}
export type Stroke = Pt[];

/** Pad pixels. Points this close to the previous one are dropped while capturing. */
export const MIN_STEP = 0.75;
/** Pad pixels: how far the simplified stroke may stray from the smoothed one. */
export const TOLERANCE = 0.35;
/** Pen width in pad pixels (the pad is drawn at this; exports scale it). */
export const PEN_WIDTH = 2.6;

const dist2 = (a: Pt, b: Pt) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Drop points within `step` of the last kept point. The last point is kept unless it's where
 * the last kept one is. */
export function thin(points: Stroke, step = MIN_STEP): Stroke {
  if (points.length <= 1) return points.slice();
  const out = [points[0]];
  const s2 = step * step;
  for (let i = 1; i < points.length - 1; i++) {
    if (dist2(points[i], out[out.length - 1]) >= s2) out.push(points[i]);
  }
  const last = points[points.length - 1];
  if (dist2(last, out[out.length - 1]) > 0) out.push(last);
  return out;
}

/** A [1 2 1] average `passes` times, the ends pinned. */
export function smooth(points: Stroke, passes = 2): Stroke {
  let p = points.slice();
  if (p.length < 3) return p;
  for (let k = 0; k < passes; k++) {
    const q = [p[0]];
    for (let i = 1; i < p.length - 1; i++) {
      q.push({ x: (p[i - 1].x + 2 * p[i].x + p[i + 1].x) / 4, y: (p[i - 1].y + 2 * p[i].y + p[i + 1].y) / 4 });
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/** Distance from `p` to the segment a-b. */
export function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt(dist2(p, a));
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.sqrt(dist2(p, { x: a.x + t * dx, y: a.y + t * dy }));
}

/** Ramer-Douglas-Peucker, iterative (a long stroke would overflow a recursive one). */
export function simplify(points: Stroke, tolerance = TOLERANCE): Stroke {
  const n = points.length;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(points[i], points[a], points[b]);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Thin, smooth and simplify a captured stroke. A single touch stays one point (a dot). */
export function finishStroke(raw: Stroke, tolerance = TOLERANCE): Stroke {
  if (raw.length === 0) return [];
  const t = thin(raw);
  if (t.length === 1 || t.every((p) => dist2(p, t[0]) < MIN_STEP * MIN_STEP)) return [t[0]];
  return simplify(smooth(t), tolerance);
}

/** A drawing being made: finished strokes, the stroke in progress, undo and clear. */
export class Drawing {
  strokes: Stroke[] = [];
  live: Stroke | null = null;

  begin(p: Pt): void {
    this.live = [p];
  }

  extend(p: Pt): void {
    this.live?.push(p);
  }

  /** Finish the stroke in progress. Returns it, or null if there wasn't one. */
  end(): Stroke | null {
    if (!this.live) return null;
    const s = finishStroke(this.live);
    this.live = null;
    if (s.length) this.strokes.push(s);
    return s.length ? s : null;
  }

  /** Abandon the stroke in progress (pointer cancelled). */
  cancel(): void {
    this.live = null;
  }

  undo(): boolean {
    if (this.live) {
      this.live = null;
      return true;
    }
    return this.strokes.pop() !== undefined;
  }

  clear(): void {
    this.strokes = [];
    this.live = null;
  }

  get isEmpty(): boolean {
    return this.strokes.length === 0 && !this.live;
  }

  get pointCount(): number {
    return this.strokes.reduce((n, s) => n + s.length, 0);
  }
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The strokes' bounds (centre lines; add half the pen width for ink), or null if empty. */
export function bounds(strokes: Stroke[]): Box | null {
  let b: Box | null = null;
  for (const s of strokes) {
    for (const p of s) {
      if (!b) b = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      else {
        b.x0 = Math.min(b.x0, p.x);
        b.y0 = Math.min(b.y0, p.y);
        b.x1 = Math.max(b.x1, p.x);
        b.y1 = Math.max(b.y1, p.y);
      }
    }
  }
  return b;
}

/** What a canvas 2D context needs to draw strokes. */
export interface Ctx {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  stroke(): void;
  fill(): void;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
}

/** Trace one stroke (two or more points) as curves through the midpoints. */
function trace(ctx: Ctx, s: Stroke, map: (p: Pt) => Pt): void {
  const p = s.map(map);
  ctx.moveTo(p[0].x, p[0].y);
  if (p.length === 2) {
    ctx.lineTo(p[1].x, p[1].y);
    return;
  }
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i].x + p[i + 1].x) / 2;
    const my = (p[i].y + p[i + 1].y) / 2;
    ctx.quadraticCurveTo(p[i].x, p[i].y, mx, my);
  }
  const last = p[p.length - 1];
  ctx.lineTo(last.x, last.y);
}

export interface DrawOpts {
  colour: string;
  /** Pen width in output pixels. */
  width: number;
  /** Pad point to output point. */
  map?: (p: Pt) => Pt;
}

/** Draw strokes. Single points are dots (a filled circle the pen's width across). */
export function drawStrokes(ctx: Ctx, strokes: Stroke[], o: DrawOpts): void {
  const map = o.map ?? ((p: Pt) => p);
  ctx.lineWidth = o.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = o.colour;
  ctx.fillStyle = o.colour;
  for (const s of strokes) {
    if (s.length === 0) continue;
    ctx.beginPath();
    if (s.length === 1) {
      const p = map(s[0]);
      ctx.arc(p.x, p.y, o.width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      trace(ctx, s, map);
      ctx.stroke();
    }
  }
}

/** The default ink for drawn signatures: near-black. */
export const INK = "#18181c";
/** The longest side of a drawn signature's PNG. */
export const MAX_EXPORT_SIDE = 1600;
/** Most pad-to-PNG magnification (a small scribble doesn't become a huge image). */
export const MAX_EXPORT_SCALE = 4;

export interface ExportPlan {
  width: number;
  height: number;
  scale: number;
  /** Pad point to PNG pixel. */
  map: (p: Pt) => Pt;
  penWidth: number;
}

/**
 * Size and placement of a drawing's PNG: cropped to the ink with a margin of one pen width
 * (plus half the pen, so round ends aren't clipped), scaled so the long side is at most
 * MAX_EXPORT_SIDE and the scale at most MAX_EXPORT_SCALE. Null for an empty drawing.
 */
export function exportPlan(strokes: Stroke[], penWidth = PEN_WIDTH): ExportPlan | null {
  const b = bounds(strokes);
  if (!b) return null;
  const pad = penWidth * 1.5;
  const w = b.x1 - b.x0 + 2 * pad;
  const h = b.y1 - b.y0 + 2 * pad;
  const scale = Math.min(MAX_EXPORT_SCALE, MAX_EXPORT_SIDE / Math.max(w, h));
  const ox = b.x0 - pad;
  const oy = b.y0 - pad;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
    map: (p) => ({ x: (p.x - ox) * scale, y: (p.y - oy) * scale }),
    penWidth: penWidth * scale,
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** An SVG path's `d` for one stroke of two or more points. */
export function pathData(s: Stroke): string {
  const rec: string[] = [];
  const ctx = {
    moveTo: (x: number, y: number) => rec.push(`M${r1(x)} ${r1(y)}`),
    lineTo: (x: number, y: number) => rec.push(`L${r1(x)} ${r1(y)}`),
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) =>
      rec.push(`Q${r1(cx)} ${r1(cy)} ${r1(x)} ${r1(y)}`),
  } as unknown as Ctx;
  trace(ctx, s, (p) => p);
  return rec.join("");
}

/** The drawing as an SVG document (vector form), cropped like the PNG, in pad pixels. */
export function toSvg(strokes: Stroke[], penWidth = PEN_WIDTH, colour = INK): string | null {
  const b = bounds(strokes);
  if (!b) return null;
  const pad = penWidth * 1.5;
  const x = r1(b.x0 - pad);
  const y = r1(b.y0 - pad);
  const w = r1(b.x1 - b.x0 + 2 * pad);
  const h = r1(b.y1 - b.y0 + 2 * pad);
  const parts = strokes.map((s) =>
    s.length === 1
      ? `<circle cx="${r1(s[0].x)}" cy="${r1(s[0].y)}" r="${r1(penWidth / 2)}" fill="${colour}"/>`
      : `<path d="${pathData(s)}"/>`,
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">` +
    `<g fill="none" stroke="${colour}" stroke-width="${penWidth}" stroke-linecap="round" stroke-linejoin="round">` +
    parts.join("") +
    `</g></svg>`
  );
}

/** The stored form: version, pen width, colour, and each stroke as flat [x, y, x, y, ...] to
 * 0.1 px. `colour` is optional (absent means INK). */
export interface StoredDrawing {
  v: 1;
  pen: number;
  colour?: string;
  strokes: number[][];
}

export function serialise(strokes: Stroke[], penWidth = PEN_WIDTH, colour = INK): string {
  const d: StoredDrawing = {
    v: 1,
    pen: penWidth,
    colour,
    strokes: strokes.map((s) => s.flatMap((p) => [r1(p.x), r1(p.y)])),
  };
  return JSON.stringify(d);
}

/** Read the stored form back. Null for anything that isn't one. */
export function parse(json: string): { strokes: Stroke[]; pen: number; colour: string } | null {
  let d: unknown;
  try {
    d = JSON.parse(json);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object") return null;
  const o = d as Partial<StoredDrawing>;
  if (o.v !== 1 || typeof o.pen !== "number" || !(o.pen > 0) || !Array.isArray(o.strokes)) return null;
  const colour = o.colour === undefined ? INK : o.colour;
  if (typeof colour !== "string" || !/^#[0-9a-f]{6}$/i.test(colour)) return null;
  const strokes: Stroke[] = [];
  for (const flat of o.strokes) {
    if (!Array.isArray(flat) || flat.length < 2 || flat.length % 2) return null;
    if (!flat.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    const s: Stroke = [];
    for (let i = 0; i < flat.length; i += 2) s.push({ x: flat[i], y: flat[i + 1] });
    strokes.push(s);
  }
  return { strokes, pen: o.pen, colour };
}
