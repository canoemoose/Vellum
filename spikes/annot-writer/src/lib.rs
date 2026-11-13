//! Phase 0 spike (docs/editing-scope.md): can lopdf append standard annotations to real PDFs
//! by incremental update? `writer` and `appearance` are shaped to become
//! `src-tauri/src/annot/` if the answer is yes; `pdfium_check` reads the output back through
//! the engine Vellum renders with; `demo` is the set of markups the samples carry.

pub mod appearance;
pub mod demo;
pub mod helvetica;
pub mod memory;
pub mod pdfium_check;
pub mod writer;
