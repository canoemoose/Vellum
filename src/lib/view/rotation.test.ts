import { describe, expect, it } from "vitest";
import {
  type Rotation,
  normRotation,
  rotatePoint,
  rotateRect,
  rotatedDrawTransform,
  rotatedSize,
  unrotatePoint,
  unrotateRect,
} from "./rotation";

const A3 = { w: 1190, h: 842 };
const ALL: Rotation[] = [0, 90, 180, 270];

/** Apply a canvas transform [a, b, c, d, e, f] to a point. */
const apply = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

describe("rotation", () => {
  it("normalises any multiple of 90", () => {
    expect(normRotation(0)).toBe(0);
    expect(normRotation(450)).toBe(90);
    expect(normRotation(-90)).toBe(270);
    expect(normRotation(-180)).toBe(180);
    expect(normRotation(720)).toBe(0);
    expect(normRotation(89)).toBe(90);
  });

  it("swaps width and height for quarter turns", () => {
    expect(rotatedSize(A3, 90)).toEqual({ w: 842, h: 1190 });
    expect(rotatedSize(A3, 180)).toEqual(A3);
    expect(rotatedSize(A3, 270)).toEqual({ w: 842, h: 1190 });
  });

  it("turns clockwise: the page's top-left corner goes to the top-right at 90", () => {
    expect(rotatePoint(0, 0, A3, 90)).toEqual([842, 0]);
    expect(rotatePoint(1190, 0, A3, 90)).toEqual([842, 1190]); // top-right -> bottom-right
    expect(rotatePoint(0, 0, A3, 180)).toEqual([1190, 842]);
    expect(rotatePoint(0, 0, A3, 270)).toEqual([0, 1190]); // top-left -> bottom-left
  });

  it("unrotatePoint inverts rotatePoint, and rotated points stay on the rotated page", () => {
    for (const r of ALL) {
      const rs = rotatedSize(A3, r);
      for (const [x, y] of [[0, 0], [100, 20], [1190, 842], [595, 421], [3, 800]]) {
        const [X, Y] = rotatePoint(x, y, A3, r);
        expect(X).toBeGreaterThanOrEqual(0);
        expect(X).toBeLessThanOrEqual(rs.w);
        expect(Y).toBeGreaterThanOrEqual(0);
        expect(Y).toBeLessThanOrEqual(rs.h);
        const [u, v] = unrotatePoint(X, Y, A3, r);
        expect(u).toBeCloseTo(x, 9);
        expect(v).toBeCloseTo(y, 9);
      }
    }
  });

  it("four quarter turns are the identity", () => {
    let p: [number, number] = [123, 45];
    let s = A3;
    for (let k = 0; k < 4; k++) {
      p = rotatePoint(p[0], p[1], s, 90);
      s = rotatedSize(s, 90);
    }
    expect(p).toEqual([123, 45]);
  });

  it("rects round-trip and keep their area", () => {
    const rc = { x: 100, y: 50, w: 300, h: 120 };
    for (const r of ALL) {
      const d = rotateRect(rc, A3, r);
      expect(d.w * d.h).toBeCloseTo(rc.w * rc.h, 9);
      const back = unrotateRect(d, A3, r);
      expect(back.x).toBeCloseTo(rc.x, 9);
      expect(back.y).toBeCloseTo(rc.y, 9);
      expect(back.w).toBeCloseTo(rc.w, 9);
      expect(back.h).toBeCloseTo(rc.h, 9);
    }
    expect(rotateRect(rc, A3, 90)).toEqual({ x: 842 - 170, y: 100, w: 120, h: 300 });
  });

  it("the draw transform maps the bitmap's corners onto the destination rect, rotated", () => {
    // Destination 40 x 100 for a bitmap whose unrotated shape is 100 wide x 40 tall.
    const [X0, Y0, X1, Y1] = [10, 20, 50, 120];
    const t = rotatedDrawTransform(X0, Y0, X1, Y1, 90);
    expect([t.dw, t.dh]).toEqual([100, 40]);
    // Bitmap top-left -> destination top-right; bitmap bottom-right -> destination bottom-left.
    expect(apply(t.m, 0, 0)).toEqual([50, 20]);
    expect(apply(t.m, t.dw, t.dh)).toEqual([10, 120]);
    for (const r of ALL) {
      const q = rotatedDrawTransform(X0, Y0, X1, Y1, r);
      const cs = [apply(q.m, 0, 0), apply(q.m, q.dw, 0), apply(q.m, 0, q.dh), apply(q.m, q.dw, q.dh)];
      expect(Math.min(...cs.map((c) => c[0]))).toBe(X0);
      expect(Math.max(...cs.map((c) => c[0]))).toBe(X1);
      expect(Math.min(...cs.map((c) => c[1]))).toBe(Y0);
      expect(Math.max(...cs.map((c) => c[1]))).toBe(Y1);
    }
  });

  it("the draw transform agrees with rotatePoint", () => {
    // A page drawn at 1 px per point at the origin: bitmap pixel (x, y) must land where
    // rotatePoint says.
    for (const r of ALL) {
      const rs = rotatedSize(A3, r);
      const t = rotatedDrawTransform(0, 0, rs.w, rs.h, r);
      for (const [x, y] of [[0, 0], [200, 30], [1190, 842]]) {
        const [X, Y] = apply(t.m, x, y);
        const [ex, ey] = rotatePoint(x, y, A3, r);
        expect(X).toBeCloseTo(ex, 9);
        expect(Y).toBeCloseTo(ey, 9);
      }
    }
  });
});
