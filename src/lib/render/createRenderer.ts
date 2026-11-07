import type { Renderer } from "./types";

/**
 * Renderer by name: "pdfjs" (default, GPU canvases), "pdfjs-cpu" (pdf.js's own default
 * of CPU-backed canvases) or "pdfium" (Rust backend). Loaded lazily so the unused one
 * costs nothing at startup.
 */
export async function createRenderer(name: string | null | undefined): Promise<Renderer> {
  switch (name) {
    case "pdfium": {
      const { PdfiumRenderer } = await import("./pdfiumRenderer");
      return new PdfiumRenderer();
    }
    case "pdfjs-cpu": {
      const { PdfjsRenderer } = await import("./pdfjsRenderer");
      return new PdfjsRenderer(false);
    }
    default: {
      const { PdfjsRenderer } = await import("./pdfjsRenderer");
      return new PdfjsRenderer(true);
    }
  }
}
