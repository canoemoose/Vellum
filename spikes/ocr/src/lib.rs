//! Spike: OCR search on scanned pages with Windows' built-in OCR. See README.md and
//! docs/ocr-search-scope.md.

pub mod fixture;
pub mod frame;
pub mod geom;
pub mod image;
pub mod score;
pub mod search;

#[cfg(windows)]
pub mod memory;
#[cfg(windows)]
pub mod ocr;
#[cfg(windows)]
pub mod pdf;
#[cfg(windows)]
pub mod pipeline;
