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

  it("never stores a preview the shell says isn't the page as the file has it", async () => {
    // An annotation hidden in PDFium (the overlay draws it): stored, the page would open
    // without it in the mini map and thumbnails next time.
    const r = new DiskRenderer(doc([{ w: 1190, h: 842 }]));
    r.auto = true;
    const v = new Viewer(stubCanvas(), {}, r);
    v.canStorePreview = (page) => page !== 0;
    v.resize(800, 600, 1);
    await v.open("C:/x/a.pdf", undefined, r);
    await until(() => v.queueLength === 0 && !v.rendering);
    expect(v.previewFor(0)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(r.stored).toEqual([]);
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

describe("Viewer navigation mode per document", () => {
  const A4 = { w: 595, h: 842 };
  const A1 = { w: 2384, h: 1684 };

  it("picks from the page size on open, keeps a choice per tab, and can go back to automatic", async () => {
    const big = new StubRenderer(doc([A1], 1));
    big.auto = true;
    const v = new Viewer(stubCanvas(), {}, big);
    v.resize(1600, 1000, 1);
    await v.open("C:/x/plan.pdf", undefined, big);
    expect(v.uiState()).toMatchObject({ navMode: "cad", navAuto: true });

    // The user switches this drawing to Document navigation.
    v.setNavMode("document");
    expect(v.uiState()).toMatchObject({ navMode: "document", navAuto: false });
    const plan = v.detach()!;

    // A new A4 document starts automatic again, whatever the last tab chose.
    const small = new StubRenderer(doc([A4], 2));
    small.auto = true;
    await v.open("C:/x/letter.pdf", undefined, small);
    expect(v.uiState()).toMatchObject({ navMode: "document", navAuto: true });
    const letter = v.detach()!;

    // Back to the drawing: its choice came with it.
    v.attach(plan);
    expect(v.uiState()).toMatchObject({ navMode: "document", navAuto: false });
    v.setNavMode("auto");
    expect(v.uiState()).toMatchObject({ navMode: "cad", navAuto: true });
    v.closeDetached(letter);
  });
});

describe("Viewer eased fits, sticky zoom, resize and sticky drags", () => {
  it("fit eases to the fit rather than jumping, and lands exactly", async () => {
    const { v } = await openViewer();
    v.setZoom(3);
    const start = v.view.scale;
    v.fit("page", false, true);
    expect(v.view.scale).toBe(start); // nothing yet: it eases
    await vi.advanceTimersByTimeAsync(100);
    expect(v.view.scale).toBeLessThan(start);
    await vi.advanceTimersByTimeAsync(300);
    const landed = { ...v.view };
    v.setZoom(3);
    v.fit("page"); // the same fit, at once, for comparison
    expect(landed.scale).toBeCloseTo(v.view.scale, 9);
    expect(landed.tx).toBeCloseTo(v.view.tx, 6);
    expect(landed.ty).toBeCloseTo(v.view.ty, 6);
  });

  it("a wheel notch that would cross 100% stops there", async () => {
    const { v } = await openViewer();
    v.setZoom(0.95);
    v.zoomAt(400, 300, 1.12, true); // 0.95 x 1.12 = 1.064: crosses 100%
    await vi.advanceTimersByTimeAsync(500);
    expect(v.zoom).toBeCloseTo(1, 6);
    v.zoomAt(400, 300, 1.12, true); // starting on 100%: carries on
    await vi.advanceTimersByTimeAsync(500);
    expect(v.zoom).toBeCloseTo(1.12, 6);
  });

  it("resizing keeps the centre point, or refits when at a fit", async () => {
    const { v } = await openViewer([{ w: 1190, h: 842 }, { w: 1190, h: 842 }]);
    v.setZoom(2);
    const centre = v.pagePointAt(400, 300)!;
    v.resize(1000, 700, 1);
    const after = v.pagePointAt(500, 350)!;
    expect(after.x).toBeCloseTo(centre.x, 6);
    expect(after.y).toBeCloseTo(centre.y, 6);

    v.fit("page");
    v.resize(1400, 900, 1);
    const refit = v.view.scale;
    v.fit("page");
    expect(v.view.scale).toBeCloseTo(refit, 9);
  });

  it("dragging holds a page edge at the viewport edge before carrying on", async () => {
    const { v } = await openViewer();
    v.setZoom(2);
    // Move the page's left edge to 10 px right of the viewport's left, then drag left past it.
    const r = v.layout.rects[0]!;
    v.panBy(10 - (r.x * v.view.scale + v.view.tx), 0);
    v.dragPan(-15, 0); // crosses the edge-at-0 stop by 5
    expect(r.x * v.view.scale + v.view.tx).toBeCloseTo(0, 6);
    v.dragPan(-10, 0); // still within the hold
    expect(r.x * v.view.scale + v.view.tx).toBeCloseTo(0, 6);
    v.dragPan(-20, 0); // past it: carries on
    expect(r.x * v.view.scale + v.view.tx).toBeLessThan(0);
    v.endDrag();
  });
});

describe("Viewer single-page wheel scrolling", () => {
  it("turns the page after scrolling on against its end, and back from its top", async () => {
    const { v } = await openViewer([{ w: 595, h: 842 }, { w: 595, h: 842 }, { w: 595, h: 842 }]);
    v.setLayoutMode("single");
    v.fit("page"); // the page can't move at all: every notch is overscroll
    v.scrollBy(0, -40); // under the threshold
    expect(v.uiState().page).toBe(0);
    v.scrollBy(0, -40); // 80 gathered: next page
    expect(v.uiState().page).toBe(1);
    v.scrollBy(0, 100); // one notch up: back
    expect(v.uiState().page).toBe(0);
    v.scrollBy(0, 100); // the first page has no page before it
    expect(v.uiState().page).toBe(0);
  });

  it("scrolls normally within a page taller than the view, then lands at the next page's top", async () => {
    const { v } = await openViewer([{ w: 595, h: 842 }, { w: 595, h: 842 }]);
    v.setLayoutMode("single");
    v.fit("width"); // taller than the 800 x 600 view
    const ty0 = v.view.ty;
    v.scrollBy(0, -100);
    expect(v.view.ty).toBeCloseTo(ty0 - 100, 6); // just scrolls
    expect(v.uiState().page).toBe(0);
    for (let i = 0; i < 40 && v.uiState().page === 0; i++) v.scrollBy(0, -100);
    expect(v.uiState().page).toBe(1);
    const r = v.layout.rects[1]!;
    expect(r.y * v.view.scale + v.view.ty).toBeCloseTo(16, 6); // the top, at the margin
  });
});

describe("Viewer columns layout fit", () => {
  it("switching to columns fits the whole row, and fit width keeps doing so", async () => {
    const { v } = await openViewer(Array(6).fill({ w: 595, h: 842 }));
    v.setLayoutMode("columns"); // 2 across by default
    const b = v.layout.bounds;
    // The row's width fills the 800 px view, less the 16 px margins.
    expect(b.w * v.view.scale).toBeCloseTo(800 - 32, 6);
    expect(b.x * v.view.scale + v.view.tx).toBeCloseTo(16, 6);
    v.setZoom(3);
    v.fit("width");
    expect(b.w * v.view.scale).toBeCloseTo(800 - 32, 6);
    v.setColumns(3); // a wider row: refitted
    expect(v.layout.bounds.w * v.view.scale).toBeCloseTo(800 - 32, 6);
    v.fit("page"); // fit page still fits one page
    const r = v.layout.rects[v.uiState().page]!;
    expect(Math.max((r.w * v.view.scale) / (800 - 32), (r.h * v.view.scale) / (600 - 32))).toBeCloseTo(1, 6);
  });
});

describe("Viewer visible pages", () => {
  it("lists every page any part of which is on screen", async () => {
    const { v } = await openViewer(Array(6).fill({ w: 595, h: 842 }));
    v.setLayoutMode("columns"); // 2 across, fitted to the row at the top
    expect(v.uiState().visiblePages.slice(0, 2)).toEqual([0, 1]);
    v.setLayoutMode("single");
    expect(v.uiState().visiblePages).toEqual([v.uiState().page]);
  });
});

describe("Viewer layout per document", () => {
  it("each tab keeps its own layout and columns", async () => {
    const { v } = await openViewer(Array(4).fill({ w: 595, h: 842 }));
    v.setLayoutMode("columns");
    v.setColumns(3);
    const first = v.detach()!;
    const r2 = new StubRenderer(doc([{ w: 595, h: 842 }], 9));
    r2.auto = true;
    v.layoutMode = "continuous"; // what the shell sets before opening another file
    await v.open("C:/x/report.pdf", undefined, r2);
    expect(v.uiState()).toMatchObject({ layoutMode: "continuous" });
    const second = v.detach()!;
    v.attach(first);
    expect(v.uiState()).toMatchObject({ layoutMode: "columns", columns: 3 });
    v.closeDetached(second);
  });
});
