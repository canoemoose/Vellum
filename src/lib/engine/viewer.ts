// The viewer engine: view state, compositor, render scheduler. No Svelte in here;
// components talk to it through methods and the onUi callback.
//
// Pipeline (see ARCHITECTURE.md):
//   view change -> draw cached tiles transformed (instant, maybe soft)
//               -> 150 ms with no input = "settle"
//               -> plan missing tiles at the exact current scale, grouped into regions
//               -> renderer renders a region band by band; each band is drawn as it lands and
//                  the tiles it completes go into the LRU cache
//               -> compositor redraws; when every visible tile is sharp, record settle-to-sharp
//
// Coordinates: tiles, previews and every page-point API are in unrotated page points (y down
// from the page's top-left). The view rotation (rotation.ts) only changes the layout and the
// compositor's mapping, so rotating never invalidates a cached tile.

import {
  type FitMode,
  type Rect,
  type View,
  approachScale,
  clampScale,
  constrainView,
  easeOutCubic,
  fitRect,
  fitWidthKeepingY,
  interpolateView,
  keepCentre,
  nextZoomPreset,
  stickyZoomTarget,
  scaleToZoom,
  screenToWorld,
  visibleWorldRect,
  zoomAt,
  zoomToScale,
} from "../view/viewMath";
import { type Layout, type LayoutMode, computeLayout, currentPage, pagesInRect } from "../view/layout";
import { snapshotSize } from "../view/snapshot";
import {
  type Rotation,
  normRotation,
  rotatePoint,
  rotateRect,
  rotatedDrawTransform,
  rotatedSize,
  unrotatePoint,
  unrotateRect,
} from "../view/rotation";
import { revealView } from "../view/reveal";
import {
  TILE,
  TileCache,
  type TileGrid,
  type TileIndexRange,
  type TileSpec,
  chooseRenderScale,
  fallbackScales,
  groupIntoRegions,
  scaleKey,
  tileGrid,
  tileKey,
  tileRangeForRect,
  tileSpec,
} from "../render/tiles";
import type { DocInfo, DocKind, RegionRequest, Renderer } from "../render/types";
import { rendererFor } from "../render/createRenderer";
import { ThumbnailQueue } from "./thumbnails";

import { autoNavMode, type NavMode } from "../view/navMode";
import { StickyAxis, alignStops, type Span } from "../view/stickyPan";
export type { NavMode } from "../view/navMode";

/** A point on a page, in unrotated page points (y down from the page's top-left). */
export interface PagePoint {
  page: number;
  x: number;
  y: number;
}

export interface UiState {
  fileName: string;
  /** Backend document id of the attached document, null when none. */
  docId: number | null;
  kind: DocKind | null;
  page: number;
  numPages: number;
  zoom: number;
  rotation: Rotation;
  layoutMode: LayoutMode;
  columns: number;
  navMode: NavMode;
  /** True while the navigation mode follows the page size (autoNavMode), not a user choice. */
  navAuto: boolean;
  loading: boolean;
  error: string | null;
  /** Where the pointer is over a page (set through setPointer), null when off every page. */
  cursor: PagePoint | null;
  /** The viewport on the current page, in its page points (may extend past the page). */
  pageViewport: Rect | null;
  /** Pages any part of which is on screen, in order (the sidebar marks them). */
  visiblePages: number[];
  /** The visible world rect and the whole document's, for the canvas scrollbars. */
  viewWorld: Rect;
  bounds: Rect;
}

/** The UI state before any document is open (for a component's initial state). */
export function initialUiState(): UiState {
  return {
    fileName: "", docId: null, kind: null, page: 0, numPages: 0, zoom: 1, rotation: 0,
    layoutMode: "continuous", columns: 2, navMode: "cad", navAuto: true, loading: false, error: null, cursor: null, pageViewport: null,
    visiblePages: [], viewWorld: { x: 0, y: 0, w: 0, h: 0 }, bounds: { x: 0, y: 0, w: 0, h: 0 },
  };
}

export interface ViewerOptions {
  cacheBytes: number;
  previewBytes: number;
  settleMs: number;
  /** Largest render region side in device pixels (one renderer pass). */
  maxRegion: number;
  /** Previews kept per detached document (tab in the background), bytes. */
  detachedPreviewBytes: number;
}

const DEFAULTS: ViewerOptions = {
  cacheBytes: 512 * 1024 * 1024,
  previewBytes: 96 * 1024 * 1024,
  settleMs: 150,
  maxRegion: 4096,
  detachedPreviewBytes: 32 * 1024 * 1024,
};

/** Longest side of a page's low-resolution preview, in device pixels. */
const PREVIEW_MAX_SIDE = 2048;
/** Padding used by Fit page / Fit width, CSS px. */
const FIT_PAD = 16;
/** Wheel scrolling gathered against a page's end before single-page layout turns the page. */
const OVERSCROLL_PX = 60;
/** Background work (thumbnails) waits this long after the last input. */
const IDLE_AFTER_INPUT_MS = 300;
/**
 * Settle delay after a mouse-wheel (animated) zoom lands. The ease itself already spans the
 * gaps between notches, so the full settle delay (there for trackpad pinch, which streams
 * events with no ease) only added latency. Short is safe now that a cancelled render stops
 * in the backend instead of running to completion.
 */
const WHEEL_SETTLE_MS = 60;
/** Regions up to this many pixels render on one backend worker (SMALL_REGION_PX in pdfium.rs). */
const SMALL_REGION_PX = 512 * 1024;

interface Job {
  kind: "tiles" | "preview";
  page: number;
  rs: number;
  req: RegionRequest;
  prio: number;
  dist: number;
  ac?: AbortController;
  /** Backend workers this render occupies once known (1 for a small or one-band region). */
  bands?: number;
}

interface Preview {
  bitmap: ImageBitmap;
  rs: number;
  bytes: number;
}

/** A band of a region still rendering, drawn until the region's tiles are all in. */
interface PartialBand {
  job: Job;
  page: number;
  rs: number;
  /** Device-pixel rect in the page bitmap at rs. */
  x: number;
  y: number;
  w: number;
  h: number;
  bitmap: ImageBitmap;
}

/**
 * A document's view, detached from the viewer (a tab in the background). The document stays
 * open in the backend; reattach it with attach() or free it with closeDetached().
 */
export interface DocView {
  readonly doc: DocInfo;
  readonly renderer: Renderer;
  readonly path: string;
  readonly fileName: string;
  readonly view: View;
  readonly page: number;
  readonly rotation: Rotation;
  readonly navMode: NavMode;
  readonly navAuto: boolean;
  readonly layoutMode: LayoutMode;
  readonly columns: number;
  /** Previews kept so the tab shows something at once when it comes back (owned here). */
  readonly previews: Map<number, Preview>;
  /** A small picture of the view as it was left, for the tab's hover card (owned here). */
  readonly snapshot: ImageBitmap | null;
  /** The password it was opened with, for reopening after a save. */
  readonly password?: string | null;
}

export interface SharpEvent {
  settleToSharpMs: number;
  /** Settle to the first band (or region) on screen; null if nothing needed rendering. */
  settleToFirstBandMs: number | null;
  complete: boolean;
  regions: number;
}

export interface FrameSample {
  t: number;
  drawMs: number;
}

/**
 * Rectangles drawn over the page, above the tiles (search hits, the text selection). The
 * fill is multiplied into the page, so the drawing stays readable underneath.
 */
export interface Highlight {
  /** Per page, [x0, y0, x1, y1] in page points (y down, unrotated). */
  rects: Map<number, [number, number, number, number][]>;
  fill: string;
  /** Optional outline, drawn normally (not multiplied), one device pixel wide. */
  stroke?: string;
  /** Lower draws first. */
  order: number;
  /** The document it belongs to: drawn only while that document is attached. */
  docId: number;
}

/**
 * Draws on a page above its tiles and highlights (markups). `m` maps page points (y down,
 * unrotated) to device pixels as a canvas transform; `pxPerPt` is device pixels per point. The
 * page is clipped; the context's transform and state are restored afterwards.
 */
export type PagePainter = (ctx: CanvasRenderingContext2D, page: number, m: [number, number, number, number, number, number], pxPerPt: number) => void;

export class Viewer {
  readonly opts: ViewerOptions;
  private highlights = new Map<string, Highlight>();
  private painters = new Map<string, PagePainter>();
  readonly cache: TileCache;
  readonly thumbnails: ThumbnailQueue;
  private ctx: CanvasRenderingContext2D;
  private previews = new Map<number, Preview>();
  private previewBytes = 0;
  private partials = new Set<PartialBand>();

  vw = 1;
  vh = 1;
  dpr = 1;
  view: View = { scale: 1, tx: 0, ty: 0 };
  doc: DocInfo | null = null;
  layout: Layout = computeLayout([], "continuous");
  fileName = "";
  currentPath = "";
  /** Per document: picked from the page size on open unless the user chooses (setNavMode). */
  navMode: NavMode = "cad";
  navAuto = true;
  layoutMode: LayoutMode = "continuous";
  /** Columns in the columns layout. */
  columns = 2;
  private rotationDeg: Rotation = 0;
  private page = 0;
  private loading = false;
  private error: string | null = null;
  /** The attached document's password, for reopening it after a save. */
  password: string | null = null;
  /** Pointer position in screen (CSS) px, or null when outside the canvas. */
  private pointer: { x: number; y: number } | null = null;

  // Interaction and settle state
  private lastInput = -Infinity;
  /** Last input that changed the render scale (or jumped); rendering waits for these to settle. */
  private lastScaleInput = -Infinity;
  /** A pan moved the view since the last plan: re-plan on the next frame, without waiting. */
  private panPending = false;
  private anim: { target: number; ax: number; ay: number } | null = null;
  /** An eased move to a whole new view (fit, a typed zoom, actual size): see animateTo. */
  private flight: { from: View; to: View; t0: number; dur: number } | null = null;
  /** The fit the view is at, if it hasn't been moved since: refitted when the window resizes. */
  private fitted: FitMode | null = null;
  /** A pinch held at a sticky zoom stop: the zoom factor gathered since it stopped. */
  private pinchHold: { stop: number; acc: number; t: number } | null = null;
  /** Sticky page edges for the current drag. */
  private stickX = new StickyAxis();
  private stickY = new StickyAxis();

  /** A wheel ease or a flight is moving the view. */
  private get animating(): boolean {
    return this.anim !== null || this.flight !== null;
  }

  private stopAnimations(): void {
    this.anim = null;
    this.flight = null;
  }
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private settleAt = 0;
  private measuring = false;
  private regionsThisSettle = 0;
  private firstBandThisSettle: number | null = null;

  // Render queue
  private queue: Job[] = [];
  private active = new Set<Job>();
  private gen = 0;

  // Frame loop
  private rafPending = false;
  private lastFrameT = 0;
  /** Called at the start of every frame while set (benchmark pan driver). */
  driver: ((t: number) => void) | null = null;

  // Stats
  frames: FrameSample[] = [];
  lastSettleToSharpMs: number | null = null;
  lastSettleToFirstBandMs: number | null = null;
  settleHistory: number[] = [];
  lastRenderMs = 0;
  rendersDone = 0;
  renderErrors = 0;
  bandsDrawn = 0;
  lastWheel = "";
  private sharpWaiters: ((e: SharpEvent) => void)[] = [];
  private bandWaiters: ((ms: number) => void)[] = [];
  private pendingBand = false;
  onUi: ((s: UiState) => void) | null = null;
  onSharp: ((e: SharpEvent) => void) | null = null;
  private uiPending = false;

  /** The renderer of the attached document (chosen per file by rendererFor). */
  renderer: Renderer;
  /** Use progressive (band by band) renders when the renderer supports them. */
  progressive = true;
  /**
   * Use the persistent preview cache: show a page's stored preview at once on open, and
   * store new previews for next time. Off in the benchmark, so runs stay cold.
   */
  diskPreviews = true;
  /** Pages of the attached document whose preview is on disk or being stored this session. */
  private storedPreviews = new Set<number>();

  constructor(
    private canvas: HTMLCanvasElement,
    opts: Partial<ViewerOptions> = {},
    renderer?: Renderer,
  ) {
    this.renderer = renderer ?? rendererFor(".pdf");
    this.opts = { ...DEFAULTS, ...opts };
    this.cache = new TileCache(this.opts.cacheBytes);
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.thumbnails = new ThumbnailQueue({
      isIdle: () => this.idleForThumbnails,
      fromPreview: (docId, page, maxSide) => this.thumbnailFromPreview(docId, page, maxSide),
      // Half the backend workers: thumbnails run only when idle, but one still parsing when
      // a zoom starts holds up that worker's band, so leave the other half free.
      concurrency: () => Math.max(1, Math.floor(((this.renderer as { workers?: number }).workers ?? 0) / 2)),
    });
  }

  // ---------------------------------------------------------------- document

  /**
   * Open a file, closing the attached document (detach() it first to keep it open in a tab).
   * Rejects with the backend's UI-ready message ("Password required", "Wrong password", ...);
   * `renderer` defaults to rendererFor(path).
   */
  async open(path: string, password?: string, renderer: Renderer = rendererFor(path)): Promise<void> {
    this.resetRendering();
    this.closeDoc();
    this.password = password ?? null;
    this.renderer = renderer;
    this.loading = true;
    this.error = null;
    this.fileName = path.split(/[\\/]/).pop() ?? path;
    this.currentPath = path;
    this.rotationDeg = 0;
    this.emitUi();
    const gen = this.gen;
    let doc: DocInfo;
    try {
      doc = await renderer.open(path, password);
    } catch (e) {
      if (gen === this.gen) {
        this.doc = null;
        this.error = String((e as Error)?.message ?? e);
        this.loading = false;
        this.emitUi();
      }
      throw e;
    }
    if (gen !== this.gen) {
      // Something else was opened or attached meanwhile: this one isn't wanted any more.
      renderer.close(doc.docId).catch(() => {});
      return;
    }
    this.doc = doc;
    this.page = 0;
    this.navAuto = true;
    this.navMode = autoNavMode(doc.sizes[0]);
    this.relayout();
    this.loading = false;
    this.fit(this.navMode === "document" ? "width" : "page", true);
    this.emitUi();
    // Nothing to wait for on open: render straight away rather than after the settle delay.
    this.settleNow();
    this.loadDiskPreviews();
  }

  /**
   * Show stored previews (from an earlier session) for the visible pages that have none yet.
   * They arrive in a few ms, long before a heavy page's first band.
   */
  private loadDiskPreviews(): void {
    const doc = this.doc;
    const r = this.renderer;
    if (!doc || !this.diskPreviews || !r.cachedPreview) return;
    const gen = this.gen;
    const vis = visibleWorldRect(this.view, this.vw, this.vh);
    for (const p of pagesInRect(this.layout, vis)) {
      if (this.previews.has(p)) continue;
      r.cachedPreview(doc.docId, p)
        .then((bmp) => {
          if (!bmp) return;
          if (gen !== this.gen || this.previews.has(p)) {
            bmp.close();
            return;
          }
          // Already on disk: don't store it again this session.
          this.storedPreviews.add(p);
          this.putPreview(p, bmp, bmp.width / doc.sizes[p].w);
          this.requestFrame();
        })
        .catch(() => {});
    }
  }

  /** Store a freshly made preview on disk once, when the viewer is idle. */
  private storePreviewLater(page: number): void {
    const doc = this.doc;
    const r = this.renderer;
    if (!doc || !this.diskPreviews || !r.storePreview || this.storedPreviews.has(page)) return;
    this.storedPreviews.add(page);
    const gen = this.gen;
    const attempt = () => {
      if (gen !== this.gen) return;
      if (!this.idleForBackground) {
        setTimeout(attempt, 250);
        return;
      }
      const pv = this.previews.get(page);
      if (!pv) return;
      r.storePreview!(doc.docId, page, pv.bitmap).catch((e) => console.warn("preview cache store failed", String(e)));
    };
    setTimeout(attempt, 250);
  }

  private settleNow(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.lastInput = -Infinity;
    this.lastScaleInput = -Infinity; // the fit on open was a "jump"; don't let it block the first render
    this.onSettle();
  }

  /** Close the attached document (if any) and free it in the backend. */
  close(): void {
    this.resetRendering();
    this.closeDoc();
    this.clearAttached();
  }

  private clearAttached(): void {
    this.currentPath = "";
    this.fileName = "";
    this.error = null;
    this.loading = false;
    this.rotationDeg = 0;
    this.layout = computeLayout([], this.layoutMode);
    this.requestFrame();
    this.emitUi();
  }

  private closeDoc(): void {
    if (this.doc) {
      const id = this.doc.docId;
      this.thumbnails.cancelDoc(id);
      this.renderer.close(id).catch((e) => console.error("close failed", e));
    }
    this.doc = null;
  }

  /**
   * Detach the attached document (a tab going to the background) and return its view state.
   * The document stays open in the backend and keeps its page previews (trimmed to
   * detachedPreviewBytes), so attach() shows it again at once. Tiles are dropped.
   */
  detach(): DocView | null {
    if (!this.doc) return null;
    const snapshot = this.snapshotView(); // before anything clears the canvas
    const previews = this.previews;
    this.previews = new Map();
    this.previewBytes = 0;
    this.resetRendering();
    // Keep the most recently used previews, the current page's first.
    let bytes = 0;
    const keep = new Map<number, Preview>();
    const order = [this.page, ...[...previews.keys()].reverse().filter((p) => p !== this.page)];
    for (const p of order) {
      const pv = previews.get(p);
      if (!pv) continue;
      if (bytes + pv.bytes > this.opts.detachedPreviewBytes && keep.size > 0) continue;
      keep.set(p, pv);
      bytes += pv.bytes;
    }
    for (const [p, pv] of previews) if (!keep.has(p)) pv.bitmap.close();
    const state: DocView = {
      doc: this.doc,
      renderer: this.renderer,
      path: this.currentPath,
      fileName: this.fileName,
      view: { ...this.view },
      page: this.page,
      rotation: this.rotationDeg,
      navMode: this.navMode,
      navAuto: this.navAuto,
      layoutMode: this.layoutMode,
      columns: this.columns,
      previews: keep,
      snapshot,
      password: this.password,
    };
    this.doc = null;
    this.clearAttached();
    return state;
  }

  /**
   * Attach a detached document (switching to its tab), closing whatever is attached now
   * (detach() it first to keep it). The DocView must not be used again afterwards.
   */
  attach(state: DocView): void {
    this.resetRendering();
    this.closeDoc();
    this.renderer = state.renderer;
    this.doc = state.doc;
    this.password = state.password ?? null;
    this.currentPath = state.path;
    this.fileName = state.fileName;
    this.error = null;
    this.loading = false;
    this.rotationDeg = state.rotation;
    this.navMode = state.navMode;
    this.navAuto = state.navAuto;
    this.layoutMode = state.layoutMode;
    this.columns = state.columns;
    this.page = Math.min(state.page, state.doc.numPages - 1);
    for (const [p, pv] of state.previews) {
      this.previews.set(p, pv);
      this.previewBytes += pv.bytes;
    }
    state.previews.clear();
    state.snapshot?.close();
    this.relayout();
    this.view = constrainView(state.view, this.layout.bounds, this.vw, this.vh);
    this.stopAnimations();
    this.fitted = null;
    this.requestFrame();
    this.emitUi();
    this.settleNow();
    this.loadDiskPreviews();
  }

  /** Free a detached document in the backend (closing a background tab). */
  closeDetached(state: DocView): void {
    for (const pv of state.previews.values()) pv.bitmap.close();
    state.previews.clear();
    state.snapshot?.close();
    this.thumbnails.cancelDoc(state.doc.docId);
    state.renderer.close(state.doc.docId).catch((e) => console.error("close failed", e));
  }

  /**
   * The canvas as it is now, shrunk (snapshotSize): what the tab looked like when it was left.
   * Synchronous, so it's taken before detaching clears anything. Null where there's no
   * OffscreenCanvas (tests) or nothing drawn.
   */
  private snapshotView(): ImageBitmap | null {
    const size = snapshotSize(this.canvas.width, this.canvas.height);
    if (!size || typeof OffscreenCanvas === "undefined") return null;
    try {
      const c = new OffscreenCanvas(size.w, size.h);
      const g = c.getContext("2d", { alpha: false });
      if (!g) return null;
      g.imageSmoothingQuality = "high";
      g.drawImage(this.canvas, 0, 0, size.w, size.h);
      return c.transferToImageBitmap();
    } catch (e) {
      console.warn("tab snapshot failed", String(e));
      return null;
    }
  }

  private resetRendering(): void {
    this.gen++;
    for (const j of this.active) j.ac?.abort();
    this.active.clear();
    this.queue = [];
    this.cache.clear();
    this.clearPartials();
    for (const p of this.previews.values()) p.bitmap.close();
    this.previews.clear();
    this.previewBytes = 0;
    this.storedPreviews.clear();
    this.measuring = false;
    this.pendingSharp = null;
  }

  private clearPartials(job?: Job): void {
    for (const b of [...this.partials]) {
      if (job && b.job !== job) continue;
      b.bitmap.close();
      this.partials.delete(b);
    }
  }

  /** Drop all cached tiles but keep previews (benchmark: forces a cold render at a scale). */
  dropTiles(): void {
    for (const j of this.active) j.ac?.abort();
    this.active.clear();
    this.queue = [];
    this.cache.clear();
    this.clearPartials();
    this.requestFrame();
  }

  /**
   * Re-render one page's tiles (an annotation on it was hidden or shown in PDFium). The page's
   * preview stays, so it shows underneath until the new tiles arrive.
   */
  dropPageTiles(page: number): void {
    for (const j of [...this.active]) {
      if (j.page !== page || j.kind !== "tiles") continue;
      j.ac?.abort();
      this.active.delete(j);
      this.clearPartials(j);
    }
    this.queue = this.queue.filter((j) => j.page !== page || j.kind !== "tiles");
    this.cache.dropOtherScales(page, []);
    this.requestFrame();
  }

  private relayout(): void {
    const sizes = (this.doc?.sizes ?? []).map((s) => rotatedSize(s, this.rotationDeg));
    this.layout = computeLayout(sizes, this.layoutMode, this.page, this.columns);
  }

  // ---------------------------------------------------------------- viewport

  resize(cssW: number, cssH: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    const dprChanged = dpr !== this.dpr;
    const [oldW, oldH] = [this.vw, this.vh];
    this.vw = cssW;
    this.vh = cssH;
    this.dpr = dpr;
    // The drawing stays put relative to the window: refit if it was at a fit, else keep the
    // point at the centre of the view at the centre (not the top-left corner).
    if (this.doc && (oldW !== cssW || oldH !== cssH) && oldW > 1 && oldH > 1) {
      this.flight = null;
      const r = this.fitted ? this.fitRectFor(this.fitted) : null;
      if (this.fitted && r) {
        const kept = keepCentre(this.view, oldW, oldH, cssW, cssH);
        const v = this.fitted === "width" ? fitWidthKeepingY(r, kept, cssW, cssH, FIT_PAD) : fitRect(r, cssW, cssH, FIT_PAD, "page");
        this.setView(v, "zoom");
      } else {
        this.setView(keepCentre(this.view, oldW, oldH, cssW, cssH), "pan");
      }
    }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    if (dprChanged) this.inputActivity(true);
    this.requestFrame();
    this.scheduleSettle();
  }

  // ---------------------------------------------------------------- navigation API

  setView(v: View, kind: "pan" | "zoom" | "jump"): void {
    const prevRs = scaleKey(this.view.scale * this.dpr);
    this.view = this.doc ? constrainView(v, this.layout.bounds, this.vw, this.vh) : v;
    const rsChanged = scaleKey(this.view.scale * this.dpr) !== prevRs;
    this.inputActivity(rsChanged || kind === "jump", rsChanged ? "zoom" : kind);
    this.requestFrame();
    this.emitUi();
  }

  panBy(dx: number, dy: number): void {
    this.flight = null;
    this.fitted = null;
    if (this.anim) {
      // Keep the zoom anchor glued to the content while panning mid-animation.
      this.anim.ax += dx;
      this.anim.ay += dy;
    }
    this.setView({ scale: this.view.scale, tx: this.view.tx + dx, ty: this.view.ty + dy }, "pan");
  }

  /**
   * Drag-pan by (dx, dy): like panBy, but a page edge reaching the viewport edge (or a page
   * narrower than the view reaching its centre) holds there for a short distance. Call
   * endDrag when the drag ends.
   */
  dragPan(dx: number, dy: number): void {
    const s = this.view.scale;
    const { tx, ty } = this.view;
    const world = visibleWorldRect(this.view, this.vw, this.vh);
    const spansX: Span[] = [];
    const spansY: Span[] = [];
    // Pages in or near view (a viewport either side), on screen at the current view.
    const near = { x: world.x - world.w, y: world.y - world.h, w: world.w * 3, h: world.h * 3 };
    for (const r of this.layout.rects) {
      if (!r) continue; // pages not laid out (single-page layout)
      if (r.x > near.x + near.w || r.x + r.w < near.x || r.y > near.y + near.h || r.y + r.h < near.y) continue;
      spansX.push({ a: r.x * s + tx, b: (r.x + r.w) * s + tx });
      spansY.push({ a: r.y * s + ty, b: (r.y + r.h) * s + ty });
    }
    const nx = this.stickX.move(tx, dx, alignStops(spansX, tx, this.vw));
    const ny = this.stickY.move(ty, dy, alignStops(spansY, ty, this.vh));
    if (nx !== tx || ny !== ty) this.panBy(nx - tx, ny - ty);
  }

  endDrag(): void {
    this.stickX.reset();
    this.stickY.reset();
  }

  /** Wheel scrolling pushed past the end of a page in single-page layout, in px. */
  private overscroll = { px: 0, t: 0 };

  /**
   * Wheel scrolling (same sign as panBy: negative dy scrolls down the page). In single-page
   * layout, scrolling on against the end of the page turns to the next one (its top), and
   * against the top to the previous one (its bottom), once OVERSCROLL_PX has gathered; at
   * fit page, where the page can't move, that's a page a notch.
   */
  scrollBy(dx: number, dy: number): void {
    const ty0 = this.view.ty;
    this.panBy(dx, dy);
    if (this.layoutMode !== "single" || !this.doc || dy === 0) return;
    const moved = this.view.ty - ty0;
    const now = performance.now();
    if (Math.abs(moved) > 0.5 || now - this.overscroll.t > 400) this.overscroll.px = 0;
    this.overscroll.t = now;
    if (Math.abs(moved) > 0.5) return;
    this.overscroll.px += dy;
    if (Math.abs(this.overscroll.px) < OVERSCROLL_PX) return;
    const down = this.overscroll.px < 0;
    this.overscroll.px = 0;
    if (down && this.page < this.doc.numPages - 1) {
      this.gotoPage(this.page + 1); // lands at the page's top
    } else if (!down && this.page > 0) {
      this.gotoPage(this.page - 1);
      const r = this.layout.rects[this.page];
      const s = this.view.scale;
      if (r && r.h * s > this.vh - 2 * FIT_PAD) {
        this.setView({ scale: s, tx: this.view.tx, ty: this.vh - FIT_PAD - (r.y + r.h) * s }, "jump"); // its bottom
      }
    }
  }

  /** The zooms a wheel or pinch stops at on the way past: 100%, fit width, fit page. */
  private zoomStops(): number[] {
    const stops = [zoomToScale(1)];
    const page = this.fitRectFor("page");
    const width = this.fitRectFor("width");
    if (page) stops.push(fitRect(page, this.vw, this.vh, FIT_PAD, "page").scale);
    if (width) stops.push(fitRect(width, this.vw, this.vh, FIT_PAD, "width").scale);
    return stops;
  }

  /**
   * Zoom by `factor` keeping screen point (sx, sy) fixed. Animated zooms (wheel notches,
   * keys) ease over ~100 ms. Both stick at 100%, fit width and fit page: a notch that would
   * cross one lands on it, and a pinch holds there until it has gone 8% further.
   */
  zoomAt(sx: number, sy: number, factor: number, animate: boolean): void {
    this.flight = null;
    this.fitted = null;
    if (animate) {
      const base = this.anim ? this.anim.target : this.view.scale;
      const target = stickyZoomTarget(base, clampScale(base * factor), this.zoomStops());
      this.anim = { target, ax: sx, ay: sy };
      this.inputActivity(true);
      this.requestFrame();
    } else {
      this.anim = null;
      const now = performance.now();
      if (this.pinchHold && now - this.pinchHold.t > 300) this.pinchHold = null; // a new gesture
      let next = this.view.scale * factor;
      if (this.pinchHold) {
        const h = this.pinchHold;
        h.acc *= factor;
        h.t = now;
        if (Math.abs(Math.log(h.acc)) < Math.log(1.08)) return; // still held
        next = h.stop * h.acc;
        this.pinchHold = null;
      } else {
        const stop = stickyZoomTarget(this.view.scale, next, this.zoomStops());
        if (stop !== next) {
          this.pinchHold = { stop, acc: next / stop, t: now };
          next = stop;
        }
      }
      this.setView(zoomAt(this.view, sx, sy, next), "zoom");
    }
  }

  /** Ease to a whole new view over `ms` (fit, a typed zoom, actual size). */
  animateTo(target: View, ms = 220): void {
    this.anim = null;
    const to = this.doc ? constrainView(target, this.layout.bounds, this.vw, this.vh) : target;
    this.flight = { from: { ...this.view }, to, t0: performance.now(), dur: ms };
    this.inputActivity(true);
    this.requestFrame();
  }

  zoomStep(dir: 1 | -1): void {
    this.zoomAt(this.vw / 2, this.vh / 2, dir > 0 ? 1.25 : 1 / 1.25, true);
  }

  /** Set the zoom (1 = 100%, actual size) keeping screen point (sx, sy) fixed. */
  setZoom(zoom: number, sx = this.vw / 2, sy = this.vh / 2, animate = false): void {
    this.fitted = null;
    const v = zoomAt(this.view, sx, sy, zoomToScale(zoom));
    if (animate) return this.animateTo(v);
    this.stopAnimations();
    this.setView(v, "zoom");
  }

  /** Step to the next zoom preset (ZOOM_PRESETS) above or below the current zoom. */
  zoomPreset(dir: 1 | -1): void {
    const z = nextZoomPreset(this.zoom, dir);
    if (z !== null) this.setZoom(z);
  }

  /**
   * Fit the current page (or its width) to the view. Fit width keeps the point at the
   * vertical centre where it is (fitWidthKeepingY), except on a jump (opening a document),
   * which starts at the page's top. `animate` eases there (toolbar, keys); otherwise at once.
   */
  /**
   * What a fit fits: the current page, except fit width in the columns layout, which fits the
   * whole row of columns (the grid's width, at the current page's row).
   */
  private fitRectFor(mode: FitMode): Rect | null {
    const r = this.layout.rects[this.page];
    if (!r) return null;
    if (mode === "width" && this.layoutMode === "columns") {
      const b = this.layout.bounds;
      return { x: b.x, y: r.y, w: b.w, h: r.h };
    }
    return r;
  }

  fit(mode: FitMode, jump = false, animate = false): void {
    const r = this.fitRectFor(mode);
    if (!r) return;
    const v = mode === "width" && !jump ? fitWidthKeepingY(r, this.view, this.vw, this.vh, FIT_PAD) : fitRect(r, this.vw, this.vh, FIT_PAD, mode);
    if (animate && !jump) this.animateTo(v);
    else {
      this.stopAnimations();
      this.setView(v, jump ? "jump" : "zoom");
    }
    this.fitted = mode;
  }

  actualSize(animate = false): void {
    this.setZoom(1, this.vw / 2, this.vh / 2, animate);
  }

  gotoPage(i: number): void {
    if (!this.doc) return;
    i = Math.max(0, Math.min(this.doc.numPages - 1, i));
    this.page = i;
    if (this.layoutMode === "single") this.relayout();
    const r = this.layout.rects[i]!;
    const s = this.view.scale;
    let tx = this.view.tx;
    const left = r.x * s + tx;
    const right = (r.x + r.w) * s + tx;
    if (r.w * s <= this.vw || right < 0 || left > this.vw) tx = this.vw / 2 - (r.x + r.w / 2) * s;
    const ty = r.h * s <= this.vh - 2 * FIT_PAD ? this.vh / 2 - (r.y + r.h / 2) * s : FIT_PAD - r.y * s;
    this.stopAnimations();
    this.setView({ scale: s, tx, ty }, "jump");
  }

  nextPage(): void { this.gotoPage(this.page + 1); }
  prevPage(): void { this.gotoPage(this.page - 1); }
  firstPage(): void { this.gotoPage(0); }
  lastPage(): void { this.gotoPage((this.doc?.numPages ?? 1) - 1); }

  /** Centre the view on a world point, keeping the zoom (the mini map's click and drag). */
  centreOnWorld(wx: number, wy: number): void {
    if (!this.doc) return;
    const s = this.view.scale;
    this.stopAnimations();
    this.fitted = null;
    this.setView({ scale: s, tx: this.vw / 2 - wx * s, ty: this.vh / 2 - wy * s }, "pan");
  }

  /**
   * Centre the view on a page point (unrotated page points), keeping the zoom: outline
   * targets, the mini map's drag. Switches page in single-page layout.
   */
  centreOn(page: number, x: number, y: number): void {
    if (!this.doc || page < 0 || page >= this.doc.numPages) return;
    if (this.layoutMode === "single" && page !== this.page) {
      this.page = page;
      this.relayout();
    }
    const r = this.layout.rects[page];
    if (!r) return;
    const [X, Y] = rotatePoint(x, y, this.doc.sizes[page], this.rotationDeg);
    const s = this.view.scale;
    this.stopAnimations();
    this.fitted = null;
    this.setView({ scale: s, tx: this.vw / 2 - (r.x + X) * s, ty: this.vh / 2 - (r.y + Y) * s }, "pan");
  }

  /** Set (or with null, remove) a named page painter and redraw. Painters run in name order. */
  setPainter(name: string, p: PagePainter | null): void {
    if (p) this.painters.set(name, p);
    else if (!this.painters.delete(name)) return;
    this.requestFrame();
  }

  /**
   * Reopen the attached PDF after its file was replaced (a save), keeping the view, page,
   * rotation, layout, tiles and previews: only annotations changed, and the ones Vellum draws
   * itself are hidden in PDFium again by `afterOpen` before anything renders. `between` runs
   * once the backend has let go of the file (it moves the saved file into place). If it
   * fails, the original is reopened and the error rethrown.
   */
  async reopen(between: () => Promise<void>, afterOpen?: (docId: number) => Promise<void>): Promise<void> {
    const old = this.doc;
    if (!old) return between();
    const r = this.renderer;
    this.resetRendering();
    this.thumbnails.cancelDoc(old.docId);
    const gen = this.gen;
    if (r.closeAndWait) await r.closeAndWait(old.docId);
    else await r.close(old.docId);
    let failure: unknown = null;
    try {
      await between();
    } catch (e) {
      failure = e;
    }
    let doc: DocInfo;
    try {
      doc = await r.open(this.currentPath, this.password ?? undefined);
      if (afterOpen) await afterOpen(doc.docId);
    } catch (e) {
      // The file can't be reopened: show it as an error rather than a stale document.
      this.doc = null;
      this.error = String((e as Error)?.message ?? e);
      this.cache.clear();
      this.emitUi();
      throw failure ?? e;
    }
    if (gen !== this.gen) {
      r.close(doc.docId).catch(() => {});
      return;
    }
    this.doc = { ...doc };
    this.requestFrame();
    this.emitUi();
    this.settleNow();
    if (failure) throw failure;
  }

  /** Set (or with null, remove) a named highlight layer and redraw. */
  setHighlights(name: string, h: Highlight | null): void {
    if (h) this.highlights.set(name, h);
    else if (!this.highlights.delete(name)) return;
    this.requestFrame();
  }

  /**
   * Bring a rectangle on a page (page points) into view: centre it if it's off screen, and
   * zoom in if it would be too small to read (search hits on a drawing at fit). Eases there.
   */
  revealRect(page: number, b: [number, number, number, number]): void {
    if (!this.doc || page < 0 || page >= this.doc.numPages) return;
    if (this.layoutMode === "single" && page !== this.page) {
      this.page = page;
      this.relayout();
      this.setView(this.view, "jump");
    }
    const r = this.layout.rects[page];
    if (!r) return;
    const rr = rotateRect({ x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] }, this.doc.sizes[page], this.rotationDeg);
    const v = revealView(this.view, { x: r.x + rr.x, y: r.y + rr.y, w: rr.w, h: rr.h }, this.vw, this.vh);
    if (!v) return;
    this.fitted = null;
    this.animateTo(v);
  }

  /** Show a page point at the top of the viewport (bookmark targets with a y). */
  gotoPagePoint(page: number, y: number | null): void {
    if (!this.doc) return;
    if (y === null) return this.gotoPage(page);
    this.gotoPage(page);
    const r = this.layout.rects[page];
    if (!r) return;
    const size = this.doc.sizes[page];
    const [X, Y] = rotatePoint(size.w / 2, y, size, this.rotationDeg);
    const s = this.view.scale;
    this.setView({ scale: s, tx: this.vw / 2 - (r.x + X) * s, ty: FIT_PAD - (r.y + Y) * s }, "jump");
  }

  /** Columns for the columns layout; relays out if that's the layout in use. */
  setColumns(n: number): void {
    if (n === this.columns) return;
    this.columns = n;
    if (this.layoutMode === "columns") {
      this.relayout();
      this.gotoPage(this.page);
      if (this.doc) this.fit("width", true);
    }
  }

  setLayoutMode(m: LayoutMode): void {
    if (m === this.layoutMode) return;
    this.layoutMode = m;
    this.relayout();
    this.gotoPage(this.page);
    // Columns opens fitted to the whole row, the current page's row at the top.
    if (m === "columns" && this.doc) this.fit("width", true);
  }

  /** Choose the navigation mode for this document, or "auto" to follow its page size. */
  setNavMode(m: NavMode | "auto"): void {
    this.navAuto = m === "auto";
    this.navMode = m === "auto" ? autoNavMode(this.doc?.sizes[0]) : m;
    this.emitUi();
  }

  get rotation(): Rotation {
    return this.rotationDeg;
  }

  /**
   * Rotate the view (never the file) to 0, 90, 180 or 270 degrees clockwise, keeping the
   * point at the centre of the viewport where it is. Cached tiles stay valid.
   */
  setRotation(deg: number): void {
    const r = normRotation(deg);
    if (r === this.rotationDeg) return;
    const anchor = this.pagePointAt(this.vw / 2, this.vh / 2);
    this.rotationDeg = r;
    this.relayout();
    if (anchor) this.centreOn(anchor.page, anchor.x, anchor.y);
    else this.gotoPage(this.page);
    this.setView(this.view, "jump");
  }

  /** Rotate by a quarter turn: 1 clockwise, -1 anticlockwise. */
  rotate(dir: 1 | -1): void {
    this.setRotation(this.rotationDeg + dir * 90);
  }

  get zoom(): number {
    return scaleToZoom(this.view.scale);
  }

  get currentPageIndex(): number {
    return this.page;
  }

  /** The page point under screen point (sx, sy) in CSS px, or null when not over a page. */
  pagePointAt(sx: number, sy: number): PagePoint | null {
    if (!this.doc) return null;
    const [wx, wy] = screenToWorld(this.view, sx, sy);
    for (const p of pagesInRect(this.layout, { x: wx, y: wy, w: 1e-9, h: 1e-9 })) {
      const r = this.layout.rects[p]!;
      if (wx < r.x || wy < r.y || wx > r.x + r.w || wy > r.y + r.h) continue;
      const [x, y] = unrotatePoint(wx - r.x, wy - r.y, this.doc.sizes[p], this.rotationDeg);
      return { page: p, x, y };
    }
    return null;
  }

  /** A page point on screen (CSS px in the viewport), or null if the page isn't laid out. */
  pageToScreen(page: number, x: number, y: number): [number, number] | null {
    const r = this.layout.rects[page];
    if (!this.doc || !r) return null;
    const [X, Y] = rotatePoint(x, y, this.doc.sizes[page], this.rotationDeg);
    return [(r.x + X) * this.view.scale + this.view.tx, (r.y + Y) * this.view.scale + this.view.ty];
  }

  /** The viewport in a page's own points (unrotated; may extend past the page). */
  viewportOnPage(page: number): Rect | null {
    const r = this.layout.rects[page];
    if (!this.doc || !r) return null;
    const vis = visibleWorldRect(this.view, this.vw, this.vh);
    return unrotateRect({ x: vis.x - r.x, y: vis.y - r.y, w: vis.w, h: vis.h }, this.doc.sizes[page], this.rotationDeg);
  }

  /** Tell the viewer where the pointer is (CSS px in the viewport), or null when it leaves. */
  setPointer(sx: number | null, sy?: number): void {
    this.pointer = sx === null ? null : { x: sx, y: sy ?? 0 };
    this.emitUi();
  }

  /** A page's low-resolution preview, if one is cached (mini map). Don't close or keep it. */
  previewFor(page: number): { bitmap: ImageBitmap; rs: number } | null {
    const p = this.previews.get(page);
    return p ? { bitmap: p.bitmap, rs: p.rs } : null;
  }

  /**
   * A thumbnail of a page of the attached document, longer side `maxSide` device px, rendered
   * at low priority (never ahead of visible tiles) and cached. The caller owns the bitmap.
   */
  thumbnail(page: number, maxSide: number): Promise<ImageBitmap> {
    if (!this.doc) return Promise.reject(new Error("no document"));
    return this.thumbnails.request(this.renderer, this.doc.docId, page, maxSide);
  }

  /** Drop a waiting thumbnail request (its page scrolled out of the sidebar). */
  cancelThumbnail(page: number, maxSide: number): void {
    if (this.doc) this.thumbnails.cancel(this.doc.docId, page, maxSide);
  }

  private thumbnailFromPreview(docId: number, page: number, maxSide: number): ImageBitmap | null {
    if (!this.doc || this.doc.docId !== docId || typeof OffscreenCanvas === "undefined") return null;
    const pv = this.previews.get(page);
    if (!pv) return null;
    const size = this.doc.sizes[page];
    const k = maxSide / Math.max(size.w, size.h);
    if (k > pv.rs) return null; // the preview is too coarse for this size
    const w = Math.max(1, Math.ceil(size.w * k));
    const h = Math.max(1, Math.ceil(size.h * k));
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext("2d", { alpha: false })!;
    g.imageSmoothingQuality = "high";
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, w, h);
    g.drawImage(pv.bitmap, 0, 0, pv.bitmap.width * (k / pv.rs), pv.bitmap.height * (k / pv.rs));
    return c.transferToImageBitmap();
  }

  /** Any input in the last settle window, or a zoom animation in flight. */
  get interacting(): boolean {
    return this.animating || performance.now() - this.lastInput < this.opts.settleMs;
  }

  /** Nothing rendering or queued for the view and no recent input: background work may run. */
  get idleForBackground(): boolean {
    return (
      !this.animating &&
      !this.settleTimer &&
      this.active.size === 0 &&
      this.queue.length === 0 &&
      performance.now() - this.lastInput > IDLE_AFTER_INPUT_MS
    );
  }

  /**
   * Thumbnails may also run beside a render that occupies a single backend worker (a small
   * region, or a page whose big image renders as one band, like Bayou's cover scan that takes
   * seconds): the other workers are idle. Not beside a banded render, which uses every worker.
   */
  get idleForThumbnails(): boolean {
    if (this.animating || this.settleTimer || this.queue.length > 0) return false;
    if (performance.now() - this.lastInput <= IDLE_AFTER_INPUT_MS) return false;
    for (const j of this.active) if (j.bands !== 1) return false;
    return true;
  }

  /**
   * Rendering holds off only while the scale is changing: a zoom invalidates every tile,
   * so rendering mid-zoom would be wasted. A pan keeps every tile valid, so rendering
   * carries on throughout a drag and the newly uncovered strip fills in as you go.
   */
  private get renderBlocked(): boolean {
    return this.animating || performance.now() - this.lastScaleInput < this.scaleSettleMs;
  }

  /** Settle delay for the latest scale change: short after a wheel ease, else opts.settleMs. */
  private scaleSettleMs = 150;

  /** The scale tiles are rendered at (see chooseRenderScale); 0 before the first zoom. */
  private renderRs = 0;

  private updateRenderRs(): void {
    const display = scaleKey(this.view.scale * this.dpr);
    this.renderRs = chooseRenderScale(this.renderRs || null, display);
  }

  /** The render scale for the current view, for planning and drawing. */
  get renderScale(): number {
    return this.renderRs || scaleKey(this.view.scale * this.dpr);
  }

  // ---------------------------------------------------------------- settle / schedule

  /**
   * Any input restarts the settle timer (which drives the settle-to-sharp measurement and
   * previews). A zoom or jump also drops the queue, since it was planned for a view that
   * no longer exists, and aborts renders at other scales. A pan keeps the queue and
   * re-plans on the next frame so visible tiles stay first.
   */
  private inputActivity(scaleChanged: boolean, kind: "pan" | "zoom" | "jump" = "zoom"): void {
    this.lastInput = performance.now();
    this.measuring = false;
    this.pendingSharp = null;
    if (kind === "pan") {
      this.panPending = true;
    } else {
      this.lastScaleInput = this.lastInput;
      this.scaleSettleMs = this.opts.settleMs;
      this.queue = [];
      // Mid-ease the display scale is in passing: choose when the animation lands.
      if (!this.animating) this.updateRenderRs();
      if (scaleChanged) {
        const rs = this.renderScale;
        for (const j of this.active) if (j.rs !== rs) j.ac?.abort();
      }
    }
    this.scheduleSettle();
  }

  private scheduleSettle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    if (this.animating) return; // restarted when the animation lands
    const ms = performance.now() - this.lastScaleInput < this.scaleSettleMs ? this.scaleSettleMs : this.opts.settleMs;
    this.settleTimer = setTimeout(() => this.onSettle(), ms);
  }

  private onSettle(): void {
    this.settleTimer = null;
    if (!this.doc || this.animating) return;
    this.settleAt = performance.now();
    this.measuring = true;
    this.regionsThisSettle = 0;
    this.firstBandThisSettle = null;
    this.panPending = false;
    this.plan();
    if (this.queue.length === 0 && this.active.size === 0) {
      this.finishMeasure();
      this.thumbnails.kick();
    } else this.pump();
  }

  /** Tile range of page `p` at render scale `rs` covering the world rect `vis`. */
  private pageRange(p: number, grid: TileGrid, rs: number, vis: Rect, margin: number): TileIndexRange | null {
    const r = this.layout.rects[p]!;
    const size = this.doc!.sizes[p];
    const l = unrotateRect({ x: vis.x - r.x, y: vis.y - r.y, w: vis.w, h: vis.h }, size, this.rotationDeg);
    return tileRangeForRect(l.x, l.y, l.x + l.w, l.y + l.h, size.w, size.h, grid, rs, margin);
  }

  /** Work out which tiles are missing at the current scale and queue region renders. */
  private plan(): void {
    if (!this.doc) return;
    const rs = this.renderScale;
    const vis = visibleWorldRect(this.view, this.vw, this.vh);
    const cx = this.vw / 2;
    const cy = this.vh / 2;
    const jobs: Job[] = [];
    const maxSide = Math.max(1, Math.floor(this.opts.maxRegion / TILE));

    for (const p of pagesInRect(this.layout, vis)) {
      const rect = this.layout.rects[p]!;
      const size = this.doc.sizes[p];
      const grid = tileGrid(size, rs);
      const core = this.pageRange(p, grid, rs, vis, 0);
      if (!core) continue;
      const ring = this.pageRange(p, grid, rs, vis, 1)!;
      const missingCore: { i: number; j: number }[] = [];
      const missingRing: { i: number; j: number }[] = [];
      for (let j = ring.j0; j <= ring.j1; j++) {
        for (let i = ring.i0; i <= ring.i1; i++) {
          if (this.cache.peek(p, rs, i, j)) continue;
          const inCore = i >= core.i0 && i <= core.i1 && j >= core.j0 && j <= core.j1;
          (inCore ? missingCore : missingRing).push({ i, j });
        }
      }
      // Core tiles first (they gate "sharp"), then a one-tile prefetch ring.
      for (const [prio, missing] of [[0, missingCore], [1, missingRing]] as const) {
        const set = new Set(missing.map((t) => t.i * 100003 + t.j));
        for (const reg of groupIntoRegions(missing, maxSide)) {
          const tiles: TileSpec[] = [];
          for (let j = reg.j0; j <= reg.j1; j++)
            for (let i = reg.i0; i <= reg.i1; i++)
              if (set.has(i * 100003 + j)) tiles.push(tileSpec(grid, i, j));
          const req = regionRequest(p, rs, grid, reg, tiles);
          const [X, Y] = rotatePoint((req.x + req.w / 2) / rs, (req.y + req.h / 2) / rs, size, this.rotationDeg);
          const sx = (rect.x + X) * this.view.scale + this.view.tx;
          const sy = (rect.y + Y) * this.view.scale + this.view.ty;
          jobs.push({ kind: "tiles", page: p, rs, req, prio, dist: Math.hypot(sx - cx, sy - cy) });
        }
      }
      // A low-resolution whole-page preview sits under the tiles so panning into
      // unrendered areas shows soft content instead of white.
      if (!this.previews.has(p)) {
        const prs = previewScale(size.w, size.h);
        const pg = tileGrid(size, prs);
        const whole = { i: 0, j: 0, x: 0, y: 0, w: pg.devW, h: pg.devH };
        jobs.push({
          kind: "preview", page: p, rs: prs, prio: 2, dist: 0,
          req: { page: p, rs: prs, x: 0, y: 0, w: pg.devW, h: pg.devH, tiles: [whole] },
        });
      }
    }
    jobs.sort((a, b) => a.prio - b.prio || a.dist - b.dist);
    this.queue = jobs;
  }

  private get concurrency(): number {
    return (this.renderer as { concurrency?: number }).concurrency ?? 1;
  }

  /**
   * Small regions (zoomed out, usually one per page) render whole on their page's own
   * backend worker, so more of them can be in flight at once: up to one per worker.
   * Large regions are banded across every worker and stay at `concurrency`.
   */
  private canStart(job: Job): boolean {
    if (this.active.size < this.concurrency) return true;
    const workers = (this.renderer as { workers?: number }).workers ?? 0;
    const small = (j: Job) => j.req.w * j.req.h <= SMALL_REGION_PX;
    if (!small(job) || this.active.size >= workers) return false;
    for (const a of this.active) if (!small(a)) return false;
    return true;
  }

  private pump(): void {
    if (this.renderBlocked) return;
    while (this.queue.length && this.canStart(this.queue[0])) {
      const job = this.queue.shift()!;
      // A preview may have been composed from tiles since this job was planned.
      if (job.kind === "preview" && this.previews.has(job.page)) continue;
      this.start(job);
    }
  }

  private putTiles(job: Job, items: { index: number; bitmap: ImageBitmap }[]): void {
    for (const { index, bitmap } of items) {
      const t = job.req.tiles[index];
      this.cache.put({
        key: tileKey(job.page, job.rs, t.i, t.j),
        page: job.page, rs: job.rs, i: t.i, j: t.j, w: t.w, h: t.h,
        bitmap, bytes: t.w * t.h * 4,
      });
    }
  }

  /**
   * Find out how many workers a running render occupies (see idleForThumbnails). Small
   * regions always use one. A large one asks the backend, which knows once it has planned
   * the page's first large render: retried a few times, since this can beat the plan.
   */
  private learnBands(job: Job, tries = 5): void {
    if (job.req.w * job.req.h <= SMALL_REGION_PX) {
      job.bands = 1;
      return;
    }
    const doc = this.doc;
    if (!doc || !this.renderer.knownBands) return;
    this.renderer
      .knownBands(doc.docId, job.page)
      .then((n) => {
        if (!this.active.has(job)) return;
        if (n !== null) job.bands = n;
        else if (tries > 1) setTimeout(() => this.learnBands(job, tries - 1), 100);
      })
      .catch(() => {});
  }

  private start(job: Job): void {
    const gen = this.gen;
    const docId = this.doc!.docId;
    const renderer = this.renderer;
    job.ac = new AbortController();
    const signal = job.ac.signal;
    this.active.add(job);
    this.learnBands(job);
    const t0 = performance.now();
    const stale = () => gen !== this.gen || signal.aborted;

    let work: Promise<void>;
    if (job.kind === "tiles" && this.progressive && renderer.renderRegionProgressive) {
      work = renderer
        .renderRegionProgressive(docId, job.req, (b) => {
          if (gen !== this.gen) {
            b.bitmap?.close();
            b.tiles.forEach((t) => t.bitmap.close());
            return;
          }
          this.putTiles(job, b.tiles);
          if (b.bitmap) {
            this.partials.add({ job, page: job.page, rs: job.rs, x: b.x, y: b.y, w: b.w, h: b.h, bitmap: b.bitmap });
          }
          this.noteBand(job);
          this.requestFrame();
        }, signal)
        .then(() => {
          if (stale()) return;
          this.lastRenderMs = performance.now() - t0;
          this.rendersDone++;
          this.regionsThisSettle++;
          this.maybeComposePreview(job.page, job.rs);
          this.requestFrame();
        });
    } else {
      work = renderer.renderRegion(docId, job.req, signal).then((bitmaps) => {
        if (!bitmaps || gen !== this.gen) {
          bitmaps?.forEach((b) => b.close());
          return;
        }
        this.lastRenderMs = performance.now() - t0;
        this.rendersDone++;
        if (job.kind === "preview") {
          this.putPreview(job.page, bitmaps[0], job.rs);
          this.storePreviewLater(job.page);
        } else {
          this.regionsThisSettle++;
          this.putTiles(job, bitmaps.map((bitmap, index) => ({ index, bitmap })));
          this.noteBand(job);
          this.maybeComposePreview(job.page, job.rs);
        }
        this.requestFrame();
      });
    }
    work
      .catch((e) => {
        this.renderErrors++;
        console.error("render failed", e);
      })
      .finally(() => {
        this.active.delete(job);
        // Its tiles are cached now (or it was abandoned): the band overlay has done its job.
        this.clearPartials(job);
        this.requestFrame();
        if (
          this.measuring &&
          !this.queue.some((j) => j.prio === 0) &&
          ![...this.active].some((j) => j.prio === 0)
        )
          this.finishMeasure();
        this.pump();
        if (this.idleForBackground) this.thumbnails.kick();
      });
  }

  /** A band (or a whole non-progressive region) of visible tiles just landed. */
  private noteBand(job: Job): void {
    this.bandsDrawn++;
    if (job.prio === 0 && this.firstBandThisSettle === null) {
      this.firstBandThisSettle = performance.now();
      this.pendingBand = true;
    }
  }

  /**
   * Called once all core (visible) tiles for this settle are in the cache. The clock stops
   * only when the frame showing them has been presented: we draw it, then wait for the
   * following rAF. With GPU canvases some rasterisation is deferred to the GPU process,
   * and Chromium paces rAF on GPU acks, so this includes that work.
   */
  private finishMeasure(): void {
    if (!this.measuring) return;
    this.measuring = false;
    this.pendingSharp = { complete: this.visibleComplete(), regions: this.regionsThisSettle };
    this.requestFrame();
  }

  private pendingSharp: { complete: boolean; regions: number } | null = null;

  private reportSharp(p: { complete: boolean; regions: number }): void {
    const ms = performance.now() - this.settleAt;
    this.lastSettleToSharpMs = ms;
    this.settleHistory.push(ms);
    if (this.settleHistory.length > 50) this.settleHistory.shift();
    const ev: SharpEvent = {
      settleToSharpMs: ms,
      settleToFirstBandMs: this.lastSettleToFirstBandMs !== null && p.regions > 0 ? this.lastSettleToFirstBandMs : null,
      complete: p.complete,
      regions: p.regions,
    };
    this.onSharp?.(ev);
    const w = this.sharpWaiters;
    this.sharpWaiters = [];
    w.forEach((f) => f(ev));
  }

  private reportFirstBand(): void {
    const ms = performance.now() - this.settleAt;
    this.lastSettleToFirstBandMs = ms;
    const w = this.bandWaiters;
    this.bandWaiters = [];
    w.forEach((f) => f(ms));
  }

  /** True when every tile covering the viewport exists at the current scale. */
  visibleComplete(): boolean {
    if (!this.doc) return true;
    const rs = this.renderScale;
    const vis = visibleWorldRect(this.view, this.vw, this.vh);
    for (const p of pagesInRect(this.layout, vis)) {
      const grid = tileGrid(this.doc.sizes[p], rs);
      const r = this.pageRange(p, grid, rs, vis, 0);
      if (!r) continue;
      for (let j = r.j0; j <= r.j1; j++)
        for (let i = r.i0; i <= r.i1; i++) if (!this.cache.peek(p, rs, i, j)) return false;
    }
    return true;
  }

  /** Resolves at the next "all visible tiles sharp" moment. */
  whenSharp(): Promise<SharpEvent> {
    return new Promise((res) => this.sharpWaiters.push(res));
  }

  /**
   * Resolves when the first band of visible content from the next render is on screen (the
   * frame showing it presented), with the time since that settle in ms.
   */
  whenFirstBand(): Promise<number> {
    return new Promise((res) => this.bandWaiters.push(res));
  }

  /** Resolves once settled with nothing rendering or queued (previews included). */
  async whenIdle(timeoutMs = 120000): Promise<boolean> {
    const t0 = performance.now();
    for (;;) {
      if (!this.interacting && !this.settleTimer && this.active.size === 0 && this.queue.length === 0) return true;
      if (performance.now() - t0 > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get rendering(): boolean {
    return this.active.size > 0;
  }

  // ---------------------------------------------------------------- previews

  private putPreview(page: number, bitmap: ImageBitmap, rs: number): void {
    const old = this.previews.get(page);
    if (old) {
      this.previewBytes -= old.bytes;
      old.bitmap.close();
      this.previews.delete(page);
    }
    const bytes = bitmap.width * bitmap.height * 4;
    this.previews.set(page, { bitmap, rs, bytes });
    this.previewBytes += bytes;
    while (this.previewBytes > this.opts.previewBytes && this.previews.size > 1) {
      const [k, v] = this.previews.entries().next().value as [number, Preview];
      this.previews.delete(k);
      this.previewBytes -= v.bytes;
      v.bitmap.close();
    }
  }

  /**
   * If the whole page is now cached at `rs` (typical at fit zoom), build its preview by
   * downscaling those tiles: a cheap GPU copy instead of another full render pass.
   */
  private maybeComposePreview(page: number, rs: number): void {
    if (this.previews.has(page) || !this.doc) return;
    const size = this.doc.sizes[page];
    const grid = tileGrid(size, rs);
    for (let j = 0; j < grid.rows; j++)
      for (let i = 0; i < grid.cols; i++) if (!this.cache.peek(page, rs, i, j)) return;
    const prs = Math.min(rs, previewScale(size.w, size.h));
    const pg = tileGrid(size, prs);
    const c = new OffscreenCanvas(pg.devW, pg.devH);
    const g = c.getContext("2d", { alpha: false })!;
    g.imageSmoothingQuality = "high";
    const k = prs / rs;
    for (let j = 0; j < grid.rows; j++)
      for (let i = 0; i < grid.cols; i++) {
        const t = this.cache.peek(page, rs, i, j)!;
        g.drawImage(t.bitmap, i * TILE * k, j * TILE * k, t.w * k, t.h * k);
      }
    this.putPreview(page, c.transferToImageBitmap(), prs);
    this.storePreviewLater(page);
  }

  // ---------------------------------------------------------------- frame loop

  requestFrame(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame((t) => this.frame(t));
  }

  private frame(t: number): void {
    this.rafPending = false;
    const dt = this.lastFrameT ? Math.min(50, t - this.lastFrameT) : 16;
    this.lastFrameT = t;
    if (this.driver) {
      this.driver(t);
      this.requestFrame();
    }
    if (this.flight) {
      const f = this.flight;
      const e = easeOutCubic((performance.now() - f.t0) / f.dur);
      this.view = interpolateView(f.from, f.to, e, this.vw, this.vh);
      if (e >= 1) {
        this.view = f.to;
        this.flight = null;
        this.inputActivity(true);
        this.scaleSettleMs = Math.min(WHEEL_SETTLE_MS, this.opts.settleMs);
        this.scheduleSettle();
      } else {
        this.lastInput = performance.now();
        this.requestFrame();
      }
      this.emitUi();
    }
    if (this.anim) {
      const s = approachScale(this.view.scale, this.anim.target, dt);
      this.view = constrainView(
        zoomAt(this.view, this.anim.ax, this.anim.ay, s),
        this.layout.bounds, this.vw, this.vh,
      );
      if (s === this.anim.target) {
        this.anim = null;
        this.inputActivity(true);
        // The ease covered the wait for more notches: settle soon.
        this.scaleSettleMs = Math.min(WHEEL_SETTLE_MS, this.opts.settleMs);
        this.scheduleSettle();
      } else {
        this.lastInput = performance.now();
        this.requestFrame();
      }
      this.emitUi();
    }
    const d0 = performance.now();
    this.draw();
    const drawMs = performance.now() - d0;
    this.frames.push({ t, drawMs });
    if (this.frames.length > 600) this.frames.splice(0, this.frames.length - 600);
    if (this.pendingBand) {
      this.pendingBand = false;
      requestAnimationFrame(() => this.reportFirstBand());
    }
    if (this.pendingSharp) {
      const p = this.pendingSharp;
      this.pendingSharp = null;
      requestAnimationFrame(() => this.reportSharp(p));
    }
    // Mid-pan: re-plan for the new view (visible tiles first, nearest the centre first)
    // and keep the renderer busy. Cheap: a few tile-range loops per visible page.
    if (this.panPending && this.doc && !this.renderBlocked) {
      this.panPending = false;
      this.plan();
    }
    // Kick the queue if a render was waiting for a zoom to end.
    if (this.queue.length && !this.renderBlocked && this.canStart(this.queue[0])) this.pump();
  }

  /** Frames per second over the last second of frames (0 when idle). */
  fps(now = performance.now()): number {
    const recent = this.frames.filter((f) => now - f.t < 1000);
    if (recent.length < 2) return 0;
    return ((recent.length - 1) * 1000) / (recent[recent.length - 1].t - recent[0].t);
  }

  // ---------------------------------------------------------------- compositor

  private draw(): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const { scale, tx, ty } = this.view;
    const rot = this.rotationDeg;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = canvasColour();
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.doc) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    const target = this.renderScale;
    const vis = visibleWorldRect(this.view, this.vw, this.vh);
    const pages = pagesInRect(this.layout, vis);

    for (const p of pages) {
      const r = this.layout.rects[p]!;
      const size = this.doc.sizes[p];
      // Page-point rect -> device-pixel rect on screen, edges rounded. Every tile edge is
      // computed by the same formula for both neighbours, so tiles share exact edges.
      const dev = (x0: number, y0: number, x1: number, y1: number): [number, number, number, number] => {
        const [ax, ay] = rotatePoint(x0, y0, size, rot);
        const [bx, by] = rotatePoint(x1, y1, size, rot);
        return [
          Math.round(((r.x + Math.min(ax, bx)) * scale + tx) * dpr),
          Math.round(((r.y + Math.min(ay, by)) * scale + ty) * dpr),
          Math.round(((r.x + Math.max(ax, bx)) * scale + tx) * dpr),
          Math.round(((r.y + Math.max(ay, by)) * scale + ty) * dpr),
        ];
      };
      const blit = (bmp: ImageBitmap, d: [number, number, number, number]) => {
        if (rot === 0) {
          ctx.drawImage(bmp, d[0], d[1], d[2] - d[0], d[3] - d[1]);
          return;
        }
        const t = rotatedDrawTransform(d[0], d[1], d[2], d[3], rot);
        ctx.setTransform(...t.m);
        ctx.drawImage(bmp, 0, 0, t.dw, t.dh);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      };

      const [X0, Y0, X1, Y1] = dev(0, 0, size.w, size.h);
      // Soft shadow: two translucent offsets (much cheaper per frame than shadowBlur).
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(X0 - 1, Y0, X1 - X0 + 2, Y1 - Y0 + 3 * dpr);
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(X0 - 2, Y0 + dpr, X1 - X0 + 4, Y1 - Y0 + 6 * dpr);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);

      ctx.save();
      ctx.beginPath();
      ctx.rect(X0, Y0, X1 - X0, Y1 - Y0);
      ctx.clip();

      const pv = this.previews.get(p);
      if (pv) blit(pv.bitmap, dev(0, 0, pv.bitmap.width / pv.rs, pv.bitmap.height / pv.rs));

      // Fallback layers (other scales) underneath, then bands still rendering at the target
      // scale, then the target's tiles. See fallbackScales: sharper copies go on top.
      const scales = fallbackScales(this.cache.scalesFor(p), target);
      const drawTiles = (rs: number) => {
        const grid = tileGrid(size, rs);
        const range = this.pageRange(p, grid, rs, vis, 0);
        if (!range) return;
        for (let j = range.j0; j <= range.j1; j++) {
          for (let i = range.i0; i <= range.i1; i++) {
            const t = this.cache.peek(p, rs, i, j);
            if (!t) continue;
            blit(t.bitmap, dev((i * TILE) / rs, (j * TILE) / rs, (i * TILE + t.w) / rs, (j * TILE + t.h) / rs));
            if (rs === target) this.cache.touch(t);
          }
        }
      };
      for (const rs of scales) drawTiles(rs);
      for (const b of this.partials) {
        if (b.page !== p || b.rs !== target) continue;
        blit(b.bitmap, dev(b.x / b.rs, b.y / b.rs, (b.x + b.w) / b.rs, (b.y + b.h) / b.rs));
      }
      if (this.cache.scalesFor(p).includes(target)) drawTiles(target);
      if (this.highlights.size) this.drawHighlights(p, dev);
      if (this.painters.size) {
        // Page points -> device pixels, unrounded: the same mapping as dev(), as a transform.
        const at = (x: number, y: number): [number, number] => {
          const [X, Y] = rotatePoint(x, y, size, rot);
          return [((r.x + X) * scale + tx) * dpr, ((r.y + Y) * scale + ty) * dpr];
        };
        const o = at(0, 0), ax = at(1, 0), ay = at(0, 1);
        const m: [number, number, number, number, number, number] = [ax[0] - o[0], ax[1] - o[1], ay[0] - o[0], ay[1] - o[1], o[0], o[1]];
        for (const name of [...this.painters.keys()].sort()) {
          ctx.save();
          try {
            this.painters.get(name)!(ctx, p, m, scale * dpr);
          } catch (e) {
            console.error("painter failed:", String(e));
          }
          ctx.restore();
        }
      }
      ctx.restore();
    }

    const cp = currentPage(this.layout, vis);
    if (cp !== this.page && this.layoutMode !== "single") {
      this.page = cp;
      this.emitUi();
    }
  }

  /** Highlight layers on page p, through the page's point -> device rect mapping. */
  private drawHighlights(p: number, dev: (x0: number, y0: number, x1: number, y1: number) => [number, number, number, number]): void {
    const ctx = this.ctx;
    const min = 2 * this.dpr; // a hit on a drawing at fit is still a visible mark
    const id = this.doc?.docId;
    const layers = [...this.highlights.values()].filter((h) => h.docId === id).sort((a, b) => a.order - b.order);
    for (const h of layers) {
      const rects = h.rects.get(p);
      if (!rects?.length) continue;
      const boxes = rects.map((b) => {
        let [x0, y0, x1, y1] = dev(b[0], b[1], b[2], b[3]);
        if (x1 - x0 < min) [x0, x1] = [Math.round((x0 + x1 - min) / 2), Math.round((x0 + x1 + min) / 2)];
        if (y1 - y0 < min) [y0, y1] = [Math.round((y0 + y1 - min) / 2), Math.round((y0 + y1 + min) / 2)];
        return [x0, y0, x1, y1];
      });
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = h.fill;
      // One path for the layer: where padded rectangles overlap (lines of a selection), the
      // overlap is filled once, not multiplied twice into a darker stripe.
      ctx.beginPath();
      for (const [x0, y0, x1, y1] of boxes) ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.fill("nonzero");
      ctx.globalCompositeOperation = "source-over";
      if (h.stroke) {
        ctx.strokeStyle = h.stroke;
        ctx.lineWidth = Math.max(1, Math.round(this.dpr));
        for (const [x0, y0, x1, y1] of boxes) ctx.strokeRect(x0 - 0.5, y0 - 0.5, x1 - x0 + 1, y1 - y0 + 1);
      }
    }
  }

  // ---------------------------------------------------------------- UI

  private emitUi(): void {
    if (this.uiPending || !this.onUi) return;
    this.uiPending = true;
    queueMicrotask(() => {
      this.uiPending = false;
      this.onUi?.(this.uiState());
    });
  }

  uiState(): UiState {
    return {
      fileName: this.fileName,
      docId: this.doc?.docId ?? null,
      kind: this.doc?.kind ?? null,
      page: this.page,
      numPages: this.doc?.numPages ?? 0,
      zoom: this.zoom,
      rotation: this.rotationDeg,
      layoutMode: this.layoutMode,
      columns: this.columns,
      navMode: this.navMode,
      navAuto: this.navAuto,
      loading: this.loading,
      error: this.error,
      cursor: this.pointer ? this.pagePointAt(this.pointer.x, this.pointer.y) : null,
      pageViewport: this.viewportOnPage(this.page),
      visiblePages: this.doc ? pagesInRect(this.layout, visibleWorldRect(this.view, this.vw, this.vh)) : [],
      viewWorld: visibleWorldRect(this.view, this.vw, this.vh),
      bounds: this.layout.bounds,
    };
  }

  stats() {
    let previewBytes = 0;
    for (const p of this.previews.values()) previewBytes += p.bytes;
    const now = performance.now();
    const recent = this.frames.filter((f) => now - f.t < 1000);
    const draws = recent.map((f) => f.drawMs).sort((a, b) => a - b);
    return {
      fps: this.fps(now),
      drawMsP95: draws.length ? draws[Math.floor(draws.length * 0.95)] : 0,
      lastSettleToSharpMs: this.lastSettleToSharpMs,
      lastSettleToFirstBandMs: this.lastSettleToFirstBandMs,
      tiles: this.cache.size,
      cacheMB: this.cache.bytes / 1048576,
      cacheLimitMB: this.cache.maxBytes / 1048576,
      evictions: this.cache.evictions,
      previews: this.previews.size,
      previewMB: previewBytes / 1048576,
      queue: this.queue.length,
      rendering: this.active.size > 0,
      lastRenderMs: this.lastRenderMs,
      rendersDone: this.rendersDone,
      renderErrors: this.renderErrors,
      bandsDrawn: this.bandsDrawn,
      thumbnailsQueued: this.thumbnails.pending,
      zoom: this.zoom,
      rs: this.renderScale,
      dpr: this.dpr,
      renderer: this.renderer.name,
      lastWheel: this.lastWheel,
    };
  }
}

export type ViewerStats = ReturnType<Viewer["stats"]>;

function previewScale(w: number, h: number): number {
  return PREVIEW_MAX_SIDE / Math.max(w, h);
}

function regionRequest(
  page: number,
  rs: number,
  grid: ReturnType<typeof tileGrid>,
  reg: TileIndexRange,
  tiles: TileSpec[],
): RegionRequest {
  const x = reg.i0 * TILE;
  const y = reg.j0 * TILE;
  const w = Math.min(grid.devW, (reg.i1 + 1) * TILE) - x;
  const h = Math.min(grid.devH, (reg.j1 + 1) * TILE) - y;
  return { page, rs, x, y, w, h, tiles };
}

let cachedCanvasColour = "";
function canvasColour(): string {
  if (!cachedCanvasColour) {
    cachedCanvasColour =
      getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim() || "#2b2d31";
  }
  return cachedCanvasColour;
}

/**
 * Forget the cached canvas colour so the next frame reads `--canvas` again (call after a
 * theme change, then viewer.requestFrame()).
 */
export function refreshCanvasColour(): void {
  cachedCanvasColour = "";
}

export type { Rect, Rotation };
