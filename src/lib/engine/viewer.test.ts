// The viewer's scheduler (plan / pump / settle / measure) against a stub renderer, with fake
// timers standing in for setTimeout, requestAnimationFrame and performance.now.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Viewer } from "./viewer";
import type { DocInfo, RegionRequest, Renderer } from "../render/types";
import { scaleKey } from "../render/tiles";

// ---------------------------------------------------------------- DOM stand-ins

class StubBitmap {
  closed = false;
  constructor(public width: number, public height: number) {}
  close() {
    this.closed = true;
  }
}

/** A 2D context whose every method is a no-op. */
function stubContext(): CanvasRenderingContext2D {
  return new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : () => {}),
    set: (t, k, v) => ((t[k as string] = v), true),
  }) as unknown as CanvasRenderingContext2D;
}

function stubCanvas(): HTMLCanvasElement {
  return { width: 0, height: 0, style: {}, getContext: () => stubContext() } as unknown as HTMLCanvasElement;
}

class StubOffscreenCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    return stubContext();
  }
  transferToImageBitmap() {
    return new StubBitmap(this.width, this.height);
  }
}

// ---------------------------------------------------------------- stub renderer

interface Call {
  docId: number;
  req: RegionRequest;
  signal: AbortSignal;
  resolve: () => void;
  fail: (e: unknown) => void;
}

class StubRenderer implements Renderer {
  readonly name = "pdfium" as const;
  concurrency = 2;
  calls: Call[] = [];
  closed: number[] = [];
  /** Resolve renders at once (true) or hold them until resolve() is called (false). */
  auto = false;
  constructor(public info: DocInfo) {}

  async open(): Promise<DocInfo> {
    return this.info;
  }
  renderRegion(docId: number, req: RegionRequest, signal: AbortSignal): Promise<ImageBitmap[] | null> {
    return new Promise((res, rej) => {
      const call: Call = {
        docId, req, signal,
        resolve: () => res(signal.aborted ? null : (req.tiles.map((t) => new StubBitmap(t.w, t.h)) as unknown as ImageBitmap[])),
        fail: rej,
      };
      this.calls.push(call);
      if (this.auto) call.resolve();
    });
  }
  async close(docId: number): Promise<void> {
    this.closed.push(docId);
  }
  pending(): Call[] {
    return this.calls.filter((c) => !(c as { done?: boolean }).done);
  }
  /** Resolve every call made so far that is still open. */
  resolveAll(): void {
    for (const c of this.calls) {
      if ((c as { done?: boolean }).done) continue;
      (c as { done?: boolean }).done = true;
      c.resolve();
    }
  }
}

function doc(sizes: { w: number; h: number }[], docId = 7): DocInfo {
  return {
    docId, kind: "pdf", numPages: sizes.length, sizes, workers: 8,
    meta: { fileSize: 1, pdfVersion: "1.7", title: null, author: null, subject: null, producer: null, creator: null, note: null },
  };
}

/** Let promise callbacks and any due timers / frames run. */
async function flush(ms = 0): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(ms / 5 || 0);
    await Promise.resolve();
  }
}

/** Advance one animation frame at a time until `cond` holds or `maxMs` passes. */
async function until(cond: () => boolean, maxMs = 2000): Promise<void> {
  for (let t = 0; t < maxMs && !cond(); t += 16) await vi.advanceTimersByTimeAsync(16);
}

beforeEach(() => {
  // Node has no requestAnimationFrame; define one so the fake timers have something to replace.
  const g0 = globalThis as Record<string, unknown>;
  g0.requestAnimationFrame ??= (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16);
  g0.cancelAnimationFrame ??= (id: number) => clearTimeout(id);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance", "queueMicrotask"] });
  const g = globalThis as Record<string, unknown>;
  g.document = { documentElement: {} };
  g.getComputedStyle = () => ({ getPropertyValue: () => "#2b2d31" });
  g.OffscreenCanvas = StubOffscreenCanvas;
});

afterEach(() => {
  vi.useRealTimers();
});

async function openViewer(sizes = [{ w: 1190, h: 842 }], auto = false) {
  const r = new StubRenderer(doc(sizes));
  r.auto = auto;
  const v = new Viewer(stubCanvas(), {}, r);
  v.resize(800, 600, 1);
  await v.open("C:/x/drawing.pdf", undefined, r);
  return { v, r };
}

describe("Viewer scheduler", () => {
  it("renders straight after open, visible tiles before the preview, two at a time", async () => {
    const { v, r } = await openViewer();
    await flush();
    // Concurrency 2: only two requests in flight.
    expect(r.calls.length).toBe(2);
    expect(r.calls.every((c) => c.docId === 7)).toBe(true);
    const rs = scaleKey(v.view.scale * v.dpr);
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
    const rs = scaleKey(v.view.scale * v.dpr);
    await vi.advanceTimersByTimeAsync(100);
    expect(r.calls.length).toBe(before); // still inside the settle window
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    const after = r.calls.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after[0].req.rs).toBe(rs);
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
    (a as { done?: boolean }).done = true;
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
});
