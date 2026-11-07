// The viewer engine: view state, compositor, render scheduler. No Svelte in here;
// components talk to it through methods and the onUi callback.
//
// Pipeline (see ARCHITECTURE.md):
//   view change -> draw cached tiles transformed (instant, maybe soft)
//               -> 150 ms with no input = "settle"
//               -> plan missing tiles at the exact current scale, grouped into regions
//               -> renderer renders a region, slices it into tiles -> LRU cache
//               -> compositor redraws; when every visible tile is sharp, record settle-to-sharp

import {
  type FitMode,
  type Rect,
  type View,
  approachScale,
  clampScale,
  constrainView,
  fitRect,
  scaleToZoom,
  visibleWorldRect,
  zoomAt,
  zoomToScale,
} from "../view/viewMath";
import { type Layout, type LayoutMode, computeLayout, currentPage, pagesInRect } from "../view/layout";
import {
  TILE,
  TileCache,
  type TileIndexRange,
  type TileSpec,
  groupIntoRegions,
  scaleKey,
  tileGrid,
  tileKey,
  tileSpec,
  visibleTileRange,
} from "../render/tiles";
import type { DocInfo, RegionRequest, Renderer } from "../render/types";

export type NavMode = "cad" | "document";

export interface UiState {
  fileName: string;
  page: number;
  numPages: number;
  zoom: number;
  layoutMode: LayoutMode;
  navMode: NavMode;
  loading: boolean;
  error: string | null;
}

export interface ViewerOptions {
  cacheBytes: number;
  previewBytes: number;
  settleMs: number;
  /** Largest render region side in device pixels (one renderer pass). */
  maxRegion: number;
}

const DEFAULTS: ViewerOptions = {
  cacheBytes: 512 * 1024 * 1024,
  previewBytes: 96 * 1024 * 1024,
  settleMs: 150,
  maxRegion: 4096,
};

/** Longest side of a page's low-resolution preview, in device pixels. */
const PREVIEW_MAX_SIDE = 2048;
/** Padding used by Fit page / Fit width, CSS px. */
const FIT_PAD = 16;

interface Job {
  kind: "tiles" | "preview";
  page: number;
  rs: number;
  req: RegionRequest;
  prio: number;
  dist: number;
  ac?: AbortController;
}

interface Preview {
  bitmap: ImageBitmap;
  rs: number;
  bytes: number;
}

export interface SharpEvent {
  settleToSharpMs: number;
  complete: boolean;
  regions: number;
}

export interface FrameSample {
  t: number;
  drawMs: number;
}

export class Viewer {
  readonly opts: ViewerOptions;
  readonly cache: TileCache;
  private ctx: CanvasRenderingContext2D;
  private previews = new Map<number, Preview>();
  private previewBytes = 0;

  vw = 1;
  vh = 1;
  dpr = 1;
  view: View = { scale: 1, tx: 0, ty: 0 };
  doc: DocInfo | null = null;
  layout: Layout = computeLayout([], "continuous");
  fileName = "";
  navMode: NavMode = "cad";
  layoutMode: LayoutMode = "continuous";
  private page = 0;
  private loading = false;
  private error: string | null = null;

  // Interaction and settle state
  private lastInput = 0;
  private anim: { target: number; ax: number; ay: number } | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private settleAt = 0;
  private measuring = false;
  private regionsThisSettle = 0;

  // Render queue
  private queue: Job[] = [];
  private active: Job | null = null;
  private gen = 0;

  // Frame loop
  private rafPending = false;
  private lastFrameT = 0;
  /** Called at the start of every frame while set (benchmark pan driver). */
  driver: ((t: number) => void) | null = null;

  // Stats
  frames: FrameSample[] = [];
  lastSettleToSharpMs: number | null = null;
  settleHistory: number[] = [];
  lastRenderMs = 0;
  rendersDone = 0;
  renderErrors = 0;
  lastWheel = "";
  private sharpWaiters: ((e: SharpEvent) => void)[] = [];
  onUi: ((s: UiState) => void) | null = null;
  onSharp: ((e: SharpEvent) => void) | null = null;
  private uiPending = false;

  constructor(
    private canvas: HTMLCanvasElement,
    public renderer: Renderer,
    opts: Partial<ViewerOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    this.cache = new TileCache(this.opts.cacheBytes);
    this.ctx = canvas.getContext("2d", { alpha: false })!;
  }

  // ---------------------------------------------------------------- document

  async open(path: string): Promise<void> {
    this.resetRendering();
    this.loading = true;
    this.error = null;
    this.fileName = path.split(/[\\/]/).pop() ?? path;
    this.currentPath = path;
    this.emitUi();
    try {
      this.doc = await this.renderer.open(path);
    } catch (e) {
      this.doc = null;
      this.error = String((e as Error)?.message ?? e);
      this.loading = false;
      this.emitUi();
      throw e;
    }
    this.page = 0;
    this.relayout();
    this.loading = false;
    this.fit(this.navMode === "document" ? "width" : "page", true);
    this.emitUi();
    // Nothing to wait for on open: render straight away rather than after the settle delay.
    this.settleNow();
  }

  private settleNow(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.lastInput = 0;
    this.onSettle();
  }

  async setRenderer(r: Renderer): Promise<void> {
    const path = this.currentPath;
    await this.renderer.close();
    this.renderer = r;
    if (path) await this.open(path);
  }

  currentPath = "";

  private resetRendering(): void {
    this.gen++;
    this.active?.ac?.abort();
    this.active = null;
    this.queue = [];
    this.cache.clear();
    for (const p of this.previews.values()) p.bitmap.close();
    this.previews.clear();
    this.previewBytes = 0;
    this.measuring = false;
  }

  /** Drop all cached tiles but keep previews (benchmark: forces a cold render at a scale). */
  dropTiles(): void {
    this.active?.ac?.abort();
    this.active = null;
    this.queue = [];
    this.cache.clear();
    this.requestFrame();
  }

  private relayout(): void {
    this.layout = computeLayout(this.doc?.sizes ?? [], this.layoutMode, this.page);
  }

  // ---------------------------------------------------------------- viewport

  resize(cssW: number, cssH: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    const dprChanged = dpr !== this.dpr;
    this.vw = cssW;
    this.vh = cssH;
    this.dpr = dpr;
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
    this.inputActivity(rsChanged || kind === "jump");
    this.requestFrame();
    this.emitUi();
  }

  panBy(dx: number, dy: number): void {
    if (this.anim) {
      // Keep the zoom anchor glued to the content while panning mid-animation.
      this.anim.ax += dx;
      this.anim.ay += dy;
    }
    this.setView({ scale: this.view.scale, tx: this.view.tx + dx, ty: this.view.ty + dy }, "pan");
  }

  /** Zoom by `factor` keeping screen point (sx, sy) fixed. Animated zooms ease over ~100 ms. */
  zoomAt(sx: number, sy: number, factor: number, animate: boolean): void {
    if (animate) {
      const base = this.anim ? this.anim.target : this.view.scale;
      this.anim = { target: clampScale(base * factor), ax: sx, ay: sy };
      this.inputActivity(true);
      this.requestFrame();
    } else {
      this.anim = null;
      this.setView(zoomAt(this.view, sx, sy, this.view.scale * factor), "zoom");
    }
  }

  zoomStep(dir: 1 | -1): void {
    this.zoomAt(this.vw / 2, this.vh / 2, dir > 0 ? 1.25 : 1 / 1.25, true);
  }

  setZoom(zoom: number, sx = this.vw / 2, sy = this.vh / 2): void {
    this.anim = null;
    this.setView(zoomAt(this.view, sx, sy, zoomToScale(zoom)), "zoom");
  }

  fit(mode: FitMode, jump = false): void {
    const r = this.layout.rects[this.page];
    if (!r) return;
    this.anim = null;
    this.setView(fitRect(r, this.vw, this.vh, FIT_PAD, mode), jump ? "jump" : "zoom");
  }

  actualSize(): void {
    this.setZoom(1);
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
    this.anim = null;
    this.setView({ scale: s, tx, ty }, "jump");
  }

  nextPage(): void { this.gotoPage(this.page + 1); }
  prevPage(): void { this.gotoPage(this.page - 1); }
  firstPage(): void { this.gotoPage(0); }
  lastPage(): void { this.gotoPage((this.doc?.numPages ?? 1) - 1); }

  setLayoutMode(m: LayoutMode): void {
    if (m === this.layoutMode) return;
    this.layoutMode = m;
    this.relayout();
    this.gotoPage(this.page);
  }

  setNavMode(m: NavMode): void {
    this.navMode = m;
    this.emitUi();
  }

  get zoom(): number {
    return scaleToZoom(this.view.scale);
  }

  get currentPageIndex(): number {
    return this.page;
  }

  get interacting(): boolean {
    return this.anim !== null || performance.now() - this.lastInput < this.opts.settleMs;
  }

  // ---------------------------------------------------------------- settle / schedule

  /** Any input: postpone rendering until things settle; optionally drop pending work. */
  private inputActivity(scaleChanged: boolean): void {
    this.lastInput = performance.now();
    this.measuring = false;
    // Queued jobs were planned for the old view; re-plan at settle.
    this.queue = [];
    if (scaleChanged && this.active && this.active.rs !== scaleKey(this.view.scale * this.dpr)) {
      this.active.ac?.abort();
    }
    this.scheduleSettle();
  }

  private scheduleSettle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    if (this.anim) return; // restarted when the animation lands
    this.settleTimer = setTimeout(() => this.onSettle(), this.opts.settleMs);
  }

  private onSettle(): void {
    this.settleTimer = null;
    if (!this.doc || this.anim) return;
    this.settleAt = performance.now();
    this.measuring = true;
    this.regionsThisSettle = 0;
    this.plan();
    if (this.queue.length === 0 && !this.active) this.finishMeasure();
    else this.pump();
  }

  /** Work out which tiles are missing at the current scale and queue region renders. */
  private plan(): void {
    if (!this.doc) return;
    const rs = scaleKey(this.view.scale * this.dpr);
    const vis = visibleWorldRect(this.view, this.vw, this.vh);
    const cx = this.vw / 2;
    const cy = this.vh / 2;
    const jobs: Job[] = [];
    const maxSide = Math.max(1, Math.floor(this.opts.maxRegion / TILE));

    for (const p of pagesInRect(this.layout, vis)) {
      const rect = this.layout.rects[p]!;
      const size = this.doc.sizes[p];
      const grid = tileGrid(size, rs);
      const core = visibleTileRange(rect, grid, this.view, this.vw, this.vh, rs, 0);
      if (!core) continue;
      const ring = visibleTileRange(rect, grid, this.view, this.vw, this.vh, rs, 1)!;
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
        for (const reg of groupIntoRegions(missing, maxSide)) {
          const set = new Set(missing.map((t) => t.i * 100003 + t.j));
          const tiles: TileSpec[] = [];
          for (let j = reg.j0; j <= reg.j1; j++)
            for (let i = reg.i0; i <= reg.i1; i++)
              if (set.has(i * 100003 + j)) tiles.push(tileSpec(grid, i, j));
          const req = regionRequest(p, rs, grid, reg, tiles);
          const sx = (rect.x + (req.x + req.w / 2) / rs) * this.view.scale + this.view.tx;
          const sy = (rect.y + (req.y + req.h / 2) / rs) * this.view.scale + this.view.ty;
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

  private pump(): void {
    if (this.active || this.interacting) return;
    const job = this.queue.shift();
    if (!job) return;
    // A preview may have been composed from tiles since this job was planned.
    if (job.kind === "preview" && this.previews.has(job.page)) return this.pump();
    const gen = this.gen;
    job.ac = new AbortController();
    this.active = job;
    const t0 = performance.now();
    this.renderer
      .renderRegion(job.req, job.ac.signal)
      .then((bitmaps) => {
        if (!bitmaps || gen !== this.gen) {
          bitmaps?.forEach((b) => b.close());
          return;
        }
        this.lastRenderMs = performance.now() - t0;
        this.rendersDone++;
        if (job.kind === "preview") {
          this.putPreview(job.page, bitmaps[0], job.rs);
        } else {
          this.regionsThisSettle++;
          job.req.tiles.forEach((t, k) => {
            const b = bitmaps[k];
            this.cache.put({
              key: tileKey(job.page, job.rs, t.i, t.j),
              page: job.page, rs: job.rs, i: t.i, j: t.j, w: t.w, h: t.h,
              bitmap: b, bytes: t.w * t.h * 4,
            });
          });
          this.maybeComposePreview(job.page, job.rs);
        }
        this.requestFrame();
      })
      .catch((e) => {
        this.renderErrors++;
        console.error("render failed", e);
      })
      .finally(() => {
        if (this.active === job) this.active = null;
        if (this.measuring && !this.queue.some((j) => j.prio === 0)) this.finishMeasure();
        this.pump();
      });
  }

  /** Called once all core (visible) tiles for this settle have been rendered. */
  private finishMeasure(): void {
    if (!this.measuring) return;
    this.measuring = false;
    const ms = performance.now() - this.settleAt;
    const complete = this.visibleComplete();
    this.lastSettleToSharpMs = ms;
    this.settleHistory.push(ms);
    if (this.settleHistory.length > 50) this.settleHistory.shift();
    const ev: SharpEvent = { settleToSharpMs: ms, complete, regions: this.regionsThisSettle };
    this.onSharp?.(ev);
    const w = this.sharpWaiters;
    this.sharpWaiters = [];
    w.forEach((f) => f(ev));
  }

  /** True when every tile covering the viewport exists at the current scale. */
  visibleComplete(): boolean {
    if (!this.doc) return true;
    const rs = scaleKey(this.view.scale * this.dpr);
    const vis = visibleWorldRect(this.view, this.vw, this.vh);
    for (const p of pagesInRect(this.layout, vis)) {
      const grid = tileGrid(this.doc.sizes[p], rs);
      const r = visibleTileRange(this.layout.rects[p]!, grid, this.view, this.vw, this.vh, rs, 0);
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

  /** Resolves once settled with nothing rendering or queued (previews included). */
  async whenIdle(timeoutMs = 120000): Promise<boolean> {
    const t0 = performance.now();
    for (;;) {
      if (!this.interacting && !this.settleTimer && !this.active && this.queue.length === 0) return true;
      if (performance.now() - t0 > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get rendering(): boolean {
    return this.active !== null;
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
    if (this.anim) {
      const s = approachScale(this.view.scale, this.anim.target, dt);
      this.view = constrainView(
        zoomAt(this.view, this.anim.ax, this.anim.ay, s),
        this.layout.bounds, this.vw, this.vh,
      );
      if (s === this.anim.target) {
        this.anim = null;
        this.inputActivity(true);
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
    // Kick the queue if a render was waiting for interaction to end.
    if (!this.active && this.queue.length && !this.interacting) this.pump();
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = canvasColour();
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.doc) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    const target = scaleKey(scale * dpr);
    const vis = visibleWorldRect(this.view, this.vw, this.vh);
    const pages = pagesInRect(this.layout, vis);

    for (const p of pages) {
      const r = this.layout.rects[p]!;
      const size = this.doc.sizes[p];
      // Page rect in device pixels; edges snapped to whole pixels.
      const fx0 = (r.x * scale + tx) * dpr;
      const fy0 = (r.y * scale + ty) * dpr;
      const X0 = Math.round(fx0);
      const Y0 = Math.round(fy0);
      const X1 = Math.round(((r.x + r.w) * scale + tx) * dpr);
      const Y1 = Math.round(((r.y + r.h) * scale + ty) * dpr);

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
      if (pv) {
        const k = (scale * dpr) / pv.rs;
        ctx.drawImage(pv.bitmap, fx0, fy0, pv.bitmap.width * k, pv.bitmap.height * k);
      }

      // Fallback layers (other scales) underneath, nearest-to-target last; then target.
      const scales = this.cache
        .scalesFor(p)
        .filter((s) => s !== target)
        .sort((a, b) => Math.abs(Math.log(b / target)) - Math.abs(Math.log(a / target)))
        .slice(-2);
      if (this.cache.scalesFor(p).includes(target)) scales.push(target);

      for (const rs of scales) {
        const grid = tileGrid(size, rs);
        const range = visibleTileRange(r, grid, this.view, this.vw, this.vh, rs, 0);
        if (!range) continue;
        const k = (scale * dpr) / rs;
        for (let j = range.j0; j <= range.j1; j++) {
          const y0 = Math.round(fy0 + j * TILE * k);
          for (let i = range.i0; i <= range.i1; i++) {
            const t = this.cache.peek(p, rs, i, j);
            if (!t) continue;
            const x0 = Math.round(fx0 + i * TILE * k);
            const x1 = Math.round(fx0 + (i * TILE + t.w) * k);
            const y1 = Math.round(fy0 + (j * TILE + t.h) * k);
            ctx.drawImage(t.bitmap, x0, y0, x1 - x0, y1 - y0);
            if (rs === target) this.cache.touch(t);
          }
        }
      }
      ctx.restore();
    }

    const cp = currentPage(this.layout, vis);
    if (cp !== this.page && this.layoutMode === "continuous") {
      this.page = cp;
      this.emitUi();
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
      page: this.page,
      numPages: this.doc?.numPages ?? 0,
      zoom: this.zoom,
      layoutMode: this.layoutMode,
      navMode: this.navMode,
      loading: this.loading,
      error: this.error,
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
      tiles: this.cache.size,
      cacheMB: this.cache.bytes / 1048576,
      cacheLimitMB: this.cache.maxBytes / 1048576,
      evictions: this.cache.evictions,
      previews: this.previews.size,
      previewMB: previewBytes / 1048576,
      queue: this.queue.length,
      rendering: this.active !== null,
      lastRenderMs: this.lastRenderMs,
      rendersDone: this.rendersDone,
      renderErrors: this.renderErrors,
      zoom: this.zoom,
      rs: scaleKey(this.view.scale * this.dpr),
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

export type { Rect };
