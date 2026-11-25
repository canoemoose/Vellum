// A tab's markups: the undo history, what the file already holds (to work out a save), the
// pages' frames, the selection and the edit lock. Svelte-free; one per tab, kept in the tab
// while it's in the background.
//
// Phase 7b: annotations already in the file are read in (adoptFile) and join the markups. Until
// one is changed PDFium keeps drawing it, with its own appearance; once it's changed or deleted
// it's "lifted": hidden in PDFium (toLift, then doc_hide_annots) and drawn by the overlay from
// then on. Saving replaces it in place. The lock (editable) keeps what came with the file from
// being changed until "Edit file" is switched on, except your own Vellum markups; it can still be
// picked (docs/edit-lock-brief.md, 2).

import { History, changesFor, isDirty } from "../markup/history";
import type { Markup } from "../markup/types";
import { type Frame, toUser } from "../markup/pdf";
import { type Change, toSpec } from "../markup/spec";
import { type FileOrigin, type FromFile, type PageAnnots, freeToEdit } from "../markup/fileAnnots";
import { readReedit } from "../markup/reedit";

/** What to hide on one page: by /NM where the annotation's /NM is its id, else by position. */
export interface PageLift {
  page: number;
  nms: string[];
  indices: number[];
}

export class MarkupDoc {
  readonly history = new History([]);
  /** The markups as the file holds them (after the last save, or as recovered). */
  saved: Markup[] = [];
  /** Page frames fetched for saving (doc_page_frame), by page. */
  readonly frames = new Map<number, Frame>();
  /** Selected markup ids. */
  selection = new Set<string>();
  /** "Edit file" on (the file unlocked): changing what the file came with is allowed. Locked on open. */
  unlocked = false;

  // Existing annotations (phase 7b)
  /** Where each markup that is in the file sits in it, by id. */
  readonly files = new Map<string, FileOrigin>();
  /** Annotations that came with the file rather than being made in this session: the lock covers them. */
  readonly cameWithFile = new Set<string>();
  /** Ids whose annotation is hidden in PDFium, so the overlay draws them instead. */
  readonly hidden = new Set<string>();
  /** The file's annotations have been read (annot_read). */
  read = false;
  /** A save has moved annotations in the file and it hasn't been read again yet: positions are out of date. */
  stale = false;
  /** The read under way, if any (a save waits for it). */
  reading: Promise<void> | null = null;
  /** Who you are: your own Vellum markups need no unlocking. */
  author = "";

  private savedFor: Markup[] | null = null;
  private savedMap = new Map<string, Markup>();
  private changedCache = new WeakMap<Markup, boolean>();

  get markups(): Markup[] {
    return this.history.present;
  }

  get dirty(): boolean {
    return isDirty(this.saved, this.markups);
  }

  onPage(page: number): Markup[] {
    return this.markups.filter((m) => m.page === page);
  }

  byId(id: string): Markup | undefined {
    return this.markups.find((m) => m.id === id);
  }

  /**
   * Pages whose frames a save needs and doesn't have yet: those where something changed (a
   * file's untouched annotations need none, and fetching a frame loads the page in PDFium).
   */
  pagesWithoutFrames(): number[] {
    const now = new Set(this.markups.map((m) => m.id));
    const need = new Set([...this.markups.filter((m) => this.changed(m)), ...this.saved.filter((m) => !now.has(m.id))].map((m) => m.page));
    return [...need].filter((p) => !this.frames.has(p));
  }

  /** What saving now would change in the file. Every page involved must have its frame. */
  changes(): Change[] {
    const frame = (page: number) => {
      const f = this.frames.get(page);
      if (!f) throw new Error(`no frame for page ${page + 1}`);
      return f;
    };
    const out = changesFor(this.saved, this.markups, (m) => toSpec(m, frame(m.page)));
    return out.map((c): Change => {
      if (c.op === "add" || c.op === "bake" || c.op === "move") return c;
      const id = c.op === "delete" ? c.nm : c.spec.nm;
      const at = this.at(id);
      if (c.op === "delete") return at === undefined ? c : { ...c, at };
      const m = this.byId(id);
      const before = this.savedById(id);
      // One Vellum can't redraw is moved, appearance and all, by how far it has gone since the save.
      if (m?.kind === "foreign" && before?.kind === "foreign") {
        const f = frame(m.page);
        const o = toUser(f, 0, 0);
        const d = toUser(f, m.moved[0] - before.moved[0], m.moved[1] - before.moved[1]);
        return { op: "move", page: m.page, nm: id, at, dx: d[0] - o[0], dy: d[1] - o[1], modified: c.spec.modified };
      }
      return at === undefined ? c : { ...c, spec: { ...c.spec, at } };
    });
  }

  /**
   * After a save: `written` (the markups as they were when the save's changes were worked out,
   * by default the current ones) is now what the file holds. Anything changed while the save
   * was under way stays unsaved.
   */
  markSaved(written: Markup[] = this.markups): void {
    this.saved = written;
  }

  /** Ids of markups that are in the file (and so drawn by PDFium unless hidden). */
  savedIds(page: number): string[] {
    return this.saved.filter((m) => m.page === page).map((m) => m.id);
  }

  // ---------------------------------------------------------------- existing annotations (7b)

  private savedById(id: string): Markup | undefined {
    if (this.savedFor !== this.saved) {
      this.savedFor = this.saved;
      this.savedMap = new Map(this.saved.map((m) => [m.id, m]));
      this.changedCache = new WeakMap();
    }
    return this.savedMap.get(id);
  }

  /** Whether a markup differs from the file's copy (or the file has none). */
  changed(m: Markup): boolean {
    const s = this.savedById(m.id);
    if (!s) return true;
    if (s === m) return false;
    let c = this.changedCache.get(m);
    if (c === undefined) this.changedCache.set(m, (c = JSON.stringify(s) !== JSON.stringify(m)));
    return c;
  }

  /** Where the writer finds an annotation: by position when its /NM isn't its id (or it has none). */
  private at(id: string): number | undefined {
    const o = this.files.get(id);
    if (!o || o.nm === id) return undefined;
    if (this.stale) throw new Error("the file's annotations are being read again");
    return o.index;
  }

  /** PDFium draws this one (it's in the file and not hidden). */
  pdfiumDraws(id: string): boolean {
    return this.files.has(id) && !this.hidden.has(id);
  }

  /** The overlay draws this one: PDFium doesn't, or it has changed since. */
  overlayDraws(m: Markup): boolean {
    return !this.pdfiumDraws(m.id) || this.changed(m);
  }

  /**
   * Whether a markup may be changed: anything made in this session; with "Edit file" on,
   * anything; otherwise, of what came with the file, only your own Vellum
   * markups (docs/editing-phase7-scope.md, 7b "Assumed" 1).
   */
  editable(m: Markup): boolean {
    if (this.unlocked || !this.cameWithFile.has(m.id)) return true;
    const o = this.files.get(m.id);
    return !!o && freeToEdit(o, m, this.author);
  }

  /** Lifted as soon as it's read: Vellum's own notes, which the overlay keeps a fixed size on screen and PDFium doesn't. */
  private liftAlways(m: Markup, o: FileOrigin): boolean {
    return o.exact && m.kind === "note";
  }

  /**
   * The file's annotations, read (fileAnnots.ts fromFile), join the markups: in every state of
   * the history (they were there all along) and in what the file holds. No undo step.
   */
  adoptFile(list: FromFile[]): void {
    const present = new Set(this.markups.map((m) => m.id));
    const byId = new Map(list.map((x) => [x.markup.id, x.markup]));
    for (const { markup, origin } of list) {
      this.files.set(markup.id, origin);
      this.cameWithFile.add(markup.id);
    }
    this.saved = [...this.saved.filter((m) => !byId.has(m.id)), ...list.map((x) => x.markup)];
    this.history.adopt(list.map((x) => x.markup).filter((m) => !present.has(m.id)));
    this.read = true;
  }

  /**
   * What to hide in PDFium now, by page, and taken as hidden: with `ids`, those (a drag is
   * starting on them); otherwise every annotation from the file that has changed or gone.
   * One found only by position waits while positions are out of date.
   */
  toLift(ids?: string[]): PageLift[] {
    const byPage = new Map<number, PageLift>();
    const current = new Map(this.markups.map((m) => [m.id, m]));
    for (const id of ids ?? [...this.files.keys()]) {
      const o = this.files.get(id);
      if (!o || this.hidden.has(id)) continue;
      const m = current.get(id);
      if (!ids && m && !this.changed(m) && !this.liftAlways(m, o)) continue;
      if (o.nm !== id && this.stale) continue;
      let p = byPage.get(o.page);
      if (!p) byPage.set(o.page, (p = { page: o.page, nms: [], indices: [] }));
      if (o.nm === id) p.nms.push(id);
      else p.indices.push(o.index);
      this.hidden.add(id);
    }
    return [...byPage.values()];
  }

  /**
   * Before a save's reopen: what the overlay should go on drawing, which is hidden again in the
   * reopened file by /NM (every markup Vellum writes or replaces carries its id as /NM). The
   * rest (unchanged annotations from the file, and ones Vellum can only move) are PDFium's to
   * draw from then on. Call before markSaved, with the same `written`: the markups the save's
   * changes were worked out from (by default the current ones), not any made since.
   */
  hideAfterSave(written: Markup[] = this.markups): Map<number, string[]> {
    const keep = new Set<string>();
    const byPage = new Map<number, string[]>();
    for (const m of written) {
      if (m.kind === "foreign") continue;
      const o = this.files.get(m.id);
      const draws = !this.cameWithFile.has(m.id) || this.hidden.has(m.id) || (!!o && this.liftAlways(m, o));
      if (!draws) continue;
      // Written with its id as /NM: anything made here or changed now, or already carrying it.
      const named = !this.cameWithFile.has(m.id) || this.changed(m) || o?.nm === m.id;
      if (!named) continue;
      keep.add(m.id);
      byPage.set(m.page, [...(byPage.get(m.page) ?? []), m.id]);
    }
    this.hidden.clear();
    for (const id of keep) this.hidden.add(id);
    this.stale = this.files.size > 0;
    return byPage;
  }

  /**
   * The file read again after a save: where each annotation now sits. Those with an /NM that is
   * a markup's id are found by it; the rest, which a save never touches but whose positions
   * earlier deletes may have moved, keep their order. Markups made here and now saved join the
   * file's (still free to edit: they didn't come with it).
   */
  reread(pages: PageAnnots[]): void {
    const saved = new Set(this.saved.map((m) => m.id));
    const pageOf = new Map(this.saved.map((m) => [m.id, m.page]));
    const next = new Map<string, FileOrigin>();
    const exact = (a: PageAnnots["annots"][number]) => !!a.vellum && readReedit(a.vellum, a.modified) !== null;
    for (const p of pages) {
      const matched = new Set<string>();
      const rest: PageAnnots["annots"] = [];
      for (const a of p.annots) {
        if (a.nm && pageOf.get(a.nm) === p.page && !matched.has(a.nm)) {
          matched.add(a.nm);
          next.set(a.nm, { page: p.page, index: a.index, nm: a.nm, subtype: a.subtype, exact: exact(a) });
        } else rest.push(a);
      }
      const old = [...this.files].filter(([id, o]) => o.page === p.page && saved.has(id) && !matched.has(id)).sort((x, y) => x[1].index - y[1].index);
      old.forEach(([id, o], i) => {
        const a = rest[i];
        if (a) next.set(id, { ...o, index: a.index, nm: a.nm, subtype: a.subtype, exact: exact(a) });
      });
    }
    this.files.clear();
    for (const [id, o] of next) this.files.set(id, o);
    for (const id of [...this.hidden]) if (!this.files.has(id)) this.hidden.delete(id);
    this.stale = false;
  }
}
