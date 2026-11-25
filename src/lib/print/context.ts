// The contract between the shell (WP-Shell) and the print feature (WP-Print).
// The shell builds a PrintContext when File > Print... is chosen and mounts
// PrintDialog with it. Owned by WP-Print from here on; changes to this shape go
// through the integrator so the shell can follow.

import type { DocInfo, Renderer } from "../render/types";

/** One open document as the print feature sees it. */
export interface PrintDoc {
  docId: number;
  /** Absolute path on disk. */
  path: string;
  /** File name shown in the UI. */
  title: string;
  info: DocInfo;
  /**
   * Page `page`'s drawing scale N in 1:N, or null when not known. Pages of a set can each be at
   * their own scale (a 1:5000 site plan, then 1:100 sheets). The shell's answer can change
   * while the dialog is open, as title blocks not yet read come in; it reads reactive state,
   * so whatever derives from it follows.
   */
  scaleOf: (page: number) => number | null;
}

/** A rectangle on one page, in page points, y down from the top of the page. */
export interface PageRect {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PrintContext {
  /** Every open document, in tab order. */
  docs: PrintDoc[];
  /** The active tab's document, or null when no document is open. */
  activeDocId: number | null;
  /** Zero-based current page of the active document. */
  currentPage: number;
  /** What is on screen now for Pages > View, or null if not available. */
  viewRect: PageRect | null;
  /**
   * Pages > Marquee: the shell hides nothing itself; the dialog hides, calls this, and the
   * shell lets the user drag a rectangle on the active page. Resolves null if cancelled
   * (Escape or right-click).
   */
  pickRegion(): Promise<PageRect | null>;
  /** The shared renderer, for previews, thumbnails and opening extra files. */
  renderer: Renderer;
  /** Current theme, for anything the dialog draws on a canvas. */
  theme: "dark" | "light";
}
