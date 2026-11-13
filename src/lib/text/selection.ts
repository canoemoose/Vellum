// A text selection that can run across pages: two caret positions (page, character index
// between 0 and n). Pure.

export interface Caret {
  page: number;
  /** Caret position: 0 is before the first character, n after the last. */
  index: number;
}

export interface Selection {
  anchor: Caret;
  focus: Caret;
}

export function compareCarets(a: Caret, b: Caret): number {
  return a.page - b.page || a.index - b.index;
}

/** The selection's start and end, in reading order. */
export function ordered(s: Selection): [Caret, Caret] {
  return compareCarets(s.anchor, s.focus) <= 0 ? [s.anchor, s.focus] : [s.focus, s.anchor];
}

export function isEmpty(s: Selection | null): boolean {
  return !s || compareCarets(s.anchor, s.focus) === 0;
}

/** The pages the selection touches, first to last. */
export function selectedPages(s: Selection): number[] {
  const [a, b] = ordered(s);
  const out: number[] = [];
  for (let p = a.page; p <= b.page; p++) out.push(p);
  return out;
}

/**
 * The characters selected on `page`, as [start, end), given the page's character count; null
 * when the selection doesn't touch it.
 */
export function rangeOnPage(s: Selection, page: number, n: number): [number, number] | null {
  const [a, b] = ordered(s);
  if (page < a.page || page > b.page) return null;
  const start = page === a.page ? Math.min(a.index, n) : 0;
  const end = page === b.page ? Math.min(b.index, n) : n;
  return end > start ? [start, end] : null;
}

/** Join the selected text of each page (in order) for the clipboard. */
export function joinPages(parts: string[]): string {
  return parts
    .map((p) => p.replace(/\s+$/, ""))
    .filter((p) => p.length > 0)
    .join("\n\n");
}
