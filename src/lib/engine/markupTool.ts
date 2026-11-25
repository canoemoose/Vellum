// Drawing and editing markups on the canvas. Svelte-free: input.ts feeds it the left button and
// App.svelte the keys; it draws through a viewer page painter and keeps its state in the
// active tab's MarkupDoc. Tools stay active after drawing (agreed default); Esc returns to
// Select. See docs/editing-phase2-scope.md.

import type { Viewer } from "./viewer";
import type { MarkupDoc } from "./markupDoc";
import { paintOps } from "./markupPainter";
import { type Op, opsFor } from "../markup/ops";
import { fitText } from "../markup/textbox";
import { rebase } from "../markup/history";
import { type HandleId, dragHandle, handleAt, handleCursor, handles, hits, insideMarquee, moveBy, partAt, orthoFrom, rectPts, shapeBounds, simplify, snapAngle, squareFrom, turnOf } from "../markup/geometry";
import { type Markup, type MarkupKind, type Pt, type Rect, type Style, type TextStyle, newId, normRect } from "../markup/types";
import { type Draw, type DrawContext, type KindDef, type Shape, MIN_BOX_PX, pointLock } from "../markup/kinds/kind";
import { defOf, kindOf } from "../markup/kinds";
import { toolById, withPreset } from "../markup/tools";
import { centredOn, fromClip, keptOn, newSession, toClip } from "../markup/clip";
// Stage 6: shapes
import { DEFAULT_SIDES, regularFromDrag, regularVertices } from "../markup/regular";
import { addCorner, canRemoveCorner, cornerOfGrip, removeCorner } from "../markup/corners";
import { topMiddle, turnPt } from "../markup/turn"; // Stage 8
import { canCrop, cropHandles, dragCrop, faded, uncropped } from "../markup/kinds/stamp"; // Cropping

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
  /** A tool that places one (ToolDef.once) has placed it: the app goes back to Select. */
  placedOnce?(): void;
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
   * docs/edit-lock-brief.md, 2: the user went to change a markup that came with the file while
   * the file is locked (clicked the padlock on its selection, or tried to drag it). The shell
   * asks whether to unlock the file; the markup stays selected either way.
   */
  onUnlockAsk?(id: string): void;
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
  /** Stage 6: how many sides a tool drags a regular polygon with (its remembered Sides). */
  sides?(tool: Tool): number;
}

/** What the system clipboard held, as far as pasting goes. */
export type ClipRead = { kind: "markups"; json: string } | { kind: "picture"; png: string; w: number; h: number } | { kind: "none" };

/** CSS px: how close the pointer must be to pick a markup, and a handle. */
const PICK_PX = 5;
const HANDLE_PX = 7;
/** CSS px: the padlock on a locked markup's selection, its radius and how far out from the corner it sits. */
const LOCK_PX = 8;
const LOCK_OUT_PX = 3;
/** CSS px the pointer must move with the button down before a press becomes a drag. */
const DRAG_PX = 3;

type Gesture =
  | { kind: "move"; page: number; start: Pt; before: Markup[]; ids: string[]; moved: boolean }
  | { kind: "handle"; page: number; id: string; handle: HandleId; before: Markup[]; nudge?: Pt; crop?: boolean; lifted?: boolean }
  | { kind: "marquee"; page: number; a: Pt; b: Pt; add: boolean }
  | { kind: "draw"; page: number; a: Pt; sx: number; sy: number; draft: Markup | null; points: Pt[] }
  | { kind: "pending"; page: number; id: string; sx: number; sy: number; start: Pt; before: Markup[]; part?: { handle: HandleId; nudge: Pt } };

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
    this.placeTurn = 0;
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
    // Cropping ends when the picture is no longer the one thing selected (or has gone).
    const d = this.doc;
    if (this.cropId && (!d || d.selection.size !== 1 || !d.selection.has(this.cropId) || !d.byId(this.cropId))) this.cropId = null;
    this.viewer.requestFrame();
    this.opts.onChange();
  }

  // ---------------------------------------------------------------- cropping (Matt's review)

  /** The picture being cropped: its grips crop it rather than resize it. */
  private cropId: string | null = null;

  get cropping(): boolean {
    return this.cropId !== null;
  }

  /** The one selected markup, if it's a picture that can be cropped. */
  get croppable(): boolean {
    const s = this.selected();
    return s.length === 1 && s[0].kind === "stamp" && canCrop(s[0]) && !!this.doc?.editable(s[0]);
  }

  /** Crop the one selected picture (its grips crop it until Enter, Esc or a click elsewhere), or stop. */
  setCropping(on: boolean): void {
    this.cropId = on && this.croppable ? this.selected()[0].id : null;
    this.redraw();
  }

  /** The whole picture again, one undo step. */
  uncrop(): void {
    const s = this.selected();
    if (s.length === 1 && s[0].kind === "stamp" && s[0].content.type === "image" && s[0].content.crop) this.updateMarkup(uncropped(s[0]));
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
    // docs/edit-lock-brief.md, 2: what came with the file can be picked while the file is locked
    // (a click on it, its row in the Markups list), though not changed: every change below skips
    // it. A marquee and select all still leave it out (their callers filter by `editable`).
    for (const id of ids) d.selection.add(id);
    this.redraw();
  }

  /** The selected markups that may be changed: all of them, less any the file's lock keeps. */
  selectedChangeable(): Markup[] {
    const d = this.doc;
    return d ? this.selected().filter((m) => d.editable(m)) : [];
  }

  private changeable(): Set<string> {
    return new Set(this.selectedChangeable().map((m) => m.id));
  }

  /** Whether markup `m` is selected but locked: it came with the file and the file is locked. */
  isLocked(m: Markup): boolean {
    return !!this.doc && !this.doc.editable(m);
  }

  /** The selection holds only markups the lock keeps (the context bar has nothing to offer them). */
  get selectionLocked(): boolean {
    const s = this.selected();
    return s.length > 0 && s.every((m) => this.isLocked(m));
  }

  /**
   * Where the padlock sits on a locked markup's selection, screen (CSS px): just out from the
   * top-right corner of its box as shown, whatever the page's turn.
   */
  lockBadgeAt(m: Markup): [number, number] | null {
    const b = shapeBounds(m);
    const cs = ([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] as Pt[]).map((p) => this.viewer.pageToScreen(m.page, p[0], p[1]));
    if (cs.some((c) => !c)) return null;
    const xs = cs.map((c) => c![0]), ys = cs.map((c) => c![1]);
    return [Math.max(...xs) + LOCK_OUT_PX + LOCK_PX, Math.min(...ys) - LOCK_OUT_PX - LOCK_PX];
  }

  /** The locked, selected markup whose padlock is under screen point (sx, sy). */
  private lockBadgeHit(sx: number, sy: number): Markup | null {
    for (const m of this.selected()) {
      if (!this.isLocked(m)) continue;
      const at = this.lockBadgeAt(m);
      if (at && Math.hypot(at[0] - sx, at[1] - sy) <= LOCK_PX + 2) return m;
    }
    return null;
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
    // What the lock keeps stays (and stays selected).
    const gone = this.changeable();
    if (!gone.size) return false;
    this.commit(this.markups.filter((m) => !gone.has(m.id)));
    return true;
  }

  /** Move the selection by (dx, dy) screen pixels, as arrow keys do. */
  nudge(dxPx: number, dyPx: number): boolean {
    const d = this.doc;
    if (!d?.selection.size) return false;
    // Text markups don't move: a selection of only those takes no undo step.
    const moving = (m: Markup) => d.selection.has(m.id) && !defOf(m).ofText && d.editable(m);
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
    // What the lock keeps is copied (copying is free) but not cut.
    const gone = new Set(this.selected().filter((m) => !defOf(m).ofText && !defOf(m).fixed && d.editable(m)).map((m) => m.id));
    if (gone.size) this.commit(this.markups.filter((m) => !gone.has(m.id)));
    for (const id of gone) d.selection.delete(id);
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
    this.pointerAt = null;
    // A stamp's preview doesn't stay behind at the edge (or under a picker opened over the drawing).
    if (this.placeAt) {
      this.placeAt = null;
      this.viewer.requestFrame();
    }
  }

  /** Where the pointer is over the drawing, on a page or beside one (screen, CSS px). */
  private pointerAt: [number, number] | null = null;

  /**
   * The point on a page nearest the pointer, when it's over the drawing but off every page: the
   * nearest page, among those either side of the one in view, and the nearest point on it.
   */
  private nearestOnPage(sx: number, sy: number): { page: number; p: Pt } | null {
    const sizes = this.viewer.doc?.sizes;
    if (!sizes?.length) return null;
    const mid = this.viewer.currentPageIndex;
    let best: { page: number; p: Pt; d: number } | null = null;
    for (let page = Math.max(0, mid - 2); page <= Math.min(sizes.length - 1, mid + 2); page++) {
      const at = this.pointOn(sx, sy, page);
      if (!at) continue;
      const { w, h } = sizes[page];
      const q: Pt = [Math.min(w, Math.max(0, at.p[0])), Math.min(h, Math.max(0, at.p[1]))];
      const d = Math.hypot(q[0] - at.p[0], q[1] - at.p[1]);
      if (!best || d < best.d) best = { page, p: q, d };
    }
    return best && { page: best.page, p: best.p };
  }

  /**
   * Where a paste lands: the pointer, if `where` allows and it's over the drawing (beside a
   * page, the nearest point on one); else the middle of the view.
   */
  private pasteTarget(where: "pointer" | "centre"): { page: number; p: Pt } | null {
    if (where === "pointer" && this.pointer) return this.pointer;
    if (where === "pointer" && this.pointerAt) {
      const near = this.nearestOnPage(...this.pointerAt);
      if (near) return near;
    }
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
    // On the page, all of it: a paste near its edge is moved in as far as it takes.
    const size = this.viewer.doc?.sizes[target.page];
    const placed = centredOn(r.markups, target.p);
    const copies = (size ? keptOn(placed, size) : placed).map((m) => ({
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
    const d = this.doc;
    return from.map((m) => {
      // An annotation Vellum can't redraw keeps its own look (kind.ts, fixed); one the lock
      // keeps isn't restyled.
      if (!sel.has(m.id) || defOf(m).fixed || (d && !d.editable(m))) return m;
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
    if (!this.previewBase) this.opts.onLift?.([...this.changeable()]);
    // The file's annotations may have been read in since the preview began (history.ts rebase).
    this.previewBase = this.previewBase ? rebase(this.previewBase, this.markups) : this.markups;
    d.history.replace(this.styled(this.previewBase, d.selection, patch));
    this.redraw();
    return true;
  }

  /** Change the style of the selected markups. */
  restyle(patch: Partial<Style>, text?: Partial<TextStyle>): boolean {
    const d = this.doc;
    if (this.previewBase && d) {
      d.history.replace(rebase(this.previewBase, this.markups));
      this.previewBase = null;
    }
    if (!d?.selection.size) return false;
    const next = this.styled(this.markups, d.selection, patch, text);
    // Nothing it may change (all locked, say): no undo step for nothing.
    if (next.every((m, i) => m === this.markups[i])) return false;
    this.commit(next);
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
    // docs/edit-lock-brief.md, 2: what came with the file can be picked while the file is
    // locked, to be found and copied, and asked to unlock from; it can't be changed.
    const on = this.markups.filter((m) => m.page === page);
    for (let i = on.length - 1; i >= 0; i--) if (hits(on[i], p, tol)) return on[i];
    return null;
  }

  // ---------------------------------------------------------------- pointer

  /** Left button down. True if the markup tool takes the gesture. */
  down(sx: number, sy: number, clicks: number, mods: Mods): boolean {
    this.shiftHeld = mods.shift;
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
    // A locked markup's padlock: ask to unlock the file (brief, 2). First, as it may stand
    // off the page's edge.
    const badge = this.lockBadgeHit(sx, sy);
    if (badge) {
      this.opts.onUnlockAsk?.(badge.id);
      return true;
    }
    const at = this.pointOn(sx, sy);
    if (!at) {
      if (!mods.shift) this.clearSelection();
      return false;
    }
    const { page, p } = at;
    // Cropping: its crop grips first; a press anywhere else ends cropping, and goes on as usual.
    const cm = this.cropId ? this.doc.byId(this.cropId) : undefined;
    if (cm?.kind === "stamp" && cm.page === page) {
      const tol = this.tolPt(HANDLE_PX);
      const grip = cropHandles(cm).find((h) => Math.hypot(h.at[0] - p[0], h.at[1] - p[1]) <= tol);
      if (grip) {
        this.gesture = { kind: "handle", page, id: cm.id, handle: grip.id, before: this.markups, crop: true };
        return true;
      }
    }
    if (this.cropId) this.setCropping(false);
    // A handle of a selected markup first (the lock keeps a locked one's: it shows a padlock).
    for (const m of this.selected()) {
      if (m.page !== page || this.isLocked(m)) continue;
      const h = handleAt(m, p, this.tolPt(HANDLE_PX), this.tolPt(1));
      // Dimensions (stage 5): a double-click on a grip puts back what it holds (a moved value).
      const reset = h && clicks === 2 ? defOf(m).resetHandle?.(m, h) : null;
      if (reset) {
        this.updateMarkup(reset);
        return true;
      }
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
    // Stage 6: a double-click on an edge of a shape of points adds a corner there.
    if (clicks === 2 && this.addCornerAt(hit, p)) return true;
    // A double-click to type into one the lock keeps: it's selected, and the question asked.
    if (clicks === 2 && defOf(hit).typed && this.isLocked(hit)) {
      this.select([hit.id]);
      this.opts.onUnlockAsk?.(hit.id);
      return true;
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
    // A part that works a grip (a dimension's value or line): dragged, it's that grip, held
    // where it was taken so nothing jumps; double-clicked, what the grip puts back.
    const ph = this.doc.editable(hit) ? partAt(hit, p, this.tolPt(PICK_PX)) : null;
    const reset = ph && clicks === 2 ? defOf(hit).resetHandle?.(hit, ph) : null;
    if (reset) {
      this.select([hit.id]);
      this.updateMarkup(reset);
      return true;
    }
    if (!this.doc.selection.has(hit.id) || ph) this.select([hit.id]);
    const grip = ph ? handles(hit, this.tolPt(1)).find((x) => x.id === ph) : undefined;
    const part = ph && grip ? { handle: ph, nudge: [grip.at[0] - p[0], grip.at[1] - p[1]] as Pt } : undefined;
    this.gesture = { kind: "pending", page, id: hit.id, sx, sy, start: p, before: this.markups, ...(part ? { part } : {}) };
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
    this.shiftHeld = mods.shift;
    // Stage 9: where a paste would land.
    const on = this.pointOn(sx, sy);
    this.pointer = on;
    this.pointerAt = [sx, sy];
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
        if (g.part) {
          this.gesture = { kind: "handle", page: g.page, id: g.id, handle: g.part.handle, before: g.before, nudge: g.part.nudge };
          return this.move(sx, sy, mods);
        }
        {
          // Only what may change moves. Dragging one the lock keeps asks to unlock instead
          // (brief, 2): the drag ends there, and the markup stays selected.
          const ids = [...this.changeable()];
          const held = this.doc!.byId(g.id);
          if (held && this.isLocked(held)) {
            this.gesture = null;
            this.opts.onUnlockAsk?.(held.id);
            return;
          }
          this.gesture = { kind: "move", page: g.page, start: g.start, before: g.before, ids, moved: true };
          this.opts.onLift?.(ids);
        }
        return this.move(sx, sy, mods);
      case "move": {
        g.before = rebase(g.before, this.markups); // the file's annotations, read in meanwhile
        let dx = p[0] - g.start[0], dy = p[1] - g.start[1];
        if (mods.shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        const ids = new Set(g.ids);
        this.doc!.history.replace(g.before.map((m) => (ids.has(m.id) ? moveBy(m, dx, dy) : m)));
        break;
      }
      case "handle":
        if (!g.lifted) {
          g.lifted = true;
          this.opts.onLift?.([g.id]);
        }
        g.before = rebase(g.before, this.markups); // the file's annotations, read in meanwhile
        {
          const q: Pt = g.nudge ? [p[0] + g.nudge[0], p[1] + g.nudge[1]] : p;
          const drag = (m: Markup): Markup => (g.crop && m.kind === "stamp" ? dragCrop(m, g.handle, q, this.tolPt(MIN_BOX_PX)) : dragHandle(m, g.handle, q, mods.shift));
          this.doc!.history.replace(g.before.map((m) => (m.id === g.id ? drag(m) : m)));
        }
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
        this.doc.history.replace(rebase(g.before, final));
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
        // Cropping: the crop grips' cursors.
        const cm = this.cropId ? this.doc.byId(this.cropId) : undefined;
        if (cm?.kind === "stamp" && cm.page === at.page) {
          const grip = cropHandles(cm).find((g) => Math.hypot(g.at[0] - at.p[0], g.at[1] - at.p[1]) <= this.tolPt(HANDLE_PX));
          if (grip) [h, turn] = [grip.id, cm.angle ?? 0];
        }
        for (const m of this.selected())
          if (!h && m.page === at.page && (h = handleAt(m, at.p, this.tolPt(HANDLE_PX), this.tolPt(1)))) turn = turnOf(m);
        if (h) c = handleCursor(h, this.viewer.rotation, turn);
        else {
          // Text markups don't move: over one, the text tool's cursor shows. Over a part that
          // works a grip, the grip's cursor.
          const top = this.topAt(at.page, at.p);
          const locked = !!top && this.isLocked(top);
          const part = top && !locked ? partAt(top, at.p, this.tolPt(PICK_PX)) : null;
          if (part && top) c = handleCursor(part, this.viewer.rotation, turnOf(top));
          else if (top && !defOf(top).ofText) c = locked ? "default" : "move";
        }
      }
    }
    const c0 = this.clicking;
    if (c0) {
      const at = this.pointOn(sx, sy, c0.page);
      c0.hover = at ? lockTo(c0.def.draw, c0.points, at.p, mods.shift) : null;
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
    // A stamp turned with [ and ] before it's placed starts that much further round than upright as viewed.
    return { textStyle: this.opts.textStyle(this.tool), pick: this.tolPt(HANDLE_PX), viewRotation: this.viewer.rotation - this.placeTurn, free: this.shiftHeld, ...(this.ctxPage !== null ? { page: this.ctxPage } : {}) };
  }

  /** Shift, as of the last press or move (what a shape being drawn is made with). */
  private shiftHeld = false;

  /** The page what's being drawn is on (drawContext's page), set before each make. */
  private ctxPage: number | null = null;

  /** Degrees clockwise [ and ] have turned what the current "place" tool places next (reset with the tool). */
  private placeTurn = 0;

  /**
   * [ and ]: turn by `deg` clockwise as seen. With a tool that places (a stamp, a signature, an
   * image) out, what it places next, its preview turning with it; otherwise the selection, in
   * one undo step, if everything in it can turn. True if a turn was for the markups (so the view
   * isn't turned): also when the selection holds something that can't turn, which stays as it is.
   */
  turnBy(deg: number): boolean {
    if (this.def?.draw.gesture === "place") {
      this.placeTurn = ((this.placeTurn + deg) % 360 + 360) % 360;
      this.viewer.requestFrame();
      return true;
    }
    const d = this.doc;
    const sel = this.selected();
    if (!d || !sel.length) return false;
    if (sel.some((m) => !defOf(m).turnBy || !d.editable(m))) return true;
    this.opts.onLift?.(sel.map((m) => m.id));
    this.commit(this.markups.map((m) => (d.selection.has(m.id) ? touch(defOf(m).turnBy!(m, deg)) : m)));
    this.opts.onChange();
    return true;
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
    if (c && def.draw.gesture === "box") {
      // A box clicked out: the second click is the opposite corner (Shift squares it). One
      // too small to be a box is ignored, so a stray double-click doesn't make a sliver.
      const p = lockTo(def.draw, c.points, at.p, mods.shift);
      const a = c.points[0];
      const min = this.tolPt(MIN_BOX_PX);
      if (Math.abs(p[0] - a[0]) >= min && Math.abs(p[1] - a[1]) >= min) {
        c.points = [a, p];
        this.finishPoints(true);
      }
      this.viewer.requestFrame();
      return true;
    }
    // The second press of a double-click that just finished a clicked-out box starts nothing.
    if (!c && clicks >= 2 && def.draw.gesture === "box" && !def.draw.click) return true;
    if (c && def.draw.gesture === "points") {
      // Clicking out a shape: a double-click (or Enter) finishes it; so does a click on the
      // first point of a closed one.
      const p = lockTo(def.draw, c.points, at.p, mods.shift);
      const first = c.points[0];
      // On the first point as clicked, or as locked (an ortho-locked corner may not reach it).
      const near = (q: Pt) => Math.hypot(q[0] - first[0], q[1] - first[1]) <= this.tolPt(HANDLE_PX);
      const onFirst = def.draw.closed && c.points.length >= def.draw.min && (near(p) || near(at.p));
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
    this.ctxPage = g.page;
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
        else if (d.drag === "regular") {
          // Stage 6: a regular polygon from the centre out; Shift puts a flat side at the bottom as viewed.
          const r = regularFromDrag(a, p, this.opts.sides?.(this.tool) ?? DEFAULT_SIDES, mods.shift ? this.pageDown(g.page, sx, sy) : null);
          make(d.make(regularVertices(r), { ...this.drawContext, regular: r }));
        } else make(d.make([a, lockTo(d, [a], p, mods.shift)], this.drawContext));
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
    this.ctxPage = g.page;
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
          // A click (or a drag too small to be a box): one at the point, if the kind has one;
          // otherwise the first corner of a box clicked out, the next click its opposite corner.
          if (!d.click) {
            this.clicking = { def, page: g.page, points: [g.a], hover: null };
            return;
          }
          m = this.newMarkup(def, g.page, d.click(g.a, this.drawContext));
        }
        break;
      case "points":
        if (tooSmall(m, d.drag !== "line")) {
          // A click (or a drag too small to count): start clicking out the shape.
          this.clicking = { def, page: g.page, points: [g.a], hover: null };
          return;
        }
        break;
      case "freehand":
        // A click without moving makes a dot.
        m = this.newMarkup(def, g.page, d.make([m ? simplify(g.points, this.tolPt(0.6)) : [g.a]]));
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
    if (toolById(this.tool)?.once) this.opts.placedOnce?.();
  }

  /** Finish (or with keep false, abandon) a shape being clicked out. */
  finishPoints(keep: boolean): void {
    const c = this.clicking;
    this.clicking = null;
    if (!c) return;
    const d = c.def.draw;
    if (d.gesture === "box") {
      // A box clicked out, corner to corner.
      if (keep && c.points.length >= 2) {
        const [a, b] = c.points;
        this.commitDrawn(c.def, c.page, d.make(normRect([a[0], a[1], b[0], b[1]]), this.drawContext));
      }
      this.viewer.requestFrame();
      return;
    }
    if (d.gesture !== "points") return;
    // A double-click adds its point twice: drop repeats.
    const pts = c.points.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-6);
    if (keep && pts.length >= d.min) this.commitDrawn(c.def, c.page, d.make(pts, this.drawContext));
    this.viewer.requestFrame();
  }

  /** A shape clicked out, made and kept (and typed into, for a callout). */
  private commitDrawn(def: KindDef, page: number, shape: Shape<Markup>): void {
    let m = this.newMarkup(def, page, shape);
    if (def.finish) m = def.finish(m);
    if (this.keep && !this.keep(m)) return this.redraw(); // Measuring
    const before = this.markups;
    this.commit([...before, m]);
    this.select([m.id]);
    // Text markups: a callout is clicked out, then typed into.
    if (def.typed) this.startText(m.id, true, before);
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
    if (!c) return false;
    const d = c.def.draw;
    return d.gesture === "box" ? c.points.length >= 2 : d.gesture === "points" && c.points.length >= d.min;
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
    if (!c) return null;
    const pts = c.hover ? [...c.points, c.hover] : c.points;
    if (pts.length < 2) return null;
    const d = c.def.draw;
    if (d.gesture === "box") {
      const [a, b] = pts;
      return { markup: this.newMarkup(c.def, c.page, d.make(normRect([a[0], a[1], b[0], b[1]]), this.drawContext)), segment: null };
    }
    if (d.gesture !== "points") return null;
    const last = c.points[c.points.length - 1];
    return { markup: this.newMarkup(c.def, c.page, d.make(pts, this.drawContext)), segment: c.hover ? { from: last, to: c.hover } : null };
  }
  // End measuring

  // ---------------------------------------------------------------- stage 6: shapes

  /** The page direction that is down on screen at (sx, sy): follows the view's quarter turns. */
  private pageDown(page: number, sx: number, sy: number): Pt | null {
    const a = this.pointOn(sx, sy, page), b = this.pointOn(sx, sy + 1, page);
    return a && b ? [b.p[0] - a.p[0], b.p[1] - a.p[1]] : null;
  }

  /** A double-click at p on markup `m`: a corner added on the edge there, as one undo step. */
  private addCornerAt(m: Markup, p: Pt): boolean {
    if (!this.doc?.editable(m)) return false;
    const added = addCorner(m, p, this.tolPt(PICK_PX) + m.style.width / 2);
    if (!added) return false;
    this.opts.onLift?.([m.id]);
    this.commit(this.markups.map((x) => (x.id === m.id ? touch(settle(added.markup)) : x)));
    this.select([m.id]);
    return true;
  }

  /**
   * The corner of a selected markup under screen point (sx, sy), for the right-click menu:
   * which markup, which corner, and whether it can go (not below the fewest its kind takes).
   */
  cornerAt(sx: number, sy: number): { id: string; index: number; removable: boolean } | null {
    if (this.tool !== "select") return null;
    const at = this.pointOn(sx, sy);
    if (!at) return null;
    for (const m of this.selected()) {
      if (m.page !== at.page) continue;
      const h = handleAt(m, at.p, this.tolPt(HANDLE_PX));
      const index = h ? cornerOfGrip(m, h) : -1;
      if (index >= 0) return { id: m.id, index, removable: canRemoveCorner(m, index) };
    }
    return null;
  }

  /** Remove corner `index` of markup `id`, as one undo step. */
  removeCorner(id: string, index: number): boolean {
    const m = this.doc?.byId(id);
    if (!m || !this.doc!.editable(m)) return false;
    const next = removeCorner(m, index);
    if (!next) return false;
    this.opts.onLift?.([id]);
    this.commit(this.markups.map((x) => (x.id === id ? touch(settle(next)) : x)));
    return true;
  }

  /** The selection's number of sides, where all of it can take one and agree; else null. */
  selectedSides(): number | null {
    const s = this.selected().map((m) => defOf(m).sides?.(m) ?? null);
    return s.length && s.every((n) => n !== null && n === s[0]) ? s[0] : null;
  }

  /** Change the sides of every selected regular polygon, as one undo step. */
  setSides(n: number): boolean {
    const d = this.doc;
    if (!d?.selection.size) return false;
    const change = (m: Markup) => d.selection.has(m.id) && d.editable(m) && defOf(m).withSides && defOf(m).sides?.(m) != null;
    if (!this.markups.some(change)) return false;
    this.opts.onLift?.(this.markups.filter(change).map((m) => m.id));
    this.commit(this.markups.map((m) => (change(m) ? touch(defOf(m).withSides!(m, n)) : m)));
    return true;
  }

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
    // The file's annotations may have been read in while typing: the undo step keeps them.
    const before = rebase(e.before, final, e.isNew ? new Set([e.id]) : undefined);
    this.doc.history.replace(before);
    // Rule 3: an empty one stays if its kind keeps it (a callout; a text box something shows).
    const fm = final.find((x) => x.id === e.id);
    if (m && fm && defOf(m).typed && !(fm as TypedMarkup).text.trim() && !defOf(fm).keepEmpty?.(fm)) {
      if (!e.isNew) this.commit(final.filter((x) => x.id !== e.id));
      else this.redraw();
      return;
    }
    // Nothing typed (whatever else changed meanwhile): no step for it.
    if (fm === e.before.find((x) => x.id === e.id)) {
      this.doc.history.replace(final);
      this.redraw();
      return;
    }
    this.commit(final.map((x) => (x.id === e.id ? touch(x) : x)));
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
      this.ctxPage = page;
      const s = def.draw.make(this.placeAt.p, this.drawContext);
      if (s) paintOps(ctx, opsFor(this.newMarkup(def, page, s)), m);
    }
    const accent = this.opts.accent ?? "#0d9488";
    const dev = (p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Clicking out a shape: the points so far and a rubber band to the pointer (and back to the
    // first point, for a closed shape).
    const c = this.clicking;
    // Dimensions (stage 5): a kind with `preview` shows itself as it would be made, not a rubber band.
    const shown = c?.page === page && ((c.def.draw.gesture === "points" && c.def.draw.preview) || c.def.draw.gesture === "box") ? this.drawingShape() : null;
    if (shown) {
      paintOps(ctx, opsFor(shown.markup), m);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else if (c?.page === page) {
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
      // One the lock keeps: its box, dashed, and a padlock in place of grips (brief, 2).
      if (this.isLocked(x)) {
        paintLockedSelection(ctx, x, dev, accent, this.viewer.dpr);
        continue;
      }
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
      // Stage 6: square grips (a box's) first, then round ones (corners on the shape) over them.
      // A shape with both shows its box as a dashed outline, so the square grips read as the box's.
      // Cropping: the whole picture faint around what shows, its crop box dashed, and the crop grips.
      const crop = x.id === this.cropId && x.kind === "stamp";
      if (crop) {
        const whole = uncropped(x);
        paintOps(ctx, faded(opsFor(whole), 0.35 * x.style.opacity), m);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      const hs = crop ? cropHandles(x) : handles(x, this.tolPt(1));
      if (crop || (hs.some((q) => q.round) && hs.some((q) => !q.round))) {
        // Through its corner grips, so it turns with a turned shape; snapped to whole pixels only when upright.
        const at = (id: string) => hs.find((q) => q.id === id)?.at;
        const corners = ["nw", "ne", "se", "sw"].map(at);
        const b = shapeBounds(x);
        const pts = (corners.every(Boolean) ? (corners as Pt[]) : ([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] as Pt[])).map(dev);
        const snap = (v: number) => (turnOf(x) ? v : Math.round(v) + 0.5);
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(snap(q[0]), snap(q[1])) : ctx.moveTo(snap(q[0]), snap(q[1]))));
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Cropping: brackets at the corners and bars on the edges, not the resize grips.
      if (crop) {
        paintCropGrips(ctx, x, dev, this.viewer.dpr);
        continue;
      }
      for (const h of [...hs.filter((q) => !q.round), ...hs.filter((q) => q.round)]) {
        const [hx, hy] = dev(h.at);
        // Stage 8: the rotate grip, round, on a stem from the middle of the top edge.
        if (h.id === "rotate") {
          paintRotateGrip(ctx, x, dev, [hx, hy], r, h.stem);
          continue;
        }
        ctx.fillStyle = "#ffffff";
        if (h.round) {
          ctx.beginPath();
          ctx.arc(Math.round(hx - r) + 0.5 + r, Math.round(hy - r) + 0.5 + r, r, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
          continue;
        }
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
 * The next point after `placed` (the points so far, at least one) with the gesture's lock
 * (rule 2): Shift snaps to 15 degree steps; a point that starts ortho-locked (dimensions) is
 * held horizontal or vertical, and Shift frees it; one with no lock is taken as it is. Which
 * point it's locked from, and how, is the kind's per point (kinds/kind.ts, pointLock).
 */
export function lockTo(d: Draw<Markup>, placed: Pt[], p: Pt, shift: boolean): Pt {
  // A box clicked out: Shift squares it on its first corner.
  if (d.gesture === "box") return shift && placed.length ? squareFrom(placed[0], p) : p;
  const rule = pointLock(d.gesture === "points" ? d.lock : undefined, placed.length);
  const from = placed[rule.from] ?? placed[placed.length - 1];
  if (rule.lock === "none") return p;
  if (rule.lock === "ortho") return shift ? p : orthoFrom(from, p);
  return shift ? snapAngle(from, p) : p;
}

/**
 * A picture's crop grips (Matt's review: they look different from the resize grips): an L at
 * each corner along its two edges, and a bar along the middle of each edge, thick and dark with
 * a light edge so they show on any picture, turned with it.
 */
function paintCropGrips(ctx: CanvasRenderingContext2D, x: Extract<Markup, { kind: "stamp" }>, dev: (p: Pt) => Pt, dpr: number): void {
  const [x0, y0, x1, y1] = normRect(x.rect);
  const c: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
  const a = x.angle ?? 0;
  const on = (p: Pt) => dev(turnPt(p, c, a));
  // Device pixels along the box's own sides, from the corners' screen positions.
  const tl = on([x0, y0]), tr = on([x1, y0]), bl = on([x0, y1]);
  const unit = (p: Pt, q: Pt): Pt => {
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
  };
  const ux = unit(tl, tr), uy = unit(tl, bl);
  const L = 12 * dpr, B = 9 * dpr;
  const at = (s: Pt, d: Pt, k: number): Pt => [s[0] + d[0] * k, s[1] + d[1] * k];
  const paths: Pt[][] = [];
  for (const [p, sx, sy] of [[[x0, y0], 1, 1], [[x1, y0], -1, 1], [[x1, y1], -1, -1], [[x0, y1], 1, -1]] as [Pt, number, number][]) {
    const q = on(p);
    paths.push([at(q, ux, sx * L), q, at(q, uy, sy * L)]);
  }
  for (const [p, d] of [[[c[0], y0], ux], [[x1, c[1]], uy], [[c[0], y1], ux], [[x0, c[1]], uy]] as [Pt, Pt][]) {
    const q = on(p);
    paths.push([at(q, d, -B), at(q, d, B)]);
  }
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";
  for (const [colour, w] of [["#ffffff", 6 * dpr], ["#1f2933", 3.5 * dpr]] as [string, number][]) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (const ps of paths) ps.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.stroke();
  }
  ctx.lineCap = "butt";
}

// Stage 8
/** A rotate grip: a stem from the middle of the markup's top edge (as turned), then a round grip. */
function paintRotateGrip(ctx: CanvasRenderingContext2D, x: Markup, dev: (p: Pt) => Pt, at: Pt, r: number, stem?: Pt): void {
  // Where the grip says its stem starts (a polygon, a cloud), or a turned box's own top.
  const from = dev(stem ?? ("rect" in x ? topMiddle(x.rect as Rect, turnOf(x)) : topMiddle(shapeBounds(x), 0)));
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(at[0], at[1]);
  ctx.stroke();
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

/**
 * A locked markup's selection (docs/edit-lock-brief.md, 2): its box dashed, and at its top-right
 * corner as shown, a padlock on an accent disc (with a darker rim: a filled control needs a
 * visible edge). Clicking the padlock asks to unlock the file. Device pixels; `dev` maps page
 * points to them. Placed as MarkupTool.lockBadgeAt places it in CSS px.
 */
function paintLockedSelection(ctx: CanvasRenderingContext2D, x: Markup, dev: (p: Pt) => Pt, accent: string, dpr: number): void {
  const b = shapeBounds(x);
  const pts = ([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] as Pt[]).map(dev);
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  const r = LOCK_PX * dpr;
  const cx = Math.max(...pts.map((q) => q[0])) + (LOCK_OUT_PX + LOCK_PX) * dpr;
  const cy = Math.min(...pts.map((q) => q[1])) - (LOCK_OUT_PX + LOCK_PX) * dpr;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.lineWidth = dpr;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
  ctx.stroke();
  // The padlock, closed, in white: a body and a shackle.
  const u = dpr;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.4 * u;
  ctx.fillRect(cx - 3.5 * u, cy - 0.5 * u, 7 * u, 5 * u);
  ctx.beginPath();
  ctx.arc(cx, cy - 1.5 * u, 2.4 * u, Math.PI, 0);
  ctx.moveTo(cx - 2.4 * u, cy - 1.5 * u);
  ctx.lineTo(cx - 2.4 * u, cy - 0.5 * u);
  ctx.moveTo(cx + 2.4 * u, cy - 1.5 * u);
  ctx.lineTo(cx + 2.4 * u, cy - 0.5 * u);
  ctx.stroke();
  ctx.restore();
}
