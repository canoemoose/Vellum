// Viewer features beyond the scheduler: progressive paint, rotation and page coordinates,
// tabs (detach / attach).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Viewer } from "./viewer";
import { BandRenderer, StubBitmap, StubRenderer, doc, flush, installFakes, openViewer, stubCanvas, until } from "./testkit";

beforeEach(installFakes);
afterEach(() => {
  vi.useRealTimers();
});

const partialsOf = (v: Viewer) => (v as unknown as { partials: Set<unknown> }).partials.size;

describe("Viewer progressive paint", () => {
  async function openBands() {
    const r = new BandRenderer(doc([{ w: 1190, h: 842 }]));
    const v = new Viewer(stubCanvas(), {}, r);
    v.resize(1600, 1000, 1);
    const firstBand = v.whenFirstBand();
    await v.open("C:/x/aerial.pdf", undefined, r);
    await flush();
    return { v, r, firstBand };
  }

  async function drain(v: Viewer, r: BandRenderer) {
    for (let k = 0; k < 20 && (v.rendering || v.queueLength); k++) {
      for (const st of r.streams) {
        st.send(0);
        st.send(1);
        st.finish();
      }
      r.resolveAll();
      await flush();
    }
  }

  it("draws a band as soon as it lands and reports the first band before sharp", async () => {
    const { v, r, firstBand } = await openBands();
    let bandMs: number | null = null;
    void firstBand.then((ms) => (bandMs = ms));
    let sharp = false;
    void v.whenSharp().then(() => (sharp = true));
    const s = r.streams[0];
    expect(s).toBeDefined();
    s.send(1);
    await until(() => bandMs !== null, 200);
    expect(bandMs).not.toBeNull();
    expect(sharp).toBe(false);
    expect(v.stats().bandsDrawn).toBe(1);
    // The band's overlay is held while its region is still rendering.
    expect(partialsOf(v)).toBe(1);
    await drain(v, r);
    await until(() => sharp, 500);
    expect(sharp).toBe(true);
    expect(v.visibleComplete()).toBe(true);
    // Overlays are released once their region is done.
    expect(partialsOf(v)).toBe(0);
  });

  it("puts tiles in the cache as bands complete them, not at the end", async () => {
    const { v, r } = await openBands();
    const s = r.streams[0];
    const before = v.cache.size;
    s.send(0);
    await flush();
    expect(v.cache.size).toBeGreaterThanOrEqual(before);
    s.send(1);
    await flush();
    // Every requested tile is in, though the region's promise hasn't resolved yet.
    expect(v.cache.size).toBe(before + s.req.tiles.length);
    expect(v.rendering).toBe(true);
  });

  it("drops band overlays when a zoom aborts the region", async () => {
    const { v, r } = await openBands();
    const s = r.streams[0];
    s.send(0);
    await flush();
    v.setZoom(8);
    expect(s.signal.aborted).toBe(true);
    s.finish();
    await flush();
    expect(partialsOf(v)).toBe(0);
  });

  it("uses whole-region renders when progressive is off", async () => {
    const r = new BandRenderer(doc([{ w: 1190, h: 842 }]));
    const v = new Viewer(stubCanvas(), {}, r);
    v.progressive = false;
    v.resize(800, 600, 1);
    await v.open("C:/x/a.pdf", undefined, r);
    await flush();
    expect(r.streams.length).toBe(0);
    expect(r.calls.length).toBeGreaterThan(0);
  });
});

describe("Viewer rotation and page coordinates", () => {
  it("rotating keeps the page point at the centre of the viewport where it was", async () => {
    const { v } = await openViewer([{ w: 1190, h: 842 }], true);
    v.setZoom(2);
    v.centreOn(0, 300, 200);
    const before = v.pagePointAt(400, 300)!;
    expect(before.x).toBeCloseTo(300, 6);
    expect(before.y).toBeCloseTo(200, 6);
    for (const rot of [90, 180, 270, 0]) {
      v.setRotation(rot);
      expect(v.rotation).toBe(rot);
      const p = v.pagePointAt(400, 300)!;
      expect(p.page).toBe(0);
      expect(p.x).toBeCloseTo(300, 6);
      expect(p.y).toBeCloseTo(200, 6);
    }
  });

  it("lays out rotated pages with swapped sides and keeps cached tiles", async () => {
    const { v, r } = await openViewer([{ w: 1190, h: 842 }], true);
    await until(() => v.queueLength === 0 && !v.rendering);
    const tilesBefore = v.cache.size;
    v.rotate(1);
    expect(v.layout.rects[0]!.w).toBe(842);
    expect(v.layout.rects[0]!.h).toBe(1190);
    // Rotation alone (same scale) drops nothing: tiles are in page space.
    expect(v.cache.size).toBe(tilesBefore);
    v.rotate(-1);
    expect(v.rotation).toBe(0);
    expect(r.closed).toEqual([]);
  });

  it("plans tiles in unrotated page coordinates when rotated", async () => {
    const { v, r } = await openViewer([{ w: 1190, h: 842 }], true);
    await until(() => v.queueLength === 0 && !v.rendering);
    v.setRotation(90);
    v.setZoom(6);
    await vi.advanceTimersByTimeAsync(200);
    await until(() => v.queueLength === 0 && !v.rendering);
    const rs = v.renderScale;
    const reqs = r.calls.map((c) => c.req).filter((q) => q.rs === rs);
    expect(reqs.length).toBeGreaterThan(0);
    const devW = Math.ceil(1190 * rs);
    const devH = Math.ceil(842 * rs);
    for (const q of reqs) {
      expect(q.x + q.w).toBeLessThanOrEqual(devW);
      expect(q.y + q.h).toBeLessThanOrEqual(devH);
    }
    expect(v.visibleComplete()).toBe(true);
  });

  it("reports the cursor in page points and the viewport on the page", async () => {
    const { v } = await openViewer([{ w: 1190, h: 842 }], true);
    v.setZoom(1);
    v.centreOn(0, 595, 421);
    v.setPointer(400, 300);
    const ui = v.uiState();
    expect(ui.cursor!.page).toBe(0);
    expect(ui.cursor!.x).toBeCloseTo(595, 6);
    expect(ui.cursor!.y).toBeCloseTo(421, 6);
    // 800 x 600 CSS px at 100% (4/3 px per pt) is 600 x 450 pt, centred on the point.
    expect(ui.pageViewport!.w).toBeCloseTo(600, 6);
    expect(ui.pageViewport!.h).toBeCloseTo(450, 6);
    expect(ui.pageViewport!.x).toBeCloseTo(595 - 300, 6);
    v.setPointer(null);
    expect(v.uiState().cursor).toBeNull();
    v.setPointer(-5000, -5000);
    expect(v.uiState().cursor).toBeNull();
  });

  it("reports the viewport on the page in page points when rotated", async () => {
    const { v } = await openViewer([{ w: 1190, h: 842 }], true);
    v.setZoom(1);
    v.setRotation(90);
    v.centreOn(0, 595, 421);
    const vp = v.viewportOnPage(0)!;
    // Rotated a quarter turn, the 600 x 450 pt viewport covers 450 x 600 pt of the page.
    expect(vp.w).toBeCloseTo(450, 6);
    expect(vp.h).toBeCloseTo(600, 6);
    expect(vp.x + vp.w / 2).toBeCloseTo(595, 6);
    expect(vp.y + vp.h / 2).toBeCloseTo(421, 6);
  });

  it("steps through zoom presets", async () => {
    const { v } = await openViewer([{ w: 1190, h: 842 }], true);
    v.setZoom(1);
    v.zoomPreset(1);
    expect(v.zoom).toBeCloseTo(1.5, 6);
    v.zoomPreset(-1);
    v.zoomPreset(-1);
    expect(v.zoom).toBeCloseTo(0.75, 6);
  });

  it("goes to a bookmark position with the target at the top", async () => {
    const { v } = await openViewer([{ w: 595, h: 842 }, { w: 595, h: 842 }], true);
    v.setZoom(2);
    v.gotoPagePoint(1, 400);
    const top = v.pagePointAt(400, 16)!;
    expect(top.page).toBe(1);
    expect(top.y).toBeCloseTo(400, 6);
  });
});

describe("Viewer detach and attach (tabs)", () => {
  it("detaches without closing, and reattaches with the same view, rotation and previews", async () => {
    const { v, r } = await openViewer([{ w: 1190, h: 842 }, { w: 1190, h: 842 }], true);
    await until(() => v.queueLength === 0 && !v.rendering);
    v.setRotation(90);
    v.setZoom(3);
    const view = { ...v.view };
    const state = v.detach()!;
    expect(state.doc.docId).toBe(7);
    expect(state.rotation).toBe(90);
    expect(v.doc).toBeNull();
    expect(v.uiState().docId).toBeNull();
    expect(r.closed).toEqual([]);
    expect(state.previews.size).toBeGreaterThan(0);

    const r2 = new StubRenderer(doc([{ w: 500, h: 500 }], 8));
    r2.auto = true;
    await v.open("C:/x/second.pdf", undefined, r2);
    expect(r.closed).toEqual([]); // the detached one stays open
    const second = v.detach()!;

    v.attach(state);
    expect(v.doc!.docId).toBe(7);
    expect(v.rotation).toBe(90);
    expect(v.view.scale).toBeCloseTo(view.scale, 9);
    expect(v.uiState().docId).toBe(7);
    expect(v.previewFor(0)).not.toBeNull();

    v.closeDetached(second);
    expect(r2.closed).toEqual([8]);
  });

  it("attach closes whatever is attached", async () => {
    const { v, r } = await openViewer();
    const state = v.detach()!;
    const r2 = new StubRenderer(doc([{ w: 500, h: 500 }], 9));
    await v.open("C:/x/b.pdf", undefined, r2);
    v.attach(state);
    expect(r2.closed).toEqual([9]);
    expect(r.closed).toEqual([]);
  });

  it("an open that finishes after another document was attached is discarded and closed", async () => {
    const { v } = await openViewer();
    const state = v.detach()!;
    let release!: () => void;
    const slow = new StubRenderer(doc([{ w: 100, h: 100 }], 11));
    slow.open = () => new Promise((res) => (release = () => res(slow.info)));
    const p = v.open("C:/x/slow.pdf", undefined, slow);
    v.attach(state);
    release();
    await p;
    expect(v.doc!.docId).toBe(7);
    expect(slow.closed).toEqual([11]);
  });

  it("detach with nothing attached returns null", async () => {
    const v = new Viewer(stubCanvas(), {}, new StubRenderer(doc([{ w: 1, h: 1 }])));
    expect(v.detach()).toBeNull();
  });
});

describe("Viewer persistent previews", () => {
  class DiskRenderer extends StubRenderer {
    disk = new Map<number, StubBitmap>();
    stored: number[] = [];
    async cachedPreview(_docId: number, page: number): Promise<ImageBitmap | null> {
      return (this.disk.get(page) as unknown as ImageBitmap) ?? null;
    }
    async storePreview(_docId: number, page: number): Promise<void> {
      this.stored.push(page);
    }
  }

  it("shows a stored preview at once on open, and doesn't store it again", async () => {
    const r = new DiskRenderer(doc([{ w: 1190, h: 842 }]));
    r.disk.set(0, new StubBitmap(2048, 1449));
    const v = new Viewer(stubCanvas(), {}, r);
    v.resize(800, 600, 1);
    await v.open("C:/x/a.pdf", undefined, r);
    await flush();
    const pv = v.previewFor(0)!;
    expect(pv).not.toBeNull();
    expect(pv.rs).toBeCloseTo(2048 / 1190, 9);
    // Nothing was rendered yet (renders are held), but the page already has content.
    expect(r.calls.every((c) => !c.done)).toBe(true);
    r.auto = true;
    r.resolveAll();
    await until(() => v.queueLength === 0 && !v.rendering);
    await vi.advanceTimersByTimeAsync(2000);
    expect(r.stored).toEqual([]);
  });

  it("stores a freshly made preview once the viewer is idle", async () => {
    const r = new DiskRenderer(doc([{ w: 1190, h: 842 }]));
    r.auto = true;
    const v = new Viewer(stubCanvas(), {}, r);
    v.resize(800, 600, 1);
    await v.open("C:/x/a.pdf", undefined, r);
    await until(() => v.queueLength === 0 && !v.rendering);
    expect(v.previewFor(0)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(r.stored).toEqual([0]);
  });

  it("does nothing when diskPreviews is off", async () => {
    const r = new DiskRenderer(doc([{ w: 1190, h: 842 }]));
    r.disk.set(0, new StubBitmap(10, 10));
    r.auto = true;
    const v = new Viewer(stubCanvas(), {}, r);
    v.diskPreviews = false;
    v.resize(800, 600, 1);
    await v.open("C:/x/a.pdf", undefined, r);
    await until(() => v.queueLength === 0 && !v.rendering);
    await vi.advanceTimersByTimeAsync(2000);
    expect(v.previewFor(0)!.bitmap.width).not.toBe(10);
    expect(r.stored).toEqual([]);
  });
});
