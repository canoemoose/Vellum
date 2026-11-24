// The viewer's scheduler (plan / pump / settle / measure) against a stub renderer, with fake
// timers standing in for setTimeout, requestAnimationFrame and performance.now.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StubRenderer, doc, flush, installFakes, openViewer, stubCanvas, until } from "./testkit";
import { Viewer } from "./viewer";
import { type View, remainingMove } from "../view/viewMath";

beforeEach(installFakes);
afterEach(() => {
  vi.useRealTimers();
});


/**
 * Start a move with `start`, and check that the tiles it renders ahead (at the scale it lands
 * on) were rendered while it moved but not drawn until it landed (it is moving for the first 160 ms).
 */
async function expectHiddenUntilLanding(start: (v: Viewer) => void): Promise<void> {
  // Tag every bitmap with its render scale and record what the canvas draws.
  const drawn: { rs: number; flying: boolean }[] = [];
  let flying = false;
  const r = new StubRenderer(doc([{ w: 1190, h: 842 }]));
  r.auto = true;
  const base = r.renderRegion.bind(r);
  r.renderRegion = (id, req, signal) =>
    base(id, req, signal).then((bs) => {
      bs?.forEach((b) => ((b as unknown as { rs: number }).rs = req.rs));
      return bs;
    });
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) =>
      k === "drawImage"
        ? (b: { rs?: number }) => { if (b.rs !== undefined) drawn.push({ rs: b.rs, flying }); }
        : k in t ? t[k as string] : () => {},
    set: (t, k, val) => ((t[k as string] = val), true),
  });
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const v = new Viewer(canvas, {}, r);
  v.resize(800, 600, 1);
  await v.open("C:/x/drawing.pdf", undefined, r);
  await until(() => v.queueLength === 0 && !v.rendering);
  flying = true;
  start(v);
  for (let k = 0; k < 10; k++) { // about 160 ms: a flight lands from about 190 ms (LAND_PX)
    await vi.advanceTimersByTimeAsync(16);
    if (!(v as unknown as { animating: boolean }).animating) throw new Error("landed too soon for this test");
  }
  flying = false;
  const inFlight = r.calls.length;
  await vi.advanceTimersByTimeAsync(400);
  await until(() => v.queueLength === 0 && !v.rendering);
  await vi.advanceTimersByTimeAsync(32);
  const rs = v.renderScale;
  expect(r.calls.slice(0, inFlight).some((c) => c.req.rs === rs)).toBe(true);
  expect(drawn.some((d) => d.flying && d.rs === rs)).toBe(false);
  expect(drawn.some((d) => !d.flying && d.rs === rs)).toBe(true);
}

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

  describe("a wheel ease", () => {
    /** One wheel notch zooming in 2x about (400, 300), from an idle, fully drawn view. */
    async function notch(auto: boolean) {
      const { v, r } = await openViewer([{ w: 1190, h: 842 }], true);
      await until(() => v.queueLength === 0 && !v.rendering);
      await vi.advanceTimersByTimeAsync(100); // let the open's own "sharp" report go out
      r.auto = auto;
      const before = r.calls.length;
      const startRs = v.renderScale;
      const target = v.view.scale * 2;
      v.zoomAt(400, 300, 2, true);
      return { v, r, before, startRs, target, t0: performance.now() };
    }
    /** Step in 4 ms frames until the ease reaches `target`; returns the landing time. */
    async function land(v: Viewer, target: number): Promise<number> {
      for (let k = 0; k < 200 && v.view.scale !== target; k++) await vi.advanceTimersByTimeAsync(4);
      expect(v.view.scale).toBe(target);
      return performance.now();
    }

    it("renders its landing view during the ease, at the scale it lands on", async () => {
      const { v, r, before, startRs, target } = await notch(true);
      await vi.advanceTimersByTimeAsync(20); // well before it lands
      expect(v.view.scale).not.toBe(target);
      const during = r.calls.slice(before).filter((c) => c.req.rs !== startRs);
      expect(during.length).toBeGreaterThan(0);
      await land(v, target);
      await until(() => v.queueLength === 0 && !v.rendering);
      const rs = v.renderScale;
      expect(rs).not.toBe(startRs);
      expect(during.some((c) => c.req.rs === rs)).toBe(true);
      expect(v.visibleComplete()).toBe(true);
    });

    it("doesn't render the same tiles again when it lands", async () => {
      const { v, r, before, startRs, target } = await notch(false); // still running at landing
      await vi.advanceTimersByTimeAsync(20);
      const ahead = r.pending().filter((c) => c.req.rs !== startRs);
      expect(ahead.length).toBeGreaterThan(0);
      await land(v, target);
      await vi.advanceTimersByTimeAsync(100);
      const rs = v.renderScale;
      const seen = new Map<string, number>();
      for (const c of r.calls.slice(before)) {
        if (c.req.rs !== rs || c.signal.aborted) continue;
        for (const t of c.req.tiles) {
          const k = `${c.req.page}|${t.i}|${t.j}`;
          seen.set(k, (seen.get(k) ?? 0) + 1);
        }
      }
      expect([...seen.values()].every((n) => n === 1)).toBe(true);
      expect(ahead.every((c) => !c.signal.aborted)).toBe(true);
    });

    it("is sharp within a couple of frames of landing when the renders finished during the ease", async () => {
      const { v, target } = await notch(true);
      let sharpAt: number | null = null;
      void v.whenSharp().then(() => (sharpAt = performance.now()));
      const landed = await land(v, target);
      await until(() => sharpAt !== null, 1000);
      expect(sharpAt).not.toBeNull();
      // Before this change the 60 ms wait for another notch came first, then the render.
      expect(sharpAt! - landed).toBeLessThan(50);
    });

    it("on a burst of notches, keeps only the last notch's renders", async () => {
      const { v, r, before, startRs } = await notch(false);
      await vi.advanceTimersByTimeAsync(12);
      v.zoomAt(400, 300, 2, true);
      await vi.advanceTimersByTimeAsync(12);
      v.zoomAt(400, 300, 2, true);
      const target = (v as unknown as { anim: { target: number } }).anim.target;
      await land(v, target);
      const rs = v.renderScale;
      const calls = r.calls.slice(before);
      // Every notch started its own landing view; the earlier ones were aborted.
      const scales = new Set(calls.map((c) => c.req.rs).filter((x) => x !== startRs && x !== rs));
      expect(scales.size).toBeGreaterThan(0);
      for (const c of calls) if (c.req.rs !== rs && c.req.tiles.length > 1) expect(c.signal.aborted).toBe(true);
      // Aborted renders hold their slot until they return (a band already running in PDFium
      // finishes first); then the last notch's renders start, and nothing else.
      r.auto = true;
      r.resolveAll();
      await until(() => v.queueLength === 0 && !v.rendering);
      const after = r.calls.slice(before + calls.length);
      expect(after.some((c) => c.req.rs === rs)).toBe(true);
      expect(after.every((c) => c.req.rs === rs || c.req.tiles.length === 1)).toBe(true);
      expect(v.visibleComplete()).toBe(true);
    });

    it("drops its landing view's renders when a jump to another zoom ends it early", async () => {
      const { v, r, startRs } = await notch(false);
      await vi.advanceTimersByTimeAsync(20);
      const ahead = r.pending().filter((c) => c.req.rs !== startRs);
      expect(ahead.length).toBeGreaterThan(0);
      v.setZoom(0.5);
      expect(ahead.every((c) => c.signal.aborted)).toBe(true);
    });

    it("keeps its landing view's tiles off screen until it lands, across notches", async () => {
      await expectHiddenUntilLanding((v) => {
        v.zoomAt(400, 300, 1.6, true);
        v.zoomAt(400, 300, 1.6, true);
      });
    });

    it("lands as soon as under 4 px of movement is left, not after creeping through it", async () => {
      const { v } = await openViewer([{ w: 1190, h: 842 }], true);
      await until(() => v.queueLength === 0 && !v.rendering);
      const moving = () => (v as unknown as { animating: boolean }).animating;
      const t0 = performance.now();
      v.zoomAt(400, 300, 2, true);
      const seen: View[] = [];
      for (let k = 0; k < 200 && moving(); k++) {
        await vi.advanceTimersByTimeAsync(4);
        if (moving()) seen.push({ ...v.view });
      }
      const landed = performance.now() - t0;
      const final = { ...v.view };
      // Every frame shown while moving was still at least 4 px from the end (a closer one
      // would have landed instead)...
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((x) => remainingMove(x, final, 800, 600) >= 4)).toBe(true);
      // ...and the ease ends well before the exponential reaches its old cut-off (log scale
      // within 1e-3 of the target: about 295 ms for a 2x notch).
      expect(landed).toBeLessThan(270);
    });
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

  describe("a flight (typed zoom, fit, actual size)", () => {
    /** Zoom in 4x as a 220 ms flight from an idle, fully drawn view. */
    async function fly(auto: boolean) {
      const { v, r } = await openViewer([{ w: 1190, h: 842 }], true);
      await until(() => v.queueLength === 0 && !v.rendering);
      await vi.advanceTimersByTimeAsync(100); // let the open's own "sharp" report go out
      r.auto = auto;
      const before = r.calls.length;
      const startRs = v.renderScale;
      v.setZoom(4, 400, 300, true);
      return { v, r, before, startRs, t0: performance.now() };
    }

    it("renders the destination while it flies, at the scale it lands on", async () => {
      const { v, r, before, startRs } = await fly(true);
      await vi.advanceTimersByTimeAsync(40); // well before the 220 ms landing
      const during = r.calls.slice(before).filter((c) => c.req.rs !== startRs);
      expect(during.length).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(300);
      await until(() => v.queueLength === 0 && !v.rendering);
      const rs = v.renderScale;
      expect(rs).not.toBe(startRs);
      expect(during.some((c) => c.req.rs === rs)).toBe(true);
      expect(v.visibleComplete()).toBe(true);
    });

    it("doesn't render the same tiles again when it lands", async () => {
      const { v, r, before } = await fly(false); // hold renders: still running at landing
      await vi.advanceTimersByTimeAsync(40);
      const ahead = r.pending().filter((c) => c.req.rs !== r.calls[0].req.rs);
      expect(ahead.length).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(300); // landed
      const rs = v.renderScale;
      const key = (c: (typeof ahead)[number]) => c.req.tiles.map((t) => `${c.req.page}|${t.i}|${t.j}`);
      const seen = new Map<string, number>();
      for (const c of r.calls.slice(before)) {
        if (c.req.rs !== rs || c.signal.aborted) continue;
        for (const k of key(c)) seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      expect([...seen.values()].every((n) => n === 1)).toBe(true);
      expect(ahead.every((c) => !c.signal.aborted)).toBe(true);
    });

    it("is sharp within a couple of frames of landing when the renders finished in flight", async () => {
      const { v, t0 } = await fly(true);
      let sharpAt: number | null = null;
      void v.whenSharp().then(() => (sharpAt = performance.now()));
      const moving = () => (v as unknown as { animating: boolean }).animating;
      for (let k = 0; k < 100 && moving(); k++) await vi.advanceTimersByTimeAsync(4);
      const landedAt = performance.now();
      await until(() => sharpAt !== null, 1000);
      expect(sharpAt).not.toBeNull();
      // Landing is up to 220 ms after the start (sooner by the last few pixels, see LAND_PX).
      // A "sharp" from before it would be stale; before this change the settle delay alone
      // added 60 ms after it.
      expect(landedAt - t0).toBeGreaterThan(150);
      expect(landedAt - t0).toBeLessThanOrEqual(224);
      expect(sharpAt!).toBeGreaterThanOrEqual(landedAt - 4);
      expect(sharpAt! - landedAt).toBeLessThan(50);
    });

    it("drops the destination's renders when a pan ends it early", async () => {
      const { v, r, startRs } = await fly(false);
      await vi.advanceTimersByTimeAsync(40);
      const ahead = r.pending().filter((c) => c.req.rs !== startRs);
      expect(ahead.length).toBeGreaterThan(0);
      v.panBy(20, 0);
      expect(ahead.every((c) => c.signal.aborted)).toBe(true);
    });

    it("keeps the destination's tiles off screen until it lands", async () => {
      await expectHiddenUntilLanding((v) => v.setZoom(4, 400, 300, true));
    });
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
