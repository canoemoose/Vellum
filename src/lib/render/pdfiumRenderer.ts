// PDFs: rasterised by the PDFium pool in Rust (src-tauri/src/pdfium.rs). All the work is in
// BackendRenderer, shared with image documents.

import { BackendRenderer } from "./backendRenderer";

export class PdfiumRenderer extends BackendRenderer {
  readonly name = "pdfium" as const;
}
