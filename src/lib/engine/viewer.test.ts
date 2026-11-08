// The viewer's scheduler (plan / pump / settle / measure) against a stub renderer, with fake
// timers standing in for setTimeout, requestAnimationFrame and performance.now.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scaleKey } from "../render/tiles";
import { StubRenderer, doc, flush, installFakes, openViewer, until } from "./testkit";

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
});
