// A tab's markups and their undo history, and what to save. Pure.

import type { Markup } from "./types";
import type { Change, AnnotSpec } from "./spec";

/** Undo / redo over snapshots of the markup list (markups are immutable values). */
export class History {
  private past: Markup[][] = [];
  private future: Markup[][] = [];

  constructor(
    public present: Markup[] = [],
    readonly limit = 200,
  ) {}

  /** Record a new state (no-op if it's the same list). */
  push(next: Markup[]): void {
    if (next === this.present) return;
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
  }

  /** Replace the present without a history step (a drag in progress). */
  replace(next: Markup[]): void {
    this.present = next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.present);
    this.present = prev;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.present);
    this.present = next;
    return true;
  }

  // Stamps
  /**
   * Take markups out of every state, past and future: a signature baked into the page is part
   * of the page now, so undo and redo mustn't bring it back as a markup.
   */
  forget(ids: ReadonlySet<string>): void {
    if (!ids.size) return;
    const f = (l: Markup[]) => (l.some((m) => ids.has(m.id)) ? l.filter((m) => !ids.has(m.id)) : l);
    this.present = f(this.present);
    this.past = this.past.map(f);
    this.future = this.future.map(f);
  }
}

/**
 * What saving `current` over a file that holds `saved` means: new markups added, changed ones
 * replaced (by id), removed ones deleted. `spec` turns a markup into its annotation.
 */
export function changesFor(saved: Markup[], current: Markup[], spec: (m: Markup) => AnnotSpec): Change[] {
  const before = new Map(saved.map((m) => [m.id, m]));
  const now = new Set(current.map((m) => m.id));
  const out: Change[] = [];
  for (const m of current) {
    const old = before.get(m.id);
    if (!old) out.push({ op: "add", spec: spec(m) });
    else if (old !== m && JSON.stringify(old) !== JSON.stringify(m)) out.push({ op: "replace", spec: spec(m) });
  }
  for (const m of saved) if (!now.has(m.id)) out.push({ op: "delete", page: m.page, nm: m.id });
  return out;
}

/** Whether the markups differ from what's saved. */
export function isDirty(saved: Markup[], current: Markup[]): boolean {
  if (saved === current) return false;
  if (saved.length !== current.length) return true;
  const before = new Map(saved.map((m) => [m.id, m]));
  return current.some((m) => {
    const o = before.get(m.id);
    return !o || (o !== m && JSON.stringify(o) !== JSON.stringify(m));
  });
}
