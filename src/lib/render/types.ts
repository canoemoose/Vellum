// The renderer interface. Documents (PDFs and images) live in the Rust backend under a
// numeric id from open(); every call names the document it's for. Renderers hand back
// ImageBitmaps so the cache and compositor never know what made them.

import type { PageSize } from "../view/layout";
import type { TileSpec } from "./tiles";
import type { TextLayer } from "../text/layer";
import type { PageHits, SearchOptions } from "../text/searchModel";

export type RendererName = "pdfium" | "image";
export type DocKind = "pdf" | "image";

/** Document properties. PDF fields are null for images. */
export interface DocMeta {
  /** Bytes on disk. */
  fileSize: number;
  /** "1.7" and so on. */
  pdfVersion: string | null;
  title: string | null;
  author: string | null;
  subject: string | null;
  producer: string | null;
  creator: string | null;
  /** Shown in the tab when set, e.g. an image opened at reduced resolution. */
  note: string | null;
}

export interface DocInfo {
  docId: number;
  kind: DocKind;
  numPages: number;
  /** Page sizes in points. */
  sizes: PageSize[];
  meta: DocMeta;
  /** PDFium instances rendering in parallel (diagnostics; 0 for images). */
  workers: number;
}

export interface RegionRequest {
  page: number;
  /** Device pixels per point. */
  rs: number;
  /** Region in device pixels within the page bitmap at rs. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tiles to cut from the region (their rects are page-relative, inside the region). */
  tiles: TileSpec[];
}

/**
 * One band of a progressive region render. The band's pixels are drawn at (x, y, w, h) in
 * device pixels of the page bitmap at the request's rs (page-relative, like tile rects).
 * `tiles` lists the requested tiles this band completed: index into `req.tiles` plus the
 * finished bitmap. `bitmap` is null when the band holds nothing the tiles don't already
 * show (every requested tile it touches is complete). Ownership of every bitmap passes to the
 * callee, which must close them.
 */
export interface BandBitmap {
  x: number;
  y: number;
  w: number;
  h: number;
  bitmap: ImageBitmap | null;
  tiles: { index: number; bitmap: ImageBitmap }[];
}

export interface OutlineNode {
  title: string;
  /** Zero-based target page, null if the bookmark doesn't point into this document. */
  page: number | null;
  /** Target position from the top of the page in points, when the bookmark gives one. */
  y: number | null;
  children: OutlineNode[];
}

/** A drawing-scale note found on a page, as returned best first by findScale. */
export interface ScaleCandidate {
  /**
   * The N in 1:N on the page itself. A note stated for another sheet size ("1:200 @A3" on an
   * A1 page) is already corrected (to 1:100); `statedRatio` keeps what was written.
   */
  ratio: number;
  /** As written on the page, e.g. "1 : 100". */
  text: string;
  /** [x0, y0, x1, y1] in page points, y down from the top of the page. */
  bbox: [number, number, number, number];
  /** The ratio as written, when `ratio` was corrected for a stated sheet size; else null. */
  statedRatio?: number | null;
  /** The sheet size the note states ("A3"), if any. */
  sheet?: string | null;
}

export interface Renderer {
  readonly name: RendererName;
  /**
   * Open a document. Rejects with a string the UI can show as is: "Password required",
   * "Wrong password", "Not a PDF or supported image", "pdfium.dll not found: run ...".
   */
  open(path: string, password?: string): Promise<DocInfo>;
  /**
   * Render a region and return one bitmap per requested tile, in order. Resolves to
   * null if aborted. Implementations should stop work promptly when the signal fires.
   */
  renderRegion(docId: number, req: RegionRequest, signal: AbortSignal): Promise<ImageBitmap[] | null>;
  /**
   * Progressive render: `onBand` is called as each band of the region lands (a renderer that
   * can't stream calls it once). Resolves after the last band, or early if aborted (bands
   * that land after the abort are closed, not delivered). Every requested tile is delivered
   * through some band's `tiles` unless aborted.
   */
  renderRegionProgressive?(
    docId: number,
    req: RegionRequest,
    onBand: (b: BandBitmap) => void,
    signal: AbortSignal,
  ): Promise<void>;
  /** Whole page scaled so its longer side is maxSide device pixels. */
  thumbnail?(docId: number, page: number, maxSide: number): Promise<ImageBitmap>;
  /** How many backend workers a w x h region of a page renders on, or null if not known yet. */
  knownBands?(docId: number, page: number, w: number, h: number): Promise<number | null>;
  pageText?(docId: number, page: number): Promise<string>;
  outline?(docId: number): Promise<OutlineNode[]>;
  /** Drawing-scale notes on a page, best first (empty if none). */
  findScale?(docId: number, page: number): Promise<ScaleCandidate[]>;
  /** Every character on a page with its box, and the page's links (src/lib/text/layer.ts). */
  textLayer?(docId: number, page: number): Promise<TextLayer>;
  /** Search one page with PDFium's matcher. */
  searchPage?(docId: number, page: number, query: string, opts: SearchOptions): Promise<PageHits>;
  /**
   * The page preview stored on disk for this document's file by an earlier session (the
   * persistent preview cache), or null.
   */
  cachedPreview?(docId: number, page: number): Promise<ImageBitmap | null>;
  /** Store a page preview on disk for next time (best effort). */
  storePreview?(docId: number, page: number, bitmap: ImageBitmap): Promise<void>;
  close(docId: number): Promise<void>;
  /** Close and wait until the backend has let go of the file (before replacing it). */
  closeAndWait?(docId: number): Promise<void>;
}
