// A tab's markups: the undo history, what the file already holds (to work out a save), the
// pages' frames, the selection and the edit lock. Svelte-free; one per tab, kept in the tab
// while it's in the background.

import { History, changesFor, isDirty } from "../markup/history";
import type { Markup } from "../markup/types";
import type { Frame } from "../markup/pdf";
import { type Change, toSpec } from "../markup/spec";

export class MarkupDoc {
  readonly history = new History([]);
  /** The markups as the file holds them (after the last save, or as recovered). */
  saved: Markup[] = [];
  /** Page frames fetched for saving (doc_page_frame), by page. */
  readonly frames = new Map<number, Frame>();
  /** Selected markup ids. */
  selection = new Set<string>();
  /** "Edit document" unlocked: changing what the file came with is allowed. Locked on open. */
  unlocked = false;

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

  /** Pages whose frames a save needs and doesn't have yet. */
  pagesWithoutFrames(): number[] {
    const need = new Set([...this.markups, ...this.saved].map((m) => m.page));
    return [...need].filter((p) => !this.frames.has(p));
  }

  /** What saving now would change in the file. Every page involved must have its frame. */
  changes(): Change[] {
    return changesFor(this.saved, this.markups, (m) => {
      const f = this.frames.get(m.page);
      if (!f) throw new Error(`no frame for page ${m.page + 1}`);
      return toSpec(m, f);
    });
  }

  /** The current markups are now what the file holds. */
  markSaved(): void {
    this.saved = this.markups;
  }

  /** Ids of markups that are in the file (and so drawn by PDFium unless hidden). */
  savedIds(page: number): string[] {
    return this.saved.filter((m) => m.page === page).map((m) => m.id);
  }
}
