// What a picture of a page made from PDFium's render (a sidebar thumbnail, the mini map) needs
// to show the page as it is now: the markups PDFium doesn't draw, painted on top, and word of
// when to redraw or ask for the picture again. Svelte-free; the shell builds one for the
// active tab.

export interface PageMarks {
  /** Moves whenever a markup changes: paint again. */
  version: number;
  /** Moves whenever some page's picture in PDFium changes: compare `epochOf` for the pages held. */
  epoch: number;
  /** Counts the changes to one page's picture in PDFium (an annotation hidden or shown). */
  epochOf(page: number): number;
  /** Paint the page's markups that PDFium doesn't draw; `m` maps page points to the context's pixels. */
  paint(ctx: CanvasRenderingContext2D, page: number, m: [number, number, number, number, number, number]): void;
}
