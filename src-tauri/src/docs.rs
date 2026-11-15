//! The document registry: one id space for PDF and image documents, and dispatch on kind.
//!
//! Commands in lib.rs take a document id and call in here; PDFs go to the PDFium pool
//! (pdfium.rs), images to imagedoc.rs. Other Rust modules (printing) use the same functions,
//! for example [`Docs::open_pdf_bytes`] to make a composed PDF renderable and printable.

use crate::imagedoc::{self, ImageDoc};
use crate::pdfium::{self, BandPart, OutlineNode, PageSize, PdfMeta, PdfiumState, RegionArgs};
use crate::scale::ScaleCandidate;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DocKind {
    Pdf,
    Image,
}

/// Document properties. PDF fields are null for images.
#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocMeta {
    /// Bytes on disk (or in memory for a composed document).
    pub file_size: u64,
    #[serde(flatten)]
    pub pdf: PdfMeta,
    /// Shown in the tab when set, e.g. an image opened at reduced resolution.
    pub note: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocInfo {
    pub doc_id: u64,
    pub kind: DocKind,
    pub num_pages: usize,
    /// Page sizes in points.
    pub sizes: Vec<PageSize>,
    pub meta: DocMeta,
    /// PDFium instances rendering in parallel (diagnostics; 0 for images).
    pub workers: usize,
}

enum Entry {
    Pdf,
    Image(Arc<ImageDoc>),
}

struct Slot {
    entry: Entry,
    /// Content key for the persistent preview cache (None for in-memory documents).
    cache_key: Option<String>,
}

#[derive(Default)]
pub struct Docs {
    next: AtomicU64,
    map: Mutex<HashMap<u64, Slot>>,
}

/// What a file is, from its first bytes. Pure, for tests.
pub fn sniff_kind(head: &[u8]) -> Option<DocKind> {
    // PDF readers accept the header anywhere in the first 1 KB.
    let n = head.len().min(1024);
    if head[..n].windows(5).any(|w| w == b"%PDF-") {
        return Some(DocKind::Pdf);
    }
    const IMAGE_MAGIC: &[&[u8]] = &[
        b"\xFF\xD8\xFF",        // JPEG
        b"\x89PNG\r\n\x1a\n",   // PNG
        b"GIF87a",
        b"GIF89a",
        b"II*\0",               // TIFF, little-endian
        b"MM\0*",               // TIFF, big-endian
        b"BM",                  // BMP
    ];
    if IMAGE_MAGIC.iter().any(|m| head.starts_with(m)) || (head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP") {
        return Some(DocKind::Image);
    }
    None
}

/// Decide how to open a file: by extension, then by content for unknown extensions.
pub fn detect_kind(path: &Path) -> Result<DocKind, String> {
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
    if ext.as_deref() == Some("pdf") {
        return Ok(DocKind::Pdf);
    }
    if imagedoc::handles(path) {
        return Ok(DocKind::Image);
    }
    use std::io::Read;
    let mut head = [0u8; 1024];
    let n = std::fs::File::open(path)
        .and_then(|mut f| f.read(&mut head))
        .map_err(|e| crate::errcode::io(&e, format!("Couldn't read the file: {e}")))?;
    sniff_kind(&head[..n]).ok_or_else(|| pdfium::ERR_NOT_SUPPORTED.to_string())
}

impl Docs {
    /// A fresh document id (never reused in this process).
    pub fn alloc_id(&self) -> u64 {
        self.next.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn entry(&self, doc_id: u64) -> Result<EntryRef, String> {
        match self.map.lock().unwrap().get(&doc_id).map(|s| &s.entry) {
            Some(Entry::Pdf) => Ok(EntryRef::Pdf),
            Some(Entry::Image(i)) => Ok(EntryRef::Image(i.clone())),
            None => Err("document not open".into()),
        }
    }

    /// The document's key in the persistent preview cache, if it has one.
    pub fn cache_key(&self, doc_id: u64) -> Option<String> {
        self.map.lock().unwrap().get(&doc_id).and_then(|s| s.cache_key.clone())
    }

    /// Open a PDF or image file. Blocking: call from a worker thread.
    pub fn open(&self, pdf: &PdfiumState, path: &Path, password: Option<&str>) -> Result<DocInfo, String> {
        let file_size = std::fs::metadata(path)
            .map_err(|e| crate::errcode::io(&e, format!("Couldn't read the file: {e}")))?
            .len();
        let doc_id = self.alloc_id();
        let cache_key = crate::previewcache::content_key(path);
        match detect_kind(path)? {
            DocKind::Pdf => {
                let o = pdf.open(doc_id, path, password)?;
                self.map.lock().unwrap().insert(doc_id, Slot { entry: Entry::Pdf, cache_key });
                Ok(DocInfo {
                    doc_id,
                    kind: DocKind::Pdf,
                    num_pages: o.num_pages,
                    sizes: o.sizes,
                    meta: DocMeta { file_size, pdf: o.meta, note: None },
                    workers: pdf.worker_count().unwrap_or(0),
                })
            }
            DocKind::Image => {
                let img = ImageDoc::open(path)?;
                let info = DocInfo {
                    doc_id,
                    kind: DocKind::Image,
                    num_pages: 1,
                    sizes: vec![img.page_size()],
                    meta: DocMeta { file_size, pdf: PdfMeta::default(), note: img.note() },
                    workers: 0,
                };
                self.map.lock().unwrap().insert(doc_id, Slot { entry: Entry::Image(Arc::new(img)), cache_key });
                Ok(info)
            }
        }
    }

    /// Register a PDF held in memory (e.g. a composed print job) as a document that renders,
    /// prints and closes like any other. Blocking.
    pub fn open_pdf_bytes(&self, pdf: &PdfiumState, bytes: Vec<u8>) -> Result<DocInfo, String> {
        let doc_id = self.alloc_id();
        let file_size = bytes.len() as u64;
        let o = pdf.open_memory(doc_id, Arc::new(bytes), None)?;
        self.map.lock().unwrap().insert(doc_id, Slot { entry: Entry::Pdf, cache_key: None });
        Ok(DocInfo {
            doc_id,
            kind: DocKind::Pdf,
            num_pages: o.num_pages,
            sizes: o.sizes,
            meta: DocMeta { file_size, pdf: o.meta, note: None },
            workers: pdf.worker_count().unwrap_or(0),
        })
    }

    pub fn kind(&self, doc_id: u64) -> Option<DocKind> {
        self.entry(doc_id).ok().map(|e| match e {
            EntryRef::Pdf => DocKind::Pdf,
            EntryRef::Image(_) => DocKind::Image,
        })
    }

    pub fn close(&self, pdf: &PdfiumState, doc_id: u64) {
        match self.map.lock().unwrap().remove(&doc_id).map(|s| s.entry) {
            Some(Entry::Pdf) => pdf.close(doc_id),
            Some(Entry::Image(_)) | None => {}
        }
    }

    /// Render a region as one RGBA buffer; None if cancelled.
    pub fn render(&self, pdf: &PdfiumState, doc_id: u64, a: RegionArgs) -> Result<Option<Vec<u8>>, String> {
        match self.entry(doc_id)? {
            EntryRef::Pdf => pdf.render(doc_id, a),
            EntryRef::Image(img) => render_image(&img, &a).map(Some),
        }
    }

    /// Render a region band by band (see `PdfiumState::render_stream`). Images arrive as one
    /// band. Each buffer has spare capacity for a 16-byte trailer, so callers can append one
    /// without reallocating.
    pub fn render_stream(
        &self,
        pdf: &PdfiumState,
        doc_id: u64,
        a: RegionArgs,
        mut on_band: impl FnMut(&BandPart, Vec<u8>) -> bool,
    ) -> Result<Option<usize>, String> {
        match self.entry(doc_id)? {
            EntryRef::Pdf => pdf.render_stream(doc_id, a, on_band),
            EntryRef::Image(img) => {
                let mut buf = render_image(&img, &a)?;
                buf.reserve_exact(STREAM_TRAILER);
                let part = BandPart { band: 0, x: a.x, y: a.y, w: a.w, h: a.h, rx: 0, ry: 0, offset: 0 };
                Ok(Some(on_band(&part, buf) as usize))
            }
        }
    }

    /// Whole page scaled to `max_side` on its longer side: (w, h, RGBA).
    pub fn thumbnail(&self, pdf: &PdfiumState, doc_id: u64, page: usize, max_side: u32) -> Result<(u32, u32, Vec<u8>), String> {
        match self.entry(doc_id)? {
            EntryRef::Pdf => pdf.thumbnail(doc_id, page, max_side),
            EntryRef::Image(img) => img.thumbnail(max_side),
        }
    }

    /// A page's band count if already known (PDFs only; see PdfiumState::known_bands).
    pub fn known_bands(&self, pdf: &PdfiumState, doc_id: u64, page: usize) -> Result<Option<usize>, String> {
        match self.entry(doc_id)? {
            EntryRef::Pdf => Ok(pdf.known_bands(doc_id, page)),
            EntryRef::Image(_) => Ok(None),
        }
    }

    pub fn page_text(&self, pdf: &PdfiumState, doc_id: u64, page: usize) -> Result<String, String> {
        match self.entry(doc_id)? {
            EntryRef::Pdf => pdf.page_text(doc_id, page),
            EntryRef::Image(_) => Ok(String::new()),
        }
    }

    pub fn outline(&self, pdf: &PdfiumState, doc_id: u64) -> Result<Vec<OutlineNode>, String> {
        match self.entry(doc_id)? {
            EntryRef::Pdf => pdf.outline(doc_id),
            EntryRef::Image(_) => Ok(Vec::new()),
        }
    }

    pub fn find_scale(&self, pdf: &PdfiumState, doc_id: u64, page: usize) -> Result<Vec<ScaleCandidate>, String> {
        match self.entry(doc_id)? {
            EntryRef::Pdf => pdf.find_scale(doc_id, page),
            EntryRef::Image(_) => Ok(Vec::new()),
        }
    }

    /// The page's characters, boxes and links (`text::encode_layer`); an empty layer for images.
    pub fn text_layer(&self, pdf: &PdfiumState, doc_id: u64, page: usize) -> Result<Vec<u8>, String> {
        match self.entry(doc_id)? {
            EntryRef::Pdf => pdf.text_layer(doc_id, page),
            EntryRef::Image(_) => Ok(crate::text::encode_layer(&[], &[], &[], &[])),
        }
    }

    /// A page's frame (images: their own size, no rotation).
    pub fn page_frame(&self, pdf: &PdfiumState, doc_id: u64, page: usize) -> Result<crate::text::FrameInfo, String> {
        match self.entry(doc_id)? {
            EntryRef::Pdf => pdf.page_frame(doc_id, page),
            EntryRef::Image(_) => Err("images have no PDF page".into()),
        }
    }

    /// Hide or show annotations by /NM or by position in /Annots (PDFs only).
    pub fn hide_annots(&self, pdf: &PdfiumState, doc_id: u64, page: usize, nms: Vec<String>, indices: Vec<usize>, hidden: bool) -> Result<usize, String> {
        match self.entry(doc_id)? {
            EntryRef::Pdf => pdf.hide_annots(doc_id, page, nms, indices, hidden),
            EntryRef::Image(_) => Ok(0),
        }
    }

    /// Search hits on one page (none for images).
    pub fn search_page(
        &self, pdf: &PdfiumState, doc_id: u64, page: usize, query: String, match_case: bool, whole_word: bool,
    ) -> Result<crate::text::PageHits, String> {
        match self.entry(doc_id)? {
            EntryRef::Pdf => pdf.search_page(doc_id, page, query, match_case, whole_word),
            EntryRef::Image(_) => Ok(crate::text::PageHits { chars: 0, hits: Vec::new(), truncated: false }),
        }
    }
}

/// Bytes reserved after each streamed band for the command's trailer.
pub const STREAM_TRAILER: usize = 16;

enum EntryRef {
    Pdf,
    Image(Arc<ImageDoc>),
}

fn render_image(img: &ImageDoc, a: &RegionArgs) -> Result<Vec<u8>, String> {
    if a.w <= 0 || a.h <= 0 {
        return Err("empty region".into());
    }
    let stride = a.w as usize * 4;
    let mut buf = Vec::with_capacity(stride * a.h as usize + STREAM_TRAILER);
    buf.resize(stride * a.h as usize, 0xFF);
    img.render_region(a.rs, a.x, a.y, a.w, a.h, &mut buf, stride)?;
    Ok(buf)
}
