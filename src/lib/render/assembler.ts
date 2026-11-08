// Reassembles a region from the bands a progressive render delivers, and says which of the
// requested tiles each band completes. Pure (no DOM), so it's unit-tested.
//
// Bands never overlap (the backend splits the region at band boundaries), so a tile is
// complete once the area covered inside it equals its own area.

import type { TileSpec } from "./tiles";

export interface RegionRect {
  /** Region origin and size in device pixels of the page bitmap. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export class RegionAssembler {
  /** The region's RGBA pixels, filled in as bands arrive (opaque white until then). */
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  private covered: number[];
  private done: boolean[];
  private remaining: number;

  constructor(
    readonly region: RegionRect,
    readonly tiles: TileSpec[],
  ) {
    this.pixels = new Uint8ClampedArray(region.w * region.h * 4).fill(255);
    this.covered = tiles.map(() => 0);
    this.done = tiles.map(() => false);
    this.remaining = tiles.length;
  }

  /** True once every requested tile is complete. */
  get complete(): boolean {
    return this.remaining === 0;
  }

  /**
   * Copy a band (rx, ry relative to the region; `src` tightly packed RGBA, bw x bh) into the
   * region and return the indices of tiles it completed. Parts of a band outside the region
   * are ignored rather than written out of bounds.
   */
  addBand(rx: number, ry: number, bw: number, bh: number, src: Uint8ClampedArray | Uint8Array): number[] {
    const R = this.region;
    if (src.length < bw * bh * 4) throw new Error(`band ${bw}x${bh} needs ${bw * bh * 4} bytes, got ${src.length}`);
    const x0 = Math.max(0, rx);
    const y0 = Math.max(0, ry);
    const x1 = Math.min(R.w, rx + bw);
    const y1 = Math.min(R.h, ry + bh);
    if (x1 <= x0 || y1 <= y0) return [];
    const rowBytes = (x1 - x0) * 4;
    if (x0 === 0 && x1 === R.w && rx === 0 && bw === R.w) {
      // Full-width band: one contiguous copy.
      this.pixels.set(src.subarray((y0 - ry) * bw * 4, (y1 - ry) * bw * 4), y0 * R.w * 4);
    } else {
      for (let y = y0; y < y1; y++) {
        const s = ((y - ry) * bw + (x0 - rx)) * 4;
        this.pixels.set(src.subarray(s, s + rowBytes), (y * R.w + x0) * 4);
      }
    }
    // Band rect in page-bitmap coordinates, to intersect with tile rects.
    const bx0 = R.x + x0, by0 = R.y + y0, bx1 = R.x + x1, by1 = R.y + y1;
    const out: number[] = [];
    this.tiles.forEach((t, k) => {
      if (this.done[k]) return;
      const iw = Math.min(bx1, t.x + t.w) - Math.max(bx0, t.x);
      const ih = Math.min(by1, t.y + t.h) - Math.max(by0, t.y);
      if (iw <= 0 || ih <= 0) return;
      this.covered[k] += iw * ih;
      if (this.covered[k] >= t.w * t.h) {
        this.done[k] = true;
        this.remaining--;
        out.push(k);
      }
    });
    return out;
  }
}
