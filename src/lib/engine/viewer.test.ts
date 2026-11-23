// The viewer's scheduler (plan / pump / settle / measure) against a stub renderer, with fake
// timers standing in for setTimeout, requestAnimationFrame and performance.now.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StubRenderer, doc, flush, installFakes, openViewer, stubCanvas, until } from "./testkit";
import { Viewer } from "./viewer";

beforeEach(installFakes);
afterEach(() => {
  vi.useRealTimers();
});


describe("Viewer scheduler", () => {
  it("renders straight after open, visible tiles before the preview, two at a time", async () => {
    const { v, r } = await openViewer();
    await flush();
    // Concurrency 2: only two requests in flight.
    expect(r.calls.length).toBe(2);
    expect(r.calls.every((c) => c.docId === 7)).toBe(true);
    const rs = v.renderScale;
    expect(r.calls[0].req.rs).toBe(rs);
    // Keep resolving until the queue drains; the preview (a different rs) comes last.
    for (let k = 0; k < 20 && (r.pending().length || v.queueLength); k++) {
      r.resolveAll();
      await flush();
    }
    const scales = r.calls.map((c) => c.req.rs);
    const firstPreview = scales.findIndex((s) => s !== rs);
    if (firstPreview >= 0) expect(scales.slice(firstPreview).every((s) => s !== rs)).toBe(true);
    expect(v.visibleComplete()).toBe(true);
  });

  it("reports sharp once every visible tile is in, after the frame that shows them", async () => {
    const { v, r } = await openViewer();
    const sharp = v.whenSharp();
    let ev: Awaited<typeof sharp> | null = null;
    sharp.then((e) => (ev = e));
    await flush();
    r.resolveAll();
    await flush();
    r.resolveAll();
    await until(() => ev !== null);
    expect(ev).not.toBeNull();
    expect(ev!.complete).toBe(true);
    expect(ev!.regions).toBeGreaterThan(0);
  });

  it("holds rendering during a zoom until 150 ms after the last input, then plans at the new scale", async () => {
    const { v, r } = await openViewer([{ w: 1190, h: 842 }], true);
    await until(() => v.queueLength === 0 && !v.rendering);
    const before = r.calls.length;
    v.setZoom(4);
    const rs = v.renderScale;
    await vi.advanceTimersByTimeAsync(100);
    expect(r.calls.length).toBe(before); // still inside the settle window
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    const after = r.calls.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after[0].req.rs).toBe(rs);
  });

  it("settles a wheel zoom 60 ms after its ease lands, not the full settle delay", async () => {
    const { v, r } = await openViewer([{ w: 1190, h: 842 }], true);
    await until(() => v.queueLength === 0 && !v.rendering);
    const before = r.calls.length;
    const target = v.view.scale * 1.25;
    v.zoomAt(400, 300, 1.25, true);
    // Step in single frames so "landed" is accurate to one frame.
    for (let k = 0; k < 200 && v.view.scale !== target; k++) await vi.advanceTimersByTimeAsync(4);
    expect(v.view.scale).toBe(target);
    const landed = performance.now();
    const rs = v.renderScale;
    for (let k = 0; k < 100 && r.calls.length === before; k++) await vi.advanceTimersByTimeAsync(4);
    expect(performance.now() - landed).toBeLessThan(100);
    expect(r.calls[before].req.rs).toBe(rs);
  });

  it("renders ahead on a wheel zoom in, so the next notch in needs no render", async () => {
    const { v, r } = await openViewer([{ w: 1190, h: 842 }], true);
    await until(() => v.queueLength === 0 && !v.rendering);
    v.zoomAt(400, 300, 1.25, true);
    await vi.advanceTimersByTimeAsync(600);
    await until(() => v.queueLength === 0 && !v.rendering);
    const rs = v.renderScale;
    expect(rs).toBeGreaterThan(v.view.scale * v.dpr * 1.2);
    const before = r.calls.length;
    v.zoomAt(400, 300, 1.25, true);
    await vi.advanceTimersByTimeAsync(600);
    await until(() => v.queueLength === 0 && !v.rendering);
    expect(v.renderScale).toBe(rs);
    expect(r.calls.slice(before).filter((c) => c.req.rs === rs).length).toBe(0);
    expect(v.visibleComplete()).toBe(true);
  });

  it("keeps up to one small region per backend worker in flight, but only two large ones", async () => {
    const pages = Array.from({ length: 20 }, () => ({ w: 1190, h: 842 }));
    const { v, r } = await openViewer(pages, false);
    r.workers = 8;
    await flush();
    expect(r.pending().length).toBe(2); // at fit, one page fills the view: large regions
    v.setZoom(0.05); // far out: every page on screen, each a small region
    await vi.advanceTimersByTimeAsync(200);
    await flush();
    const inflight = r.pending();
    expect(inflight.length).toBe(8);
    expect(inflight.every((c) => c.req.w * c.req.h <= 512 * 1024)).toBe(true);
  });

  it("aborts in-flight renders at the old scale when the zoom changes", async () => {
    const { v, r } = await openViewer();
    await flush();
    const inflight = r.pending();
    expect(inflight.length).toBe(2);
    v.setZoom(8);
    expect(inflight.every((c) => c.signal.aborted)).toBe(true);
  });

  it("keeps rendering through a pan: nothing aborted, uncovered tiles queued at once", async () => {
    const { v, r } = await openViewer([{ w: 1190, h: 842 }], true);
    await until(() => v.queueLength === 0 && !v.rendering);
    v.setZoom(4);
    await vi.advanceTimersByTimeAsync(200);
    await until(() => v.queueLength === 0 && !v.rendering);
    r.auto = false;
    const before = r.calls.length;
    v.panBy(-600, 0);
    await vi.advanceTimersByTimeAsync(20); // one frame: re-plan without waiting for settle
    expect(r.calls.length).toBeGreaterThan(before);
    const held = r.pending();
    v.panBy(-50, 0);
    await vi.advanceTimersByTimeAsync(20);
    expect(held.every((c) => !c.signal.aborted)).toBe(true);
  });

  it("does not re-render tiles that are already cached", async () => {
    const { v, r } = await openViewer([{ w: 1190, h: 842 }], true);
    await until(() => v.queueLength === 0 && !v.rendering);
    const before = r.calls.length;
    // A jump to the same view settles again with nothing missing.
    v.setView({ ...v.view }, "jump");
    await vi.advanceTimersByTimeAsync(300);
    expect(r.calls.length).toBe(before);
  });

  it("drops results that land after the document changed", async () => {
    const { v, r } = await openViewer();
    await flush();
    const stale = r.pending();
    const r2 = new StubRenderer(doc([{ w: 500, h: 500 }], 8));
    await v.open("C:/x/other.pdf", undefined, r2);
    expect(r.closed).toEqual([7]);
    stale.forEach((c) => c.resolve());
    await flush();
    expect(v.cache.size).toBe(0);
  });

  it("closes the document in the backend", async () => {
    const { v, r } = await openViewer();
    v.close();
    expect(r.closed).toEqual([7]);
    expect(v.doc).toBeNull();
  });

  it("counts a failed render and carries on with the queue", async () => {
    const { v, r } = await openViewer();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await flush();
    const [a] = r.pending();
    a.done = true;
    a.fail(new Error("boom"));
    await flush();
    expect(v.renderErrors).toBe(1);
    // The rest of the queue still runs to completion.
    for (let k = 0; k < 20 && (r.pending().length || v.queueLength); k++) {
      r.resolveAll();
      await flush();
    }
    expect(v.queueLength).toBe(0);
    expect(v.rendering).toBe(false);
    err.mockRestore();
  });

  describe("thumbnails beside a long render", () => {
    // A large region (a 2000 x 1500 window at fit), so the backend decides its band count.
    async function openLarge(bands: number | null) {
      const r = new StubRenderer(doc([{ w: 1190, h: 842 }]));
      (r as StubRenderer & { knownBands: () => Promise<number | null> }).knownBands = async () => bands;
      const v = new Viewer(stubCanvas(), {}, r);
      v.resize(2000, 1500, 1);
      await v.open("C:/x/drawing.pdf", undefined, r);
      await flush();
      vi.advanceTimersByTime(400); // past the post-input quiet time
      await flush();
      expect(r.pending().some((c) => c.req.w * c.req.h > 512 * 1024)).toBe(true);
      return { v, r };
    }

    it("may run while a one-band render is in flight", async () => {
      const { v } = await openLarge(1);
      expect(v.idleForBackground).toBe(false);
      expect(v.idleForThumbnails).toBe(true);
    });

    it("waits while a banded render is in flight, or its band count isn't known", async () => {
      expect((await openLarge(8)).v.idleForThumbnails).toBe(false);
      expect((await openLarge(null)).v.idleForThumbnails).toBe(false);
    });

    // A small region (a 400 x 300 window at fit): usually one worker, but the backend bands a
    // very heavy page even then, so the viewer asks rather than assuming.
    async function openSmall(bands: number | null | undefined) {
      const r = new StubRenderer(doc([{ w: 1190, h: 842 }]));
      const asked: number[][] = [];
      if (bands !== undefined) {
        (r as StubRenderer & { knownBands: (...a: number[]) => Promise<number | null> }).knownBands = async (
          ...a: number[]
        ) => {
          asked.push(a);
          return bands;
        };
      }
      const v = new Viewer(stubCanvas(), {}, r);
      v.resize(400, 300, 1);
      await v.open("C:/x/drawing.pdf", undefined, r);
      await flush();
      vi.advanceTimersByTime(400);
      await flush();
      // Finish anything large in flight (a look-ahead render), leaving only the small one.
      for (const c of r.pending()) {
        if (c.req.w * c.req.h > 512 * 1024) {
          c.done = true;
          c.resolve();
        }
      }
      await flush();
      expect(r.pending().length).toBeGreaterThan(0);
      expect(r.pending().every((c) => c.req.w * c.req.h <= 512 * 1024)).toBe(true);
      return { v, asked };
    }

    it("asks the backend about a small render, passing its size", async () => {
      const { v, asked } = await openSmall(1);
      expect(asked.length).toBeGreaterThan(0);
      expect(asked[0].length).toBe(4);
      expect(asked[0][2] * asked[0][3]).toBeLessThanOrEqual(512 * 1024);
      expect(v.idleForThumbnails).toBe(true);
    });

    it("waits while a small render on a heavy page is banded", async () => {
      expect((await openSmall(8)).v.idleForThumbnails).toBe(false);
    });

    it("assumes one worker for a small render when the renderer can't say", async () => {
      expect((await openSmall(undefined)).v.idleForThumbnails).toBe(true);
    });
  });
});
