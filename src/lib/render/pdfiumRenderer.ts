// Placeholder until the PDFium path is prototyped (only needed if pdf.js fails the
// acceptance criteria).
import type { DocInfo, RegionRequest, Renderer } from "./types";

export class PdfiumRenderer implements Renderer {
  readonly name = "pdfium" as const;
  async open(_path: string): Promise<DocInfo> {
    throw new Error("PDFium renderer not built yet");
  }
  async renderRegion(_req: RegionRequest, _signal: AbortSignal): Promise<ImageBitmap[] | null> {
    return null;
  }
  async close(): Promise<void> {}
}
