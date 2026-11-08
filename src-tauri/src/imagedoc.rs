//! Image documents (JPEG, PNG, WebP, TIFF, BMP, GIF) as single-page documents.
//!
//! **Owned by WP-Images from v0.1 phase 1 on.** WP-Engine created this file as a stub with
//! the final signatures; `docs.rs` dispatches to it. The contract:
//!
//! - `ImageDoc` must be `Send + Sync`: it lives in an `Arc` in the document registry and is
//!   rendered from blocking threads, possibly two regions at once.
//! - Closing a document drops its `ImageDoc`; free everything in `Drop` (or just let the
//!   fields drop).
//! - Errors are strings the UI shows as they are ("Not a PDF or supported image", ...).
//! - Coordinates match the PDF path exactly: the page is `page_size()` points; a region is
//!   the device-pixel rect (x, y, w, h) of the page bitmap at `rs` device pixels per point
//!   (bitmap size `ceil(w_pt * rs)` x `ceil(h_pt * rs)`). Pixels are RGBA, opaque.

use crate::pdfium::PageSize;
use std::path::Path;

/// File extensions routed to this module (lower case, no dot).
pub const EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "gif"];

/// True if `path` should open as an image document.
pub fn handles(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// A decoded image held in memory.
pub struct ImageDoc {
    _private: (),
}

impl ImageDoc {
    /// Decode the file once.
    pub fn open(_path: &Path) -> Result<ImageDoc, String> {
        Err("Image support not built yet".into())
    }

    /// Page size in points: pixels at the image's embedded DPI, 96 DPI when it has none.
    pub fn page_size(&self) -> PageSize {
        PageSize { w: 0.0, h: 0.0 }
    }

    /// A note for the tab, e.g. "Opened at half resolution (180 MP)". None normally.
    pub fn note(&self) -> Option<String> {
        None
    }

    /// Render the region into `out`: RGBA rows of `stride` bytes, `h` rows, already filled
    /// opaque white. Write only the `w * 4` bytes of each row.
    pub fn render_region(
        &self,
        _rs: f64,
        _x: i64,
        _y: i64,
        _w: i32,
        _h: i32,
        _out: &mut [u8],
        _stride: usize,
    ) -> Result<(), String> {
        Err("Image support not built yet".into())
    }

    /// The whole image scaled so its longer side is `max_side` pixels: (w, h, RGBA).
    pub fn thumbnail(&self, _max_side: u32) -> Result<(u32, u32, Vec<u8>), String> {
        Err("Image support not built yet".into())
    }
}
