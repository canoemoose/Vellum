// Drawing and editing markups on the canvas. Svelte-free: input.ts feeds it the left button and
// App.svelte the keys; it draws through a viewer page painter and keeps its state in the
// active tab's MarkupDoc. Tools stay active after drawing (agreed default); Esc returns to
// Select. See docs/editing-phase2-scope.md.

import type { Viewer } from "./viewer";
import type { MarkupDoc } from "./markupDoc";
import { paintOps } from "./markupPainter";
import { type Op, opsFor } from "../markup/ops";
import { fitText, refitText } from "../markup/kinds/text";

export { fitText, refitText };
import { type HandleId, dragHandle, handleAt, handleCursor, handles, hits, insideMarquee, moveBy, simplify, snapAngle, squareFrom } from "../markup/geometry";
import { type Markup, type MarkupKind, type Pt, type Style, type TextStyle, newId, normRect } from "../markup/types";

export type Tool = "select" | MarkupKind;

export interface Mods {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface MarkupToolOptions {
  /** The style a tool draws with (each tool remembers its last). */
  styleFor(kind: MarkupKind): Style;
  textStyle(): TextStyle;
  /** Written into each markup (agreed: the account's display name). */
  author(): string;
  /** Anything the shell shows changed: tool, selection, markups, text editing. */
  onChange(): void;
  /** Selection handles and marquee. */
  accent?: string;
}

/** CSS px: how close the pointer must be to pick a markup, and a handle. */
const PICK_PX = 5;
const HANDLE_PX = 7;
/** CSS px the pointer must move with the button down before a press becomes a drag. */
const DRAG_PX = 3;
/** A new text box clicked rather than dragged is this wide (points on paper). */
const TEXT_WIDTH = 160;

type Gesture =
  | { kind: "move"; page: number; start: Pt; before: Markup[]; ids: string[]; moved: boolean }
  | { kind: "handle"; page: number; id: string; handle: HandleId; before: Markup[] }
  | { kind: "marquee"; page: number; a: Pt; b: Pt; add: boolean }
  | { kind: "draw"; page: number; a: Pt; sx: number; sy: number; draft: Markup | null; points: Pt[] }
  | { kind: "pending"; page: number; id: string; sx: number; sy: number; start: Pt; before: Markup[] };

export class MarkupTool {
  tool: Tool = "select";
  doc: MarkupDoc | null = null;
  /** The text box being typed into, if any. */
  editing: { id: string; isNew: boolean; before: Markup[] } | null = null;
  private gesture: Gesture | null = null;
  /** A cloud being clicked out, point by point. */
  private cloud: { page: number; points: Pt[]; hover: Pt | null } | null = null;
  private clipboard: Markup[] = [];
  private opsCache = new WeakMap<Markup, Op[]>();
  private hoverCursor: string | null = null;

  constructor(
    private viewer: Viewer,
    private opts: MarkupToolOptions,
  ) {
    viewer.setPainter("m-markups", (ctx, page, m, pxPerPt) => this.paint(ctx, page, m, pxPerPt));
  }

  // ---------------------------------------------------------------- state

  /** Show another tab's markups (or none). */
  attach(doc: MarkupDoc | null): void {
    this.finishText();
    this.gesture = null;
    this.cloud = null;
    this.previewBase = null;
    this.doc = doc;
    this.redraw();
  }

  setTool(t: Tool): void {
    this.finishText();
    this.finishCloud(false);
    // With a drawing tool, the selection is only ever the shape just drawn (each new shape is
    // selected), so the properties bar restyles it as well as what's drawn next. Markups picked
    // out before switching mustn't be restyled by it.
    if (t !== "select" && t !== this.tool) this.doc?.selection.clear();
    this.tool = t;
    this.redraw();
  }

  private get markups(): Markup[] {
    return this.doc?.markups ?? [];
  }

  private redraw(): void {
    this.viewer.requestFrame();
    this.opts.onChange();
  }

  /** Record a new state of the markups as one undo step. */
  private commit(next: Markup[]): void {
    if (!this.doc) return;
    this.doc.history.push(next);
    this.pruneSelection();
    this.redraw();
  }

  private pruneSelection(): void {
    if (!this.doc) return;
    const ids = new Set(this.markups.map((m) => m.id));
    for (const id of [...this.doc.selection]) if (!ids.has(id)) this.doc.selection.delete(id);
  }

  selected(): Markup[] {
    const d = this.doc;
    return d ? this.markups.filter((m) => d.selection.has(m.id)) : [];
  }

  get hasSelection(): boolean {
    return !!this.doc?.selection.size;
  }

  select(ids: string[], add = false): void {
    if (!this.doc) return;
    if (!add) this.doc.selection.clear();
    for (const id of ids) this.doc.selection.add(id);
    this.redraw();
  }

  clearSelection(): void {
    if (this.doc?.selection.size) {
      this.doc.selection.clear();
      this.redraw();
    }
  }

  undo(): void {
    this.finishText();
    if (this.doc?.history.undo()) {
      this.pruneSelection();
      this.redraw();
    }
  }

  redo(): void {
    this.finishText();
    if (this.doc?.history.redo()) {
      this.pruneSelection();
      this.redraw();
    }
  }

  // ---------------------------------------------------------------- editing commands

  deleteSelection(): boolean {
    const d = this.doc;
    if (!d?.selection.size) return false;
    this.commit(this.markups.filter((m) => !d.selection.has(m.id)));
    return true;
  }

  /** Move the selection by (dx, dy) screen pixels, as arrow keys do. */
  nudge(dxPx: number, dyPx: number): boolean {
    const d = this.doc;
    if (!d?.selection.size) return false;
    const [dx, dy] = this.screenDeltaToPage(dxPx, dyPx);
    this.commit(this.markups.map((m) => (d.selection.has(m.id) ? touch(moveBy(m, dx, dy)) : m)));
    return true;
  }

  copy(): boolean {
    const s = this.selected();
    if (!s.length) return false;
    this.clipboard = s;
    return true;
  }

  get canPaste(): boolean {
    return this.clipboard.length > 0 && !!this.doc;
  }

  /** Paste copies of the copied markups onto the current page, nudged so they're seen. */
  paste(): boolean {
    if (!this.canPaste || !this.doc) return false;
    const page = this.viewer.currentPageIndex;
    const now = new Date().toISOString();
    const copies = this.clipboard.map((m) => ({
      ...moveBy(m, 10, 10),
      id: newId(),
      page,
      meta: { author: this.opts.author(), created: now, modified: now },
    }));
    this.commit([...this.markups, ...copies]);
    this.select(copies.map((c) => c.id));
    this.clipboard = copies;
    return true;
  }

  /** The markups as they were before a live preview (a slider being dragged), if one is showing. */
  private previewBase: Markup[] | null = null;

  private styled(from: Markup[], sel: Set<string>, patch: Partial<Style>, text?: Partial<TextStyle>): Markup[] {
    return from.map((m) => {
      if (!sel.has(m.id)) return m;
      const next = { ...m, style: { ...m.style, ...patch } } as Markup;
      if (m.kind === "text" && next.kind === "text") return touch(refitText(m, text ? { ...next, textStyle: { ...next.textStyle, ...text } } : next));
      return touch(next);
    });
  }

  /**
   * Show a style on the selected markups without an undo step (while a slider is dragged).
   * The next restyle() makes it one step from where the preview started.
   */
  preview(patch: Partial<Style>): boolean {
    const d = this.doc;
    if (!d?.selection.size) return false;
    this.previewBase ??= this.markups;
    d.history.replace(this.styled(this.previewBase, d.selection, patch));
    this.redraw();
    return true;
  }

  /** Change the style of the selected markups. */
  restyle(patch: Partial<Style>, text?: Partial<TextStyle>): boolean {
    const d = this.doc;
    if (this.previewBase && d) {
      d.history.replace(this.previewBase);
      this.previewBase = null;
    }
    if (!d?.selection.size) return false;
    this.commit(this.styled(this.markups, d.selection, patch, text));
    return true;
  }

  // ---------------------------------------------------------------- coordinates

  private tolPt(px: number): number {
    return px / this.viewer.view.scale;
  }

  private screenDeltaToPage(dx: number, dy: number): Pt {
    const a = this.viewer.pagePointAt(this.viewer.vw / 2, this.viewer.vh / 2);
    const b = this.viewer.pagePointAt(this.viewer.vw / 2 + dx, this.viewer.vh / 2 + dy);
    if (a && b && a.page === b.page) return [b.x - a.x, b.y - a.y];
    return [dx / this.viewer.view.scale, dy / this.viewer.view.scale];
  }

  /** The page point under (sx, sy), or on `page` even off its edge (drags). */
  private pointOn(sx: number, sy: number, page?: number): { page: number; p: Pt } | null {
    const pp = this.viewer.pagePointAt(sx, sy);
    if (pp && (page === undefined || pp.page === page)) return { page: pp.page, p: [pp.x, pp.y] };
    if (page === undefined) return null;
    // Off the page: project through the page's screen mapping.
    const o = this.viewer.pageToScreen(page, 0, 0);
    const ex = this.viewer.pageToScreen(page, 1, 0);
    const ey = this.viewer.pageToScreen(page, 0, 1);
    if (!o || !ex || !ey) return null;
    const a = ex[0] - o[0], b = ex[1] - o[1], c = ey[0] - o[0], d = ey[1] - o[1];
    const det = a * d - b * c;
    const vx = sx - o[0], vy = sy - o[1];
    return { page, p: [(vx * d - vy * c) / det, (vy * a - vx * b) / det] };
  }

  private topAt(page: number, p: Pt): Markup | null {
    const tol = this.tolPt(PICK_PX);
    const on = this.markups.filter((m) => m.page === page);
    for (let i = on.length - 1; i >= 0; i--) if (hits(on[i], p, tol)) return on[i];
    return null;
  }

  // ---------------------------------------------------------------- pointer

  /** Left button down. True if the markup tool takes the gesture. */
  down(sx: number, sy: number, clicks: number, mods: Mods): boolean {
    if (!this.doc) return false;
    if (this.editing) {
      this.finishText();
      if (this.tool === "text") return true; // the click ends typing; the next one draws
    }
    if (this.tool !== "select") return this.drawDown(sx, sy, clicks);
    const at = this.pointOn(sx, sy);
    if (!at) {
      if (!mods.shift) this.clearSelection();
      return false;
    }
    const { page, p } = at;
    // A handle of a selected markup first.
    for (const m of this.selected()) {
      if (m.page !== page) continue;
      const h = handleAt(m, p, this.tolPt(HANDLE_PX));
      if (h) {
        this.gesture = { kind: "handle", page, id: m.id, handle: h, before: this.markups };
        return true;
      }
    }
    const hit = this.topAt(page, p);
    if (!hit) {
      if (!mods.shift) this.clearSelection();
      return false; // the text tool, then the marquee, get it
    }
    if (clicks === 2 && hit.kind === "text") {
      this.select([hit.id]);
      this.startText(hit.id, false);
      return true;
    }
    if (mods.shift) {
      if (this.doc.selection.has(hit.id)) this.doc.selection.delete(hit.id);
      else this.doc.selection.add(hit.id);
      this.redraw();
      return true;
    }
    if (!this.doc.selection.has(hit.id)) this.select([hit.id]);
    this.gesture = { kind: "pending", page, id: hit.id, sx, sy, start: p, before: this.markups };
    return true;
  }

  /** Nothing took the press: start a marquee (Select only). */
  marqueeDown(sx: number, sy: number, mods: Mods): boolean {
    if (!this.doc || this.tool !== "select") return false;
    const at = this.pointOn(sx, sy);
    if (!at) return false;
    this.gesture = { kind: "marquee", page: at.page, a: at.p, b: at.p, add: mods.shift };
    return true;
  }

  move(sx: number, sy: number, mods: Mods): void {
    const g = this.gesture;
    if (!g) {
      this.hover(sx, sy);
      return;
    }
    const at = this.pointOn(sx, sy, g.page);
    if (!at) return;
    const p = at.p;
    switch (g.kind) {
      case "pending":
        if (Math.hypot(sx - g.sx, sy - g.sy) < DRAG_PX) return;
        this.gesture = { kind: "move", page: g.page, start: g.start, before: g.before, ids: [...this.doc!.selection], moved: true };
        return this.move(sx, sy, mods);
      case "move": {
        let dx = p[0] - g.start[0], dy = p[1] - g.start[1];
        if (mods.shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        const ids = new Set(g.ids);
        this.doc!.history.replace(g.before.map((m) => (ids.has(m.id) ? moveBy(m, dx, dy) : m)));
        break;
      }
      case "handle":
        this.doc!.history.replace(g.before.map((m) => (m.id === g.id ? dragHandle(m, g.handle, p, mods.shift) : m)));
        break;
      case "marquee":
        g.b = p;
        break;
      case "draw":
        this.drawMove(g, sx, sy, p, mods);
        break;
    }
    this.viewer.requestFrame();
  }

  up(sx: number, sy: number, mods: Mods): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g || !this.doc) return;
    switch (g.kind) {
      case "pending":
        break; // a click on a markup: it's selected
      case "move":
      case "handle": {
        const final = this.markups;
        this.doc.history.replace(g.before);
        const changed = g.kind === "move" ? new Set(g.ids) : new Set([g.id]);
        this.commit(final.map((m) => (changed.has(m.id) ? touch(fitIfText(m)) : m)));
        break;
      }
      case "marquee": {
        const r = normRect([g.a[0], g.a[1], g.b[0], g.b[1]]);
        const ids = this.markups.filter((m) => m.page === g.page && insideMarquee(m, r)).map((m) => m.id);
        this.select(ids, g.add);
        break;
      }
      case "draw":
        this.drawUp(g, sx, sy, mods);
        break;
    }
    this.redraw();
  }

  /** The cursor for the canvas, or null to leave it to others. */
  cursor(): string | null {
    if (this.tool !== "select") return "crosshair";
    const g = this.gesture;
    if (g?.kind === "move") return "move";
    if (g?.kind === "handle") return handleCursor(g.handle, this.viewer.rotation);
    return this.hoverCursor;
  }

  private hover(sx: number, sy: number): void {
    let c: string | null = null;
    if (this.tool === "select" && this.doc) {
      const at = this.pointOn(sx, sy);
      if (at) {
        let h: HandleId | null = null;
        for (const m of this.selected()) if (!h && m.page === at.page) h = handleAt(m, at.p, this.tolPt(HANDLE_PX));
        if (h) c = handleCursor(h, this.viewer.rotation);
        else if (this.topAt(at.page, at.p)) c = "move";
      }
    }
    if (this.cloud) {
      const at = this.pointOn(sx, sy, this.cloud.page);
      this.cloud.hover = at?.p ?? null;
      this.viewer.requestFrame();
    }
    this.hoverCursor = c;
  }

  /** True while a gesture is under way (keep pointer capture). */
  get active(): boolean {
    return this.gesture !== null;
  }

  // ---------------------------------------------------------------- drawing tools

  private newMarkup(kind: MarkupKind, page: number, geom: Partial<Markup>): Markup {
    const now = new Date().toISOString();
    const base = { id: newId(), page, style: this.opts.styleFor(kind), meta: { author: this.opts.author(), created: now, modified: now } };
    return { ...base, kind, ...geom } as Markup;
  }

  private drawDown(sx: number, sy: number, clicks: number): boolean {
    const at = this.pointOn(sx, sy, this.cloud?.page);
    if (!at) return false;
    if (this.tool === "cloud" && this.cloud) {
      // Clicking out a cloud: a double-click (or Enter) finishes it.
      if (clicks >= 2) this.finishCloud(true);
      else this.cloud.points.push(at.p);
      this.viewer.requestFrame();
      return true;
    }
    this.gesture = { kind: "draw", page: at.page, a: at.p, sx, sy, draft: null, points: [at.p] };
    return true;
  }

  private drawMove(g: Extract<Gesture, { kind: "draw" }>, sx: number, sy: number, p: Pt, mods: Mods): void {
    const far = Math.hypot(sx - g.sx, sy - g.sy) >= DRAG_PX;
    if (!far && !g.draft) return;
    const a = g.a;
    switch (this.tool) {
      case "rect":
      case "text": {
        const b = mods.shift ? squareFrom(a, p) : p;
        const r = normRect([a[0], a[1], b[0], b[1]]);
        g.draft = this.newMarkup(this.tool, g.page, this.tool === "text" ? { rect: r, text: "", textStyle: this.opts.textStyle() } : { rect: r });
        break;
      }
      case "arrow":
        g.draft = this.newMarkup("arrow", g.page, { from: a, to: mods.shift ? snapAngle(a, p) : p });
        break;
      case "cloud": {
        // Pressed and dragged: a rectangular cloud in one go.
        const r = normRect([a[0], a[1], p[0], p[1]]);
        g.draft = this.newMarkup("cloud", g.page, { vertices: [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], intensity: 1 });
        break;
      }
      case "ink": {
        const last = g.points[g.points.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) * this.viewer.view.scale >= 1.5) g.points.push(p);
        g.draft = this.newMarkup("ink", g.page, { strokes: [g.points.slice()] });
        break;
      }
    }
  }

  private drawUp(g: Extract<Gesture, { kind: "draw" }>, sx: number, sy: number, mods: Mods): void {
    void mods;
    const dragged = g.draft !== null;
    let m = g.draft;
    if (this.tool === "cloud" && !dragged) {
      // A click: start clicking out a cloud.
      this.cloud = { page: g.page, points: [g.a], hover: null };
      return;
    }
    if (this.tool === "text" && (!m || boxTooSmall(m, this.tolPt(8)))) {
      // A click: a default-width box at the point.
      m = this.newMarkup("text", g.page, { rect: [g.a[0], g.a[1], g.a[0] + TEXT_WIDTH, g.a[1] + 20], text: "", textStyle: this.opts.textStyle() });
    }
    if (!m) return;
    if (m.kind === "ink") m = { ...m, strokes: m.strokes.map((s) => simplify(s, this.tolPt(0.6))) };
    if ((m.kind === "rect" || m.kind === "cloud") && boxTooSmall(m, this.tolPt(4))) return;
    if (m.kind === "arrow" && Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]) < this.tolPt(4)) return;
    if (m.kind === "text") m = fitText(m);
    const before = this.markups;
    this.commit([...before, m]);
    this.select([m.id]);
    if (m.kind === "text") this.startText(m.id, true, before);
    void sx;
    void sy;
  }

  /** Finish (or with keep false, abandon) a cloud being clicked out. */
  finishCloud(keep: boolean): void {
    const c = this.cloud;
    this.cloud = null;
    if (!c) return;
    // A double-click adds its point twice: drop repeats.
    const pts = c.points.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-6);
    if (keep && pts.length >= 3) {
      const m = this.newMarkup("cloud", c.page, { vertices: pts, intensity: 1 });
      this.commit([...this.markups, m]);
      this.select([m.id]);
    }
    this.viewer.requestFrame();
  }

  get drawingCloud(): boolean {
    return this.cloud !== null;
  }

  // ---------------------------------------------------------------- text boxes

  private startText(id: string, isNew: boolean, before?: Markup[]): void {
    this.editing = { id, isNew, before: before ?? this.markups };
    this.redraw();
  }

  /** The text box being edited, if any. */
  editingMarkup(): Extract<Markup, { kind: "text" }> | null {
    const m = this.editing ? this.doc?.byId(this.editing.id) : undefined;
    return m?.kind === "text" ? m : null;
  }

  /** The editor typed: update the box (growing it to fit), without an undo step yet. */
  setText(text: string): void {
    const m = this.editingMarkup();
    if (!m || !this.doc) return;
    this.doc.history.replace(this.markups.map((x) => (x.id === m.id ? fitText({ ...m, text }) : x)));
    this.viewer.requestFrame();
  }

  /** Stop typing: one undo step for the whole edit; an empty new box disappears. */
  finishText(): void {
    const e = this.editing;
    if (!e || !this.doc) return;
    this.editing = null;
    const m = this.doc.byId(e.id);
    const final = this.markups;
    this.doc.history.replace(e.before);
    if (m?.kind === "text" && !m.text.trim()) {
      if (!e.isNew) this.commit(final.filter((x) => x.id !== e.id));
      else this.redraw();
      return;
    }
    if (final !== e.before) this.commit(final.map((x) => (x.id === e.id ? touch(x) : x)));
    else this.redraw();
  }

  // ---------------------------------------------------------------- painting

  private opsOf(m: Markup): Op[] {
    let o = this.opsCache.get(m);
    if (!o) this.opsCache.set(m, (o = opsFor(m)));
    return o;
  }

  private paint(ctx: CanvasRenderingContext2D, page: number, m: [number, number, number, number, number, number], pxPerPt: number): void {
    const d = this.doc;
    if (!d) return;
    const editing = this.editing?.id;
    for (const mk of d.markups) if (mk.page === page) paintOps(ctx, this.opsOf(mk), m, mk.id === editing);
    const g = this.gesture;
    if (g?.kind === "draw" && g.page === page && g.draft) paintOps(ctx, opsFor(g.draft), m);
    const accent = this.opts.accent ?? "#0d9488";
    const dev = (p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Clicking out a cloud: the points so far and a rubber band to the pointer.
    if (this.cloud?.page === page) {
      const pts = [...this.cloud.points, ...(this.cloud.hover ? [this.cloud.hover] : [])].map(dev);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Selection: each selected markup's handles, a fixed size on screen.
    void pxPerPt;
    const sel = d.markups.filter((x) => x.page === page && d.selection.has(x.id));
    const r = 3.5 * this.viewer.dpr;
    for (const x of sel) {
      if (x.id === editing) continue;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      for (const h of handles(x)) {
        const [hx, hy] = dev(h.at);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.round(hx - r) + 0.5, Math.round(hy - r) + 0.5, 2 * r, 2 * r);
        ctx.strokeRect(Math.round(hx - r) + 0.5, Math.round(hy - r) + 0.5, 2 * r, 2 * r);
      }
    }
    if (g?.kind === "marquee" && g.page === page) {
      const a = dev(g.a), b = dev(g.b);
      ctx.fillStyle = "rgba(13, 148, 136, 0.08)";
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
      ctx.fillRect(x0, y0, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(Math.abs(b[0] - a[0])), Math.round(Math.abs(b[1] - a[1])));
      ctx.setLineDash([]);
    }
  }
}

/** Stamp the modification time. */
function touch(m: Markup): Markup {
  return { ...m, meta: { ...m.meta, modified: new Date().toISOString() } };
}

function boxTooSmall(m: Markup, min: number): boolean {
  if (m.kind === "rect" || m.kind === "text") return m.rect[2] - m.rect[0] < min && m.rect[3] - m.rect[1] < min;
  if (m.kind === "cloud") {
    const xs = m.vertices.map((v) => v[0]), ys = m.vertices.map((v) => v[1]);
    return Math.max(...xs) - Math.min(...xs) < min || Math.max(...ys) - Math.min(...ys) < min;
  }
  return false;
}

function fitIfText(m: Markup): Markup {
  return m.kind === "text" ? fitText(m) : m;
}
