// Removing a picture's background for an image stamp (docs/stamp-library-dialogs-scope.md,
// step 5). Unlike a signature's knock-out (src-tauri/src/signature/import.rs), which paints
// every pixel one ink colour, this keeps the picture's colours: only the background goes, and
// the anti-aliased edge round it is unmixed so it stays smooth without a pale fringe.
//
// "edges" clears only background joined to the picture's border (white inside a logo stays);
// "everywhere" clears every pixel close to the background colour (the inside of an O goes too).
// Pure: works on RGBA bytes, so it runs the same for the live preview and the saved stamp.

/** A colour as 0 to 255 per channel. */
export type Rgb8 = [number, number, number];

export type KnockMode = "edges" | "everywhere";

export interface Pixels {
  /** RGBA, row by row. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface KnockOptions {
  bg: Rgb8;
  /** 0 (only the exact colour) to 100 (very loose). */
  tolerance: number;
  mode: KnockMode;
  /**
   * "edges" only: enclosed areas to remove as well (the hole in an e), each a point inside it as
   * fractions of the picture (0 to 1), so the same points serve the preview and the full size.
   */
  holes?: [number, number][];
}

/** Source pixels more transparent than this count as background already. */
const CLEAR = 16;

/** How far a colour is from another: the most any one channel differs (0 to 255). */
export function distance(data: Uint8ClampedArray, i: number, bg: Rgb8): number {
  return Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
}

/**
 * The tolerance as a distance: pixels at or under it go completely. On a curve, so most of the
 * slider is fine steps near zero: a logo's solid background is one colour, give or take a little
 * JPEG noise (20 on the slider is 5 of 255); the far end (128) is for something rougher.
 */
export function hardLimit(tolerance: number): number {
  const f = Math.min(100, Math.max(0, tolerance)) / 100;
  return 128 * f * f;
}

/**
 * Whether a picture already has a transparent background (so there's nothing to remove): at
 * least 0.5% of it mostly transparent. A PNG saved with an alpha channel but every pixel opaque
 * doesn't count.
 */
export function hasTransparency(p: Pixels): boolean {
  const { data } = p;
  const n = p.width * p.height;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) clear++;
  return clear > 0 && clear >= n * 0.005;
}

/** The background's likely colour: the median of the border's opaque pixels (white if there are none). */
export function guessBackground(p: Pixels): Rgb8 {
  const { data, width: w, height: h } = p;
  const ch: number[][] = [[], [], []];
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 128) return;
    for (let c = 0; c < 3; c++) ch[c].push(data[i + c]);
  };
  for (let x = 0; x < w; x++) {
    take(x, 0);
    if (h > 1) take(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    take(0, y);
    if (w > 1) take(w - 1, y);
  }
  if (!ch[0].length) return [255, 255, 255];
  const median = (v: number[]) => {
    v.sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  return [median(ch[0]), median(ch[1]), median(ch[2])];
}

/**
 * Lone decisions overruled: a pixel whose call (background or not) is disagreed with by at least
 * 7 of its 8 neighbours (a lone speck) takes theirs. On a noisy picture (JPEG, a shadow's gradient) pixels
 * either side of the tolerance would otherwise leave specks and a hairy line; real edges, lines a
 * pixel wide and holes two across have too much agreement to move.
 */
export function tidy(raw: Uint8Array, w: number, h: number): Uint8Array {
  const out = raw.slice();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      let differ = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          const yy = y + dy;
          // Beyond the picture counts as agreeing.
          if (xx >= 0 && xx < w && yy >= 0 && yy < h && raw[yy * w + xx] !== raw[k]) differ++;
        }
      if (differ >= 7) out[k] = raw[k] ? 0 : 1;
    }
  return out;
}

/** Each pixel's distance from the background colour (clear pixels count as background). */
function distances(p: Pixels, bg: Rgb8): Float32Array {
  const n = p.width * p.height;
  const dist = new Float32Array(n);
  for (let k = 0; k < n; k++) dist[k] = p.data[k * 4 + 3] < CLEAR ? 0 : distance(p.data, k * 4, bg);
  return dist;
}

/** What's the background's colour: within the tolerance, lone specks either way overruled (tidy). 1 where it is. */
function backgroundColoured(dist: Float32Array, w: number, h: number, tolerance: number): Uint8Array {
  const t = hardLimit(tolerance);
  const raw = new Uint8Array(dist.length);
  for (let k = 0; k < dist.length; k++) raw[k] = dist[k] <= t ? 1 : 0;
  return tidy(raw, w, h);
}

/** A point given as fractions of the picture, as a pixel index (null outside it). */
function pointIndex(pt: [number, number], w: number, h: number): number | null {
  const x = Math.floor(pt[0] * w);
  const y = Math.floor(pt[1] * h);
  return x < 0 || y < 0 || x >= w || y >= h ? null : y * w + x;
}

/**
 * Flood through background-coloured pixels (4-connected, so a one-pixel diagonal outline still
 * walls in what's inside it) from `starts`, marking `into` with `mark`. Already marked pixels are
 * left alone.
 */
function flood(bgc: Uint8Array, w: number, starts: Iterable<number>, into: Uint8Array | Int32Array, mark: number, queue: Int32Array) {
  const n = bgc.length;
  let head = 0;
  let tail = 0;
  const seed = (k: number) => {
    if (!into[k] && bgc[k]) {
      into[k] = mark;
      queue[tail++] = k;
    }
  };
  for (const k of starts) seed(k);
  while (head < tail) {
    const k = queue[head++];
    const x = k % w;
    if (x > 0) seed(k - 1);
    if (x < w - 1) seed(k + 1);
    if (k >= w) seed(k - w);
    if (k < n - w) seed(k + w);
  }
}

function* border(w: number, h: number): Generator<number> {
  for (let x = 0; x < w; x++) {
    yield x;
    yield (h - 1) * w + x;
  }
  for (let y = 0; y < h; y++) {
    yield y * w;
    yield y * w + w - 1;
  }
}

/** The background-coloured areas of a picture, each numbered, for clicking holes on and off. */
export interface Regions {
  /** Each pixel's area (0: not the background's colour). */
  label: Int32Array;
  /** The areas joined to the border ("Outside only" removes these anyway). */
  outside: Set<number>;
  width: number;
  height: number;
}

/** Number the background-coloured areas (as `knockOut` sees them, so its holes are these areas). */
export function regions(p: Pixels, o: Pick<KnockOptions, "bg" | "tolerance">): Regions {
  const { width: w, height: h } = p;
  const bgc = backgroundColoured(distances(p, o.bg), w, h, o.tolerance);
  const label = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let next = 0;
  for (let k = 0; k < label.length; k++) if (bgc[k] && !label[k]) flood(bgc, w, [k], label, ++next, queue);
  const outside = new Set<number>();
  for (const k of border(w, h)) if (label[k]) outside.add(label[k]);
  return { label, outside, width: w, height: h };
}

/** The area a point (fractions of the picture) is in: 0 if it isn't the background's colour. */
export function regionAt(r: Regions, pt: [number, number]): number {
  const k = pointIndex(pt, r.width, r.height);
  return k === null ? 0 : r.label[k];
}

/** How far round the removed background an edge pixel may be and still be unmixed. */
const EDGE_REACH = 2;

/**
 * The picture with its background removed, as new RGBA bytes.
 *
 * First the background itself: pixels within the tolerance of its colour (joined to the border,
 * or anywhere). Then the edge round it, up to EDGE_REACH pixels deep: an anti-aliased edge pixel
 * is a blend of the background and the colour beside it, so each is unmixed. Its foreground is
 * the strongest colour near it (furthest from the background, not removed); how much of that it
 * holds is its alpha, and its colour is what's left with the background taken out. So an edge
 * keeps its smoothness without a pale fringe, and needn't be close to the background to lose it.
 */
export function knockOut(p: Pixels, o: KnockOptions): Uint8ClampedArray {
  const { data, width: w, height: h } = p;
  const n = w * h;
  const dist = distances(p, o.bg);
  const coloured = backgroundColoured(dist, w, h, o.tolerance);
  // The background: 1 where removed.
  let gone: Uint8Array;
  if (o.mode === "everywhere") gone = coloured;
  else {
    // From the border, and from any holes chosen.
    gone = new Uint8Array(n);
    const holes = (o.holes ?? []).map((pt) => pointIndex(pt, w, h)).filter((k): k is number => k !== null);
    flood(coloured, w, [...border(w, h), ...holes], gone, 1, new Int32Array(n));
  }

  // The edge: kept pixels touching the background (8-connected), and, up to EDGE_REACH deep,
  // pixels touching those while they're still a blend (under half as far from the background as
  // the strongest colour round them). A solid outline stops it, so white inside a ring is safe.
  const edge = new Uint8Array(n);
  const strongest = (k: number) => {
    const x = k % w;
    const y = (k - x) / w;
    let f = k;
    for (let dy = -EDGE_REACH; dy <= EDGE_REACH; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -EDGE_REACH; dx <= EDGE_REACH; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (!gone[j] && dist[j] > dist[f]) f = j;
      }
    }
    return f;
  };
  const around = (k: number, f: (j: number) => void) => {
    const x = k % w;
    for (let dy = -1; dy <= 1; dy++) {
      const j0 = k + dy * w;
      if (j0 < 0 || j0 >= n) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if ((dx || dy) && xx >= 0 && xx < w) f(j0 + dx);
      }
    }
  };
  let ring: number[] = [];
  for (let k = 0; k < n; k++)
    if (gone[k])
      around(k, (j) => {
        if (!gone[j] && !edge[j]) {
          edge[j] = 1;
          ring.push(j);
        }
      });
  for (let depth = 1; depth < EDGE_REACH; depth++) {
    const next: number[] = [];
    for (const k of ring) {
      if (dist[k] * 2 >= dist[strongest(k)]) continue;
      around(k, (j) => {
        if (!gone[j] && !edge[j]) {
          edge[j] = 1;
          next.push(j);
        }
      });
    }
    ring = next;
  }

  const out = new Uint8ClampedArray(data.length);
  const [br, bgc, bb] = o.bg;
  for (let k = 0; k < n; k++) {
    if (gone[k]) continue; // fully transparent (zeros)
    const i = k * 4;
    if (!edge[k]) {
      out[i] = data[i];
      out[i + 1] = data[i + 1];
      out[i + 2] = data[i + 2];
      out[i + 3] = data[i + 3];
      continue;
    }
    // The foreground beside it: the kept pixel nearby furthest from the background.
    const fi = strongest(k) * 4;
    const fr = data[fi] - br;
    const fg = data[fi + 1] - bgc;
    const fb = data[fi + 2] - bb;
    const ff = fr * fr + fg * fg + fb * fb;
    // How much of the foreground this pixel holds: its offset from the background along the
    // line to the foreground.
    const a = ff > 0 ? Math.min(1, Math.max(0, ((data[i] - br) * fr + (data[i + 1] - bgc) * fg + (data[i + 2] - bb) * fb) / ff)) : 1;
    if (a <= 0) continue;
    out[i] = br + (data[i] - br) / a;
    out[i + 1] = bgc + (data[i + 1] - bgc) / a;
    out[i + 2] = bb + (data[i + 2] - bb) / a;
    out[i + 3] = Math.round(a * data[i + 3]);
  }
  return out;
}
