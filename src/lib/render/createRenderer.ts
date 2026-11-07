import type { Renderer } from "./types";

/**
 * Renderer by name: "pdfium" (default; Rust backend, see RESULTS.md for why), "pdfjs"
 * (GPU canvases) or "pdfjs-cpu" (pdf.js's own default of CPU-backed canvases). Loaded
 * lazily so the unused one costs nothing at startup. If pdfium.dll is missing, App falls
 * back to pdf.js when the first file is opened.
 */
export async function createRenderer(name: string | null | undefined): Promise<Renderer> {
  switch (name) {
    case "pdfjs": {
      const { PdfjsRenderer } = await import("./pdfjsRenderer");
      return new PdfjsRenderer(true);
    }
    case "pdfjs-cpu": {
      const { PdfjsRenderer } = await import("./pdfjsRenderer");
      return new PdfjsRenderer(false);
    }
    default: {
      const { PdfiumRenderer } = await import("./pdfiumRenderer");
      return new PdfiumRenderer();
    }
  }
}
