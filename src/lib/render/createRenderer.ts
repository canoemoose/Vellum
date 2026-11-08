import { ImageRenderer, isImagePath } from "./imageRenderer";
import { PdfiumRenderer } from "./pdfiumRenderer";
import type { Renderer } from "./types";

// Renderers hold no per-document state (documents live in the backend under their id), so
// one instance of each serves every document and tab.
let pdfium: PdfiumRenderer | null = null;
let image: ImageRenderer | null = null;

/**
 * The renderer for a file, chosen by extension. The backend decides the real kind (it sniffs
 * files with unknown extensions), and both renderers drive the same commands, so a wrong
 * guess here only changes the renderer's name.
 */
export function rendererFor(path: string): Renderer {
  if (isImagePath(path)) return (image ??= new ImageRenderer());
  return (pdfium ??= new PdfiumRenderer());
}

/** The PDF renderer (for callers that only deal in PDFs). */
export function pdfRenderer(): PdfiumRenderer {
  return (pdfium ??= new PdfiumRenderer());
}
