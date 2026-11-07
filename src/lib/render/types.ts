// Renderer abstraction: pdf.js (in the WebView) and PDFium (in Rust) both implement this,
// and both hand back ImageBitmaps so the cache and compositor never know which made them.

import type { PageSize } from "../view/layout";
import type { TileSpec } from "./tiles";

export type RendererName = "pdfjs" | "pdfium";

export interface DocInfo {
  numPages: number;
  sizes: PageSize[];
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

export interface Renderer {
  readonly name: RendererName;
  open(path: string): Promise<DocInfo>;
  /**
   * Render a region and return one bitmap per requested tile, in order. Resolves to
   * null if aborted. Implementations should stop work promptly when the signal fires.
   */
  renderRegion(req: RegionRequest, signal: AbortSignal): Promise<ImageBitmap[] | null>;
  close(): Promise<void>;
}
