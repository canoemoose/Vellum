import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThumbnailQueue } from "./thumbnails";
import { StubBitmap, StubRenderer, doc } from "./testkit";

/** A renderer whose thumbnails resolve only when released, recording the order asked. */
class ThumbRenderer extends StubRenderer {
  asked: number[] = [];
  release: (() => void)[] = [];
  thumbnail(_docId: number, page: number, maxSide: number): Promise<ImageBitmap> {
    this.asked.push(page);
    return new Promise((res) => this.release.push(() => res(new StubBitmap(maxSide, maxSide) as unknown as ImageBitmap)));
  }
}

let idle = true;
let r: ThumbRenderer;
let q: ThumbnailQueue;

beforeEach(() => {
  vi.useFakeTimers();
  idle = true;
  r = new ThumbRenderer(doc([{ w: 100, h: 100 }]));
  q = new ThumbnailQueue({ isIdle: () => idle, budgetBytes: 4 * 132 * 132 * 4, pollMs: 100 });
});

afterEach(() => {
  q.dispose();
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTimeAsync(0);

describe("ThumbnailQueue", () => {
  it("waits while the viewer is busy and runs once it is idle", async () => {
    idle = false;
    const p = q.request(r, 1, 0, 132);
    await vi.advanceTimersByTimeAsync(500);
    expect(r.asked).toEqual([]);
    idle = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(r.asked).toEqual([0]);
    r.release[0]();
    const b = await p;
    expect(b.width).toBe(132);
  });

  it("runs one at a time, newest request first", async () => {
    idle = false;
    const ps = [0, 1, 2].map((page) => q.request(r, 1, page, 132));
    idle = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(r.asked).toEqual([2]);
    r.release[0]();
    await settle();
    await settle();
    expect(r.asked).toEqual([2, 1]);
    r.release[1]();
    await settle();
    await settle();
    r.release[2]();
    await Promise.all(ps);
    expect(r.asked).toEqual([2, 1, 0]);
  });

  it("dedupes repeated requests and serves later ones from the cache", async () => {
    const a = q.request(r, 1, 3, 132);
    const b = q.request(r, 1, 3, 132);
    await settle();
    expect(r.asked).toEqual([3]);
    r.release[0]();
    await Promise.all([a, b]);
    await q.request(r, 1, 3, 132);
    expect(r.asked).toEqual([3]);
    expect(q.peek(1, 3, 132)).toBeDefined();
  });

  it("uses the preview path when it can, without asking the renderer", async () => {
    const q2 = new ThumbnailQueue({
      isIdle: () => true,
      fromPreview: (_d, page) => (page === 5 ? (new StubBitmap(10, 10) as unknown as ImageBitmap) : null),
    });
    const b = await q2.request(r, 1, 5, 132);
    expect(b.width).toBe(10);
    expect(r.asked).toEqual([]);
    q2.dispose();
  });

  it("cancelDoc rejects waiting requests and frees that document's thumbnails", async () => {
    idle = false;
    const p = q.request(r, 2, 0, 132);
    q.cancelDoc(2);
    await expect(p).rejects.toThrow("document closed");
    expect(q.pending).toBe(0);
  });

  it("a document closed mid-render doesn't leave its thumbnail cached", async () => {
    const p = q.request(r, 3, 0, 132);
    await settle();
    q.cancelDoc(3);
    r.release[0]();
    await expect(p).rejects.toThrow("document closed");
    expect(q.peek(3, 0, 132)).toBeUndefined();
  });

  it("evicts least recently used thumbnails past the budget", async () => {
    for (let page = 0; page < 6; page++) {
      const p = q.request(r, 1, page, 132);
      await settle();
      r.release[page]();
      await p;
    }
    expect(q.cachedBytes).toBeLessThanOrEqual(4 * 132 * 132 * 4);
    expect(q.peek(1, 0, 132)).toBeUndefined();
    expect(q.peek(1, 5, 132)).toBeDefined();
  });

  it("a failed render rejects its waiters and the queue carries on", async () => {
    const bad = new StubRenderer(doc([{ w: 1, h: 1 }])); // no thumbnail method
    const p = q.request(bad, 1, 0, 132);
    await expect(p).rejects.toThrow();
    const ok = q.request(r, 1, 1, 132);
    await settle();
    r.release[0]();
    await expect(ok).resolves.toBeDefined();
  });
});
