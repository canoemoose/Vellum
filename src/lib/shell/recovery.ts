// Crash recovery: which records this session may delete, and where a restore can go. Pure;
// App.svelte does the reading, writing and asking.
//
// A tab with no unsaved markups used to delete its file's record a second after any change in
// the tab, opening included, so a record a crash left was gone while "Restore them?" was still
// showing (docs/review-0.2.0.md, 2). Now a clean tab deletes only a record this session wrote;
// one left by a crash goes only when the user answers Discard, or a save makes it redundant.

export interface RecoveryIo {
  write(key: string, json: string): void;
  remove(key: string): Promise<void> | void;
}

export class RecoveryRecords {
  /** Keys of the records this session wrote and hasn't deleted since. */
  private readonly mine = new Set<string>();

  constructor(private readonly io: RecoveryIo) {}

  /**
   * Keep a tab's record in step with it: with unsaved markups, write them; without, delete the
   * record only if this session wrote it (a crash's record waits for the user's answer).
   */
  keep(key: string, dirty: boolean, json: () => string): void {
    if (dirty) {
      this.mine.add(key);
      this.io.write(key, json());
    } else if (this.mine.delete(key)) {
      void this.io.remove(key);
    }
  }

  /** Delete the record whoever wrote it: the user said Discard or Don't save, or a save made it redundant. */
  drop(key: string): Promise<void> {
    this.mine.delete(key);
    return Promise.resolve(this.io.remove(key));
  }

  /** Whether this session wrote the record (for tests and diagnostics). */
  wrote(key: string): boolean {
    return this.mine.has(key);
  }
}

/**
 * Where restored markups go once the file's annotations have been read: `here`, into the tab on
 * the canvas; `background`, into the tab's own markups, drawn when it's next shown (possible
 * once the file's annotations are known, since nothing needs hiding in PDFium yet); `keep`,
 * nowhere for now, leaving the record on disk to be offered on the next open. Never dropped.
 */
export function restoreTarget(t: { exists: boolean; active: boolean; docOpen: boolean; read: boolean }): "here" | "background" | "keep" {
  if (!t.exists) return "keep";
  if (t.active && t.docOpen) return "here";
  return t.read ? "background" : "keep";
}
