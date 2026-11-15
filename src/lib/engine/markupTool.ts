// Drawing and editing markups on the canvas. Svelte-free: input.ts feeds it the left button and
// App.svelte the keys; it draws through a viewer page painter and keeps its state in the
// active tab's MarkupDoc. Tools stay active after drawing (agreed default); Esc returns to
// Select. See docs/editing-phase2-scope.md.

import type { Viewer } from "./viewer";
import type { MarkupDoc } from "./markupDoc";
import { paintOps } from "./markupPainter";
import { type Op, opsFor } from "../markup/ops";
import { fitText } from "../markup/textbox";
import { type HandleId, dragHandle, handleAt, handleCursor, handles, hits, insideMarquee, moveBy, orthoFrom, rectPts, shapeBounds, simplify, snapAngle, squareFrom, turnOf } from "../markup/geometry";
import { type Markup, type MarkupKind, type Pt, type Rect, type Style, type TextStyle, newId, normRect } from "../markup/types";
import { type Draw, type DrawContext, type KindDef, type Shape, MIN_BOX_PX } from "../markup/kinds/kind";
import { defOf, kindOf } from "../markup/kinds";
import { toolById, withPreset } from "../markup/tools";
import { centredOn, fromClip, newSession, toClip } from "../markup/clip";
import { topMiddle } from "../markup/turn"; // Stage 8

export { fitText, refitText } from "../markup/textbox";

/** "select", or a drawing tool's id (markup/tools.ts). */
export type Tool = string;

/** A markup that holds typed text in a box (a text box; later, a callout). */
export type TypedMarkup = Extract<Markup, { rect: Rect; text: string; textStyle: TextStyle }>;

export interface Mods {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface MarkupToolOptions {
  /** The style a tool draws with (each tool remembers its last). */
  styleFor(kind: MarkupKind, tool: Tool): Style;
  /** The text style a typing tool draws with (each remembers its own). */
  textStyle(tool: Tool): TextStyle;
  /** Written into each markup (agreed: the account's display name). */
  author(): string;
  /** Anything the shell shows changed: tool, selection, markups, text editing. */
  onChange(): void;
  /** Selection handles and marquee. */
  accent?: string;
  /**
   * Phase 7b: these markups are about to change under a drag (or a slider): any that PDFium
   * still draws from the file should be hidden there now, so it isn't drawn twice.
   */
  onLift?(ids: string[]): void;
  /**
   * Stage 9: the system clipboard (src-tauri/src/clipboard.rs). Without it (tests), copies are
   * held in memory for this tool alone.
   */
  clipboard?: {
    write(json: string): Promise<void>;
    read(): Promise<ClipRead>;
  };
  /** A picture was pasted: make it an Image markup on `page`, centred on `at` (stage 8). */
  onPicture?(pic: { png: string; w: number; h: number }, page: number, at: Pt): void;
  /** Something to tell the user (a signature that couldn't be pasted here). */
  notify?(msg: string): void;
}

/** What the system clipboard held, as far as pasting goes. */
export type ClipRead = { kind: "markups"; json: string } | { kind: "picture"; png: string; w: number; h: number } | { kind: "none" };

/** CSS px: how close the pointer must be to pick a markup, and a handle. */
const PICK_PX = 5;
const HANDLE_PX = 7;
/** CSS px the pointer must move with the button down before a press becomes a drag. */
const DRAG_PX = 3;

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
  /**
   * Typing going on in an editor of the shell's own (a note's), with how to end it. A press on
   * the drawing ends it and does nothing else (rule 3), as it does for a text box.
   */
  typingElsewhere: (() => void) | null = null;
  private gesture: Gesture | null = null;
  /** A shape being clicked out, point by point (the "points" gesture). */
  private clicking: { def: KindDef; page: number; points: Pt[]; hover: Pt | null } | null = null;
  /** Where a "place" tool's preview follows the pointer. */
  private placeAt: { page: number; p: Pt } | null = null;
  // Stage 9: copy, cut and paste through the system clipboard.
  /** This run of the app: a copied signature can be pasted only where this matches (markup/clip.ts). */
  private readonly session = newSession();
  /** The last copy's signatures, held here by reference: their content never goes on the clipboard. */
  private held = new Map<string, Markup>();
  /** With no system clipboard (tests): the last copy's JSON. */
  private memClip: string | null = null;
  /** Where the pointer is on a page, for pasting there (null off the pages). */
  private pointer: { page: number; p: Pt } | null = null;
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
    this.clicking = null;
    this.placeAt = null;
    this.previewBase = null;
    this.doc = doc;
    this.redraw();
  }

  setTool(t: Tool): void {
    this.finishText();
    this.finishPoints(false);
    this.placeAt = null;
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
    const d = this.doc;
    if (!d) return;
    if (!add) d.selection.clear();
    // Phase 7b: what came with the file can't be picked while the document is locked.
    for (const id of ids) {
      const m = d.byId(id);
      if (!m || d.editable(m)) d.selection.add(id);
    }
    this.redraw();
  }

  clearSelection(): void {
    if (this.doc?.selection.size) {
      this.doc.selection.clear();
      this.redraw();
    }
  }

  // Text markups: markups made outside a gesture (text markups from a selection, a note's text).

  /** Add markups as one undo step and select them. */
  addMarkups(ms: Markup[]): void {
    if (!this.doc || !ms.length) return;
    this.commit([...this.markups, ...ms]);
    this.select(ms.map((m) => m.id));
  }

  /** Change one markup (by id) as one undo step, stamping its modification time. */
  updateMarkup(next: Markup): void {
    const was = this.doc?.byId(next.id);
    if (!was || !this.doc!.editable(was)) return;
    this.commit(this.markups.map((m) => (m.id === next.id ? touch(next) : m)));
  }

  /** Remove one markup (by id) as one undo step. */
  removeMarkup(id: string): void {
    const was = this.doc?.byId(id);
    if (!was || !this.doc!.editable(was)) return;
    this.commit(this.markups.filter((m) => m.id !== id));
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
    // Text markups don't move: a selection of only those takes no undo step.
    const moving = (m: Markup) => d.selection.has(m.id) && !defOf(m).ofText;
    if (!this.markups.some(moving)) return false;
    const [dx, dy] = this.screenDeltaToPage(dxPx, dyPx);
    this.commit(this.markups.map((m) => (moving(m) ? touch(moveBy(m, dx, dy)) : m)));
    return true;
  }

  /**
   * Copy the selection to the system clipboard, in Vellum's own format. Text markups belong to
   * the text they mark, and some annotations from the file can't be redrawn: neither is copied
   * (pasted elsewhere they'd land on nothing). A signature goes as a reference only.
   */
  copy(): boolean {
    const s = this.selected().filter((m) => !defOf(m).ofText && !defOf(m).fixed);
    if (!s.length) return false;
    const { json, held } = toClip(s, this.session);
    this.held = held;
    if (this.opts.clipboard) {
      this.memClip = null;
      this.opts.clipboard.write(json).catch((e) => {
        console.warn("copy: clipboard write failed:", String(e));
        this.opts.notify?.("Couldn't copy the markups to the clipboard");
      });
    } else this.memClip = json;
    return true;
  }

  /** Copy the selection, then delete it: one undo step. */
  cut(): boolean {
    if (!this.copy()) return false;
    const d = this.doc!;
    const gone = new Set(this.selected().filter((m) => !defOf(m).ofText && !defOf(m).fixed).map((m) => m.id));
    this.commit(this.markups.filter((m) => !gone.has(m.id)));
    d.selection.clear();
    this.redraw();
    return true;
  }

  /** Whether Paste can be offered: with the system clipboard, always (it's read when pasting). */
  get canPaste(): boolean {
    return !!this.doc && (!!this.opts.clipboard || this.memClip !== null);
  }

  /** Select every markup on a page that can be selected (Ctrl+A with markups in hand). */
  selectAllOnPage(page: number): boolean {
    const d = this.doc;
    if (!d) return false;
    const ids = this.markups.filter((m) => m.page === page && d.editable(m)).map((m) => m.id);
    this.select(ids);
    return ids.length > 0;
  }

  /** The pointer left the drawing: paste goes to the middle of the view. */
  leave(): void {
    this.pointer = null;
  }

  /** Where a paste lands: the pointer, if it's on a page and `where` allows; else the middle of the view. */
  private pasteTarget(where: "pointer" | "centre"): { page: number; p: Pt } | null {
    if (where === "pointer" && this.pointer) return this.pointer;
    const at = this.pointOn(this.viewer.vw / 2, this.viewer.vh / 2) ?? this.pointOn(this.viewer.vw / 2, this.viewer.vh / 2, this.viewer.currentPageIndex);
    return at;
  }

  /**
   * Paste whatever is on the clipboard: Vellum's markups (the middle of them on the pointer,
   * or, from the menu or with the pointer off the page, the middle of the view), or a picture
   * as an Image markup. True if anything was pasted.
   */
  async paste(where: "pointer" | "centre" = "pointer"): Promise<boolean> {
    if (!this.doc) return false;
    const target = this.pasteTarget(where);
    const clip: ClipRead = this.opts.clipboard ? await this.opts.clipboard.read() : this.memClip ? { kind: "markups", json: this.memClip } : { kind: "none" };
    if (!this.doc || !target) return false;
    if (clip.kind === "picture") {
      if (!this.opts.onPicture) return false;
      this.opts.onPicture(clip, target.page, target.p);
      return true;
    }
    if (clip.kind !== "markups") return false;
    const r = fromClip(clip.json, this.session, this.held);
    if (!r) return false;
    if (r.skipped) this.opts.notify?.(r.skipped === 1 ? "A signature can only be pasted in the window it was copied from" : `${r.skipped} signatures or markups couldn't be pasted here`);
    if (!r.markups.length) return false;
    const now = new Date().toISOString();
    const copies = centredOn(r.markups, target.p).map((m) => ({
      ...m,
      id: newId(),
      page: target.page,
      meta: { author: this.opts.author(), created: now, modified: now },
    })) as Markup[];
    this.commit([...this.markups, ...copies]);
    this.select(copies.map((c) => c.id));
    return true;
  }

  /** The markups as they were before a live preview (a slider being dragged), if one is showing. */
  private previewBase: Markup[] | null = null;

  private styled(from: Markup[], sel: Set<string>, patch: Partial<Style>, text?: Partial<TextStyle>): Markup[] {
    return from.map((m) => {
      // An annotation Vellum can't redraw keeps its own look (kind.ts, fixed).
      if (!sel.has(m.id) || defOf(m).fixed) return m;
      let next = { ...m, style: { ...m.style, ...patch } } as Markup;
      if (text && "textStyle" in next) next = { ...next, textStyle: { ...next.textStyle, ...text } };
      const def = defOf(m);
      return touch(def.restyled ? def.restyled(m, next) : next);
    });
  }

  /**
   * Show a style on the selected markups without an undo step (while a slider is dragged).
   * The next restyle() makes it one step from where the preview started.
   */
  preview(patch: Partial<Style>): boolean {
    const d = this.doc;
    if (!d?.selection.size) return false;
    if (!this.previewBase) this.opts.onLift?.([...d.selection]);
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
    // Phase 7b: what came with the file is out of reach while the document is locked.
    const d = this.doc;
    const on = this.markups.filter((m) => m.page === page && (!d || d.editable(m)));
    for (let i = on.length - 1; i >= 0; i--) if (hits(on[i], p, tol)) return on[i];
    return null;
  }

  // ---------------------------------------------------------------- pointer

  /** Left button down. True if the markup tool takes the gesture. */
  down(sx: number, sy: number, clicks: number, mods: Mods): boolean {
    if (!this.doc) return false;
    // Rule 3: a click away from text being typed ends the typing and does nothing else.
    if (this.editing) {
      this.finishText();
      return true;
    }
    if (this.typingElsewhere) {
      const end = this.typingElsewhere;
      this.typingElsewhere = null;
      end();
      return true;
    }
    if (this.tool !== "select") return this.drawDown(sx, sy, clicks, mods);
    const at = this.pointOn(sx, sy);
    if (!at) {
      if (!mods.shift) this.clearSelection();
      return false;
    }
    const { page, p } = at;
    // A handle of a selected markup first.
    for (const m of this.selected()) {
      if (m.page !== page) continue;
      const h = handleAt(m, p, this.tolPt(HANDLE_PX), this.tolPt(1));
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
    // Text markups: a press on a text markup selects it and goes on to text selection, so the
    // text under a highlight can still be selected and copied.
    if (defOf(hit).ofText) {
      if (mods.shift && this.doc.selection.has(hit.id)) this.doc.selection.delete(hit.id);
      else this.select([hit.id], mods.shift);
      this.redraw();
      return false;
    }
    if (clicks === 2 && defOf(hit).typed) {
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
    // Stage 9: where a paste would land.
    const on = this.pointOn(sx, sy);
    this.pointer = on;
    const g = this.gesture;
    if (!g) {
      this.hover(sx, sy, mods);
      return;
    }
    const at = this.pointOn(sx, sy, g.page);
    if (!at) return;
    const p = at.p;
    switch (g.kind) {
      case "pending":
        if (Math.hypot(sx - g.sx, sy - g.sy) < DRAG_PX) return;
        this.gesture = { kind: "move", page: g.page, start: g.start, before: g.before, ids: [...this.doc!.selection], moved: true };
        this.opts.onLift?.([...this.doc!.selection]);
        return this.move(sx, sy, mods);
      case "move": {
        let dx = p[0] - g.start[0], dy = p[1] - g.start[1];
        if (mods.shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        const ids = new Set(g.ids);
        this.doc!.history.replace(g.before.map((m) => (ids.has(m.id) ? moveBy(m, dx, dy) : m)));
        break;
      }
      case "handle":
        if (this.markups === g.before) this.opts.onLift?.([g.id]);
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

  up(_sx: number, _sy: number, _mods: Mods): void {
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
        this.commit(final.map((m) => (changed.has(m.id) ? touch(settle(m)) : m)));
        break;
      }
      case "marquee": {
        const r = normRect([g.a[0], g.a[1], g.b[0], g.b[1]]);
        const d = this.doc;
        const ids = this.markups.filter((m) => m.page === g.page && d.editable(m) && insideMarquee(m, r)).map((m) => m.id);
        this.select(ids, g.add);
        break;
      }
      case "draw":
        this.drawUp(g);
        break;
    }
    this.redraw();
  }

  /** The cursor for the canvas, or null to leave it to others. */
  cursor(): string | null {
    if (this.tool !== "select") return "crosshair";
    const g = this.gesture;
    if (g?.kind === "move") return "move";
    if (g?.kind === "handle") {
      const m = this.doc?.byId(g.id);
      return handleCursor(g.handle, this.viewer.rotation, m ? turnOf(m) : 0);
    }
    return this.hoverCursor;
  }

  private hover(sx: number, sy: number, mods: Mods): void {
    let c: string | null = null;
    if (this.tool === "select" && this.doc) {
      const at = this.pointOn(sx, sy);
      if (at) {
        let h: HandleId | null = null;
        let turn = 0;
        for (const m of this.selected())
          if (!h && m.page === at.page && (h = handleAt(m, at.p, this.tolPt(HANDLE_PX), this.tolPt(1)))) turn = turnOf(m);
        if (h) c = handleCursor(h, this.viewer.rotation, turn);
        else {
          // Text markups don't move: over one, the text tool's cursor shows.
          const top = this.topAt(at.page, at.p);
          if (top && !defOf(top).ofText) c = "move";
        }
      }
    }
    const c0 = this.clicking;
    if (c0) {
      const at = this.pointOn(sx, sy, c0.page);
      const last = c0.points[c0.points.length - 1];
      c0.hover = at ? lockTo(c0.def.draw, last, at.p, mods.shift) : null;
      this.viewer.requestFrame();
    } else if (this.def?.draw.gesture === "place") {
      const at = this.pointOn(sx, sy);
      this.placeAt = at ? { page: at.page, p: at.p } : null;
      this.viewer.requestFrame();
    }
    this.hoverCursor = c;
  }

  /** True while a gesture is under way (keep pointer capture). */
  get active(): boolean {
    return this.gesture !== null;
  }

  // ---------------------------------------------------------------- drawing tools
  //
  // Each gesture is written once here; a kind says which gesture draws it and turns the
  // gesture's result into its geometry (kinds/kind.ts, Draw).

  /** The kind the current tool draws, or null for Select. */
  private get def(): KindDef | null {
    const kind = toolById(this.tool)?.kind;
    return kind ? (kindOf(kind) as unknown as KindDef) : null;
  }

  private get drawContext(): DrawContext {
    return { textStyle: this.opts.textStyle(this.tool), viewRotation: this.viewer.rotation };
  }

  private newMarkup(def: KindDef, page: number, shape: Shape<Markup>): Markup {
    const now = new Date().toISOString();
    // The tool's remembered style, with its preset (a Line has no ends) over it.
    const tool = toolById(this.tool);
    const style = tool?.kind === def.kind ? withPreset(tool, this.opts.styleFor(def.kind, tool.id)) : this.opts.styleFor(def.kind, def.kind);
    const base = { id: newId(), page, style, meta: { author: this.opts.author(), created: now, modified: now } };
    return { ...base, kind: def.kind, ...shape } as Markup;
  }

  private drawDown(sx: number, sy: number, clicks: number, mods: Mods): boolean {
    const def = this.clicking?.def ?? this.def;
    if (!def) return false;
    const at = this.pointOn(sx, sy, this.clicking?.page);
    if (!at) return false;
    const c = this.clicking;
    if (c && def.draw.gesture === "points") {
      // Clicking out a shape: a double-click (or Enter) finishes it; so does a click on the
      // first point of a closed one.
      const last = c.points[c.points.length - 1];
      const p = lockTo(def.draw, last, at.p, mods.shift);
      const first = c.points[0];
      const onFirst = def.draw.closed && c.points.length >= def.draw.min && Math.hypot(p[0] - first[0], p[1] - first[1]) <= this.tolPt(HANDLE_PX);
      if (clicks >= 2 || onFirst) this.finishPoints(true);
      else {
        c.points.push(p);
        if (def.draw.max && c.points.length >= def.draw.max) this.finishPoints(true);
      }
      this.viewer.requestFrame();
      return true;
    }
    this.placeAt = null;
    this.gesture = { kind: "draw", page: at.page, a: at.p, sx, sy, draft: null, points: [at.p] };
    return true;
  }

  private drawMove(g: Extract<Gesture, { kind: "draw" }>, sx: number, sy: number, p: Pt, mods: Mods): void {
    const def = this.def;
    if (!def) return;
    const far = Math.hypot(sx - g.sx, sy - g.sy) >= DRAG_PX;
    if (!far && !g.draft) return;
    const a = g.a;
    const d = def.draw;
    const make = (shape: Shape<Markup>) => (g.draft = this.newMarkup(def, g.page, shape));
    const box = (): Rect => {
      const b = mods.shift ? squareFrom(a, p) : p;
      return normRect([a[0], a[1], b[0], b[1]]);
    };
    switch (d.gesture) {
      case "box":
        make(d.make(box(), this.drawContext));
        break;
      case "points":
        // Pressed and dragged: a rectangle of points (Shift squares it, as for any box), or a
        // straight line, in one go.
        if (d.drag === "box") make(d.make(rectPts(box()), this.drawContext));
        else make(d.make([a, lockTo(d, a, p, mods.shift)], this.drawContext));
        break;
      case "freehand": {
        // Text markups: Shift draws a straight stroke from the press (the highlighter's rule,
        // and the pen's too, since the gesture is shared).
        if (mods.shift) g.points = [a, p];
        const last = g.points[g.points.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) * this.viewer.view.scale >= 1.5) g.points.push(p);
        make(d.make([g.points.slice()]));
        break;
      }
      case "place": {
        const s = d.box?.(box(), this.drawContext);
        if (s) make(s);
        break;
      }
    }
  }

  private drawUp(g: Extract<Gesture, { kind: "draw" }>): void {
    const def = this.def;
    if (!def) return;
    const d = def.draw;
    let m = g.draft;
    const size = (x: Markup): [number, number] => {
      const b = def.bounds(x);
      return [b[2] - b[0], b[3] - b[1]];
    };
    /** Under `px` screen pixels both ways (or with `either`, either way). */
    const small = (x: Markup, px: number, either = false) => {
      const [w, h] = size(x);
      const min = this.tolPt(px);
      return either ? w < min || h < min : w < min && h < min;
    };
    // Rule 1: one minimum for every dragged box, and for a dragged line its length.
    const tooSmall = (x: Markup | null, box: boolean) => !x || (box ? small(x, MIN_BOX_PX, true) : Math.hypot(...size(x)) < this.tolPt(MIN_BOX_PX));
    switch (d.gesture) {
      case "box":
        if (tooSmall(m, true)) {
          // A click (or a drag too small to be a box): one at the point, if the kind has one.
          if (!d.click) return;
          m = this.newMarkup(def, g.page, d.click(g.a, this.drawContext));
        }
        break;
      case "points":
        if (tooSmall(m, d.drag === "box")) {
          // A click (or a drag too small to count): start clicking out the shape.
          this.clicking = { def, page: g.page, points: [g.a], hover: null };
          return;
        }
        break;
      case "freehand":
        if (!m) return;
        m = this.newMarkup(def, g.page, d.make([simplify(g.points, this.tolPt(0.6))]));
        break;
      case "place":
        if (tooSmall(m, true)) {
          // Stage 8: nothing chosen to place yet (a signature still loading), nothing placed.
          const s = d.make(g.a, this.drawContext);
          m = s ? this.newMarkup(def, g.page, s) : null;
        }
        break;
    }
    if (!m) return;
    if (def.finish) m = def.finish(m);
    if (this.keep && !this.keep(m)) return this.redraw(); // Measuring
    const before = this.markups;
    this.commit([...before, m]);
    this.select([m.id]);
    if (def.typed) this.startText(m.id, true, before);
  }

  /** Finish (or with keep false, abandon) a shape being clicked out. */
  finishPoints(keep: boolean): void {
    const c = this.clicking;
    this.clicking = null;
    if (!c || c.def.draw.gesture !== "points") return;
    // A double-click adds its point twice: drop repeats.
    const pts = c.points.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-6);
    if (keep && pts.length >= c.def.draw.min) {
      let m = this.newMarkup(c.def, c.page, c.def.draw.make(pts, this.drawContext));
      if (c.def.finish) m = c.def.finish(m);
      if (this.keep && !this.keep(m)) return this.redraw(); // Measuring
      const before = this.markups;
      this.commit([...before, m]);
      this.select([m.id]);
      // Text markups: a callout is clicked out, then typed into.
      if (c.def.typed) this.startText(m.id, true, before);
    }
    this.viewer.requestFrame();
  }

  /** Take back the last point clicked (Backspace, Ctrl+Z, the right-click menu); none left abandons the shape. */
  removeLastPoint(): boolean {
    const c = this.clicking;
    if (!c) return false;
    c.points.pop();
    if (!c.points.length) this.clicking = null;
    this.viewer.requestFrame();
    this.opts.onChange();
    return true;
  }

  /** Whether the shape being clicked out has points enough to finish. */
  get canFinishPoints(): boolean {
    const c = this.clicking;
    return !!c && c.def.draw.gesture === "points" && c.points.length >= c.def.draw.min;
  }

  /** True while a shape is being clicked out (Enter finishes it, Esc abandons it). */
  get drawingPoints(): boolean {
    return this.clicking !== null;
  }

  /** The names from when only the cloud was clicked out. */
  finishCloud(keep: boolean): void {
    this.finishPoints(keep);
  }

  get drawingCloud(): boolean {
    return this.drawingPoints;
  }

  // Measuring
  /**
   * Asked before a newly drawn markup is kept: false drops it (Calibrate hands its two points
   * to the app and keeps nothing; an angle dragged out as two points is no angle).
   */
  keep: ((m: Markup) => boolean) | null = null;

  /**
   * The markup being drawn, as it would be made now, for the status bar's live readout: a
   * drag's draft, or the points clicked so far with the pointer's. `segment` is the last
   * point to the pointer while clicking.
   */
  drawingShape(): { markup: Markup; segment: { from: Pt; to: Pt } | null } | null {
    const g = this.gesture;
    if (g?.kind === "draw" && g.draft) return { markup: g.draft, segment: null };
    const c = this.clicking;
    if (!c || c.def.draw.gesture !== "points") return null;
    const pts = c.hover ? [...c.points, c.hover] : c.points;
    if (pts.length < 2) return null;
    const last = c.points[c.points.length - 1];
    return { markup: this.newMarkup(c.def, c.page, c.def.draw.make(pts, this.drawContext)), segment: c.hover ? { from: last, to: c.hover } : null };
  }
  // End measuring

  // ---------------------------------------------------------------- text boxes

  private startText(id: string, isNew: boolean, before?: Markup[]): void {
    this.editing = { id, isNew, before: before ?? this.markups };
    this.redraw();
  }

  /** The text box being edited, if any. */
  editingMarkup(): TypedMarkup | null {
    const m = this.editing ? this.doc?.byId(this.editing.id) : undefined;
    return m && defOf(m).typed ? (m as TypedMarkup) : null;
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
    // Rule 3: an empty one stays if its kind keeps it (a callout; a text box something shows).
    const fm = final.find((x) => x.id === e.id);
    if (m && fm && defOf(m).typed && !(fm as TypedMarkup).text.trim() && !defOf(fm).keepEmpty?.(fm)) {
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
    // Phase 7b: an annotation from the file that hasn't changed is PDFium's to draw.
    for (const mk of d.markups) if (mk.page === page && d.overlayDraws(mk)) paintOps(ctx, this.opsOf(mk), m, mk.id === editing);
    const g = this.gesture;
    if (g?.kind === "draw" && g.page === page && g.draft) paintOps(ctx, opsFor(g.draft), m);
    // A "place" tool's preview, following the pointer until the click.
    const def = this.def;
    if (!g && this.placeAt?.page === page && def?.draw.gesture === "place") {
      const s = def.draw.make(this.placeAt.p, this.drawContext);
      if (s) paintOps(ctx, opsFor(this.newMarkup(def, page, s)), m);
    }
    const accent = this.opts.accent ?? "#0d9488";
    const dev = (p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Clicking out a shape: the points so far and a rubber band to the pointer (and back to the
    // first point, for a closed shape).
    const c = this.clicking;
    if (c?.page === page) {
      const closed = c.def.draw.gesture === "points" && c.def.draw.closed && c.points.length >= 2;
      const pts = [...c.points, ...(c.hover ? [c.hover] : []), ...(closed ? [c.points[0]] : [])].map(dev);
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
      // Text markups: a markup with no grips (a text highlight, a note) shows its box instead.
      if (!handles(x).length) {
        const b = shapeBounds(x);
        const pts = ([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] as Pt[]).map(dev);
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const h of handles(x, this.tolPt(1))) {
        const [hx, hy] = dev(h.at);
        // Stage 8: the rotate grip, round, on a stem from the middle of the top edge.
        if (h.id === "rotate") {
          paintRotateGrip(ctx, x, dev, [hx, hy], r);
          continue;
        }
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

/**
 * A point placed from `from` with the gesture's lock (rule 2): Shift snaps to 15 degree steps;
 * a kind that starts ortho-locked (dimensions) is held horizontal or vertical, and Shift frees it.
 */
export function lockTo(d: Draw<Markup>, from: Pt, p: Pt, shift: boolean): Pt {
  if (d.gesture === "points" && d.lock === "ortho") return shift ? p : orthoFrom(from, p);
  return shift ? snapAngle(from, p) : p;
}

// Stage 8
/** A rotate grip: a stem from the middle of the markup's top edge (as turned), then a round grip. */
function paintRotateGrip(ctx: CanvasRenderingContext2D, x: Markup, dev: (p: Pt) => Pt, at: Pt, r: number): void {
  const from = "rect" in x ? dev(topMiddle(x.rect as Rect, turnOf(x))) : null;
  if (from) {
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(at[0], at[1]);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(at[0], at[1], r + 0.5, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
}

/** Stamp the modification time. */
function touch(m: Markup): Markup {
  return { ...m, meta: { ...m.meta, modified: new Date().toISOString() } };
}

/** A markup made whole after a move or resize (a text box grown to fit). */
function settle(m: Markup): Markup {
  const def = defOf(m);
  return def.settle ? def.settle(m) : m;
}
