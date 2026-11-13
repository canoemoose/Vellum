//! Compose a print job into a new PDF with PDFium.
//!
//! Every placed page becomes a form XObject (`FPDF_NewXObjectFromPage`), placed with
//! `FPDF_NewFormObjectFromXObject` and a transform, so vectors stay vectors and the output
//! doubles as Save as PDF. One XObject per (source page, crop) per job: a page tiled across
//! nine sheets is copied into the output once and referenced nine times.
//!
//! - Sources are opened privately by path on the worker that composes (and closed after),
//!   so cropping (`FPDFPage_SetCropBox`, which is what bounds the XObject) and flattening
//!   annotations into the page content never touch the documents the viewer renders.
//!   A password-protected PDF can't be reopened without its password; it falls back to the
//!   worker's shared handle, crops are restored afterwards and annotations are not flattened.
//! - Images go through a one-page scratch PDF holding the image object, then the same path:
//!   JPEGs without an EXIF rotation are embedded as they are (`FPDFImageObj_LoadJpegFileInline`),
//!   everything else is decoded and embedded as a bitmap.
//! - A sheet clip (tiles) wraps the items in `q <rect> W n ... Q` with
//!   `FPDFPage_TransFormWithClip`; lines and text added afterwards land outside it.
//!
//! All of it runs inside one [`PdfiumState::run_on_worker`] call.

use super::job::{self, Item, Job, Rect};
use crate::pdfium::{PdfiumState, WorkerCtx};
use pdfium_render::prelude::*;
use std::collections::HashMap;
use std::ffi::{c_int, c_uchar, c_ulong, c_void};

const FLAT_PRINT: c_int = 1;
const FPDF_FILLMODE_NONE: c_int = 0;

/// Image data prepared off the PDFium worker.
pub enum ImageData {
    /// A JPEG file's bytes, embedded as is.
    Jpeg(Vec<u8>),
    /// Decoded pixels, BGR, tightly packed rows of w * 3 bytes.
    Bgr { w: u32, h: u32, px: Vec<u8> },
}

/// Read or decode an image item's file. Blocking; call off the PDFium workers.
pub fn prepare_image(path: &str) -> Result<ImageData, String> {
    use image::{ImageDecoder, ImageReader};
    let bytes = std::fs::read(path).map_err(|e| crate::errcode::io(&e, format!("Couldn't read {path}: {e}")))?;
    let is_jpeg = bytes.starts_with(b"\xFF\xD8\xFF");
    if is_jpeg {
        // Only embed the file as is when no EXIF rotation applies and it decodes as 8-bit
        // RGB or grey (CMYK JPEGs are inverted by some writers; decode those instead).
        let ok = ImageReader::new(std::io::Cursor::new(&bytes))
            .with_guessed_format()
            .ok()
            .and_then(|r| r.into_decoder().ok())
            .map(|mut d| {
                let o = d.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
                o == image::metadata::Orientation::NoTransforms
                    && matches!(d.color_type(), image::ColorType::Rgb8 | image::ColorType::L8)
                    && !jpeg_is_cmyk(&bytes)
            })
            .unwrap_or(false);
        if ok {
            return Ok(ImageData::Jpeg(bytes));
        }
    }
    let doc = crate::imagedoc::ImageDoc::from_bytes(&bytes)?;
    let (w, _) = doc.pixel_size();
    let ps = doc.page_size();
    // One device pixel per stored pixel: rs = pixels per point.
    let rs = w as f64 / ps.w as f64;
    let (bw, bh) = (((ps.w as f64) * rs).ceil() as i32, ((ps.h as f64) * rs).ceil() as i32);
    let stride = bw as usize * 4;
    let mut rgba = vec![0xFFu8; stride * bh as usize];
    doc.render_region(rs, 0, 0, bw, bh, &mut rgba, stride)?;
    drop(doc);
    let mut px = Vec::with_capacity(bw as usize * bh as usize * 3);
    for p in rgba.chunks_exact(4) {
        px.extend_from_slice(&[p[2], p[1], p[0]]);
    }
    Ok(ImageData::Bgr { w: bw as u32, h: bh as u32, px })
}

/// True if the JPEG's frame header has four components (CMYK / YCCK).
fn jpeg_is_cmyk(b: &[u8]) -> bool {
    let mut i = 2;
    while i + 9 < b.len() {
        if b[i] != 0xFF {
            return false;
        }
        let m = b[i + 1];
        let len = u16::from_be_bytes([b[i + 2], b[i + 3]]) as usize;
        if (0xC0..=0xCF).contains(&m) && m != 0xC4 && m != 0xC8 && m != 0xCC {
            return b[i + 9] == 4;
        }
        i += 2 + len;
    }
    false
}

/// Compose the job into PDF bytes. `images` maps an image item's path to its prepared data.
pub fn compose(pdf: &PdfiumState, job: Job, images: HashMap<String, ImageData>) -> Result<Vec<u8>, String> {
    job::validate(&job)?;
    pdf.run_on_worker(move |ctx| compose_on_worker(ctx, &job, &images))?
}

/// A source document open for this job.
struct Source {
    doc: FPDF_DOCUMENT,
    /// Opened privately (closed at the end) rather than the worker's shared handle.
    private: bool,
    /// Image scratch documents keep their one page loaded.
    page: Option<FPDF_PAGE>,
}

struct Composer<'a> {
    b: &'a dyn PdfiumLibraryBindings,
    dest: FPDF_DOCUMENT,
    /// Keyed by document id.
    sources: HashMap<u64, Source>,
    /// Keyed by (document id, page, crop rounded to 1/100 pt).
    xobjects: HashMap<(u64, usize, Option<[i64; 4]>), FPDF_XOBJECT>,
}

impl Drop for Composer<'_> {
    fn drop(&mut self) {
        unsafe {
            for (_, x) in self.xobjects.drain() {
                self.b.FPDF_CloseXObject(x);
            }
            for (_, s) in self.sources.drain() {
                if let Some(p) = s.page {
                    self.b.FPDF_ClosePage(p);
                }
                if s.private {
                    self.b.FPDF_CloseDocument(s.doc);
                }
            }
            if !self.dest.is_null() {
                self.b.FPDF_CloseDocument(self.dest);
            }
        }
    }
}

fn compose_on_worker(ctx: &mut WorkerCtx, job: &Job, images: &HashMap<String, ImageData>) -> Result<Vec<u8>, String> {
    let b = ctx.bindings();
    let dest = unsafe { b.FPDF_CreateNewDocument() };
    if dest.is_null() {
        return Err("Couldn't create the print document".into());
    }
    let mut c = Composer { b, dest, sources: HashMap::new(), xobjects: HashMap::new() };
    for (si, sheet) in job.sheets.iter().enumerate() {
        let page = unsafe { b.FPDFPage_New(dest, si as c_int, sheet.w, sheet.h) };
        if page.is_null() {
            return Err("Couldn't add a sheet to the print document".into());
        }
        let r = (|| -> Result<(), String> {
            for item in &sheet.items {
                let xo = c.xobject(ctx, item, images)?;
                let (cw, ch) = job::item_display_size(item);
                // The XObject's real displayed size may differ by rounding from the model's;
                // place it by the model's numbers so the preview and the output agree.
                let m = job::item_matrix(cw, ch, item.scale, item.rotation, item.x, item.y, sheet.h);
                unsafe {
                    let obj = b.FPDF_NewFormObjectFromXObject(xo);
                    if obj.is_null() {
                        return Err("Couldn't place a page on the sheet".into());
                    }
                    b.FPDFPageObj_Transform(obj, m[0], m[1], m[2], m[3], m[4], m[5]);
                    b.FPDFPage_InsertObject(page, obj);
                }
            }
            if let Some(clip) = sheet.clip {
                unsafe {
                    if b.FPDFPage_GenerateContent(page) == 0 {
                        return Err("Couldn't write the sheet".into());
                    }
                    let (l, bo, r, t) = job::sheet_rect_to_pdf(&clip, sheet.h);
                    let id = FS_MATRIX { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };
                    let rect = FS_RECTF { left: l as f32, top: t as f32, right: r as f32, bottom: bo as f32 };
                    b.FPDFPage_TransFormWithClip(page, &id, &rect);
                }
            }
            for l in &sheet.lines {
                unsafe {
                    let p = b.FPDFPageObj_CreateNewPath(l.x0 as f32, (sheet.h - l.y0) as f32);
                    b.FPDFPath_LineTo(p, l.x1 as f32, (sheet.h - l.y1) as f32);
                    b.FPDFPageObj_SetStrokeColor(p, 0, 0, 0, 255);
                    b.FPDFPageObj_SetStrokeWidth(p, l.width.max(0.1) as f32);
                    b.FPDFPath_SetDrawMode(p, FPDF_FILLMODE_NONE, 1);
                    b.FPDFPage_InsertObject(page, p);
                }
            }
            for t in &sheet.texts {
                if t.text.is_empty() {
                    continue;
                }
                unsafe {
                    let o = b.FPDFPageObj_NewTextObj(dest, "Helvetica", t.size as f32);
                    if o.is_null() {
                        continue;
                    }
                    b.FPDFText_SetText_str(o, &t.text);
                    b.FPDFPageObj_SetFillColor(o, 0, 0, 0, 255);
                    b.FPDFPageObj_Transform(o, 1.0, 0.0, 0.0, 1.0, t.x, sheet.h - t.y);
                    b.FPDFPage_InsertObject(page, o);
                }
            }
            if unsafe { b.FPDFPage_GenerateContent(page) } == 0 {
                return Err("Couldn't write the sheet".into());
            }
            Ok(())
        })();
        unsafe { b.FPDF_ClosePage(page) };
        r?;
    }
    save(b, dest)
}

impl Composer<'_> {
    fn source(&mut self, ctx: &mut WorkerCtx, item: &Item, images: &HashMap<String, ImageData>) -> Result<(FPDF_DOCUMENT, bool), String> {
        if let Some(s) = self.sources.get(&item.doc_id) {
            return Ok((s.doc, s.private));
        }
        let b = self.b;
        let path = item.path.as_deref();
        let src = if let Some(img) = path.and_then(|p| images.get(p)) {
            image_source(b, img, item.src_w, item.src_h)?
        } else {
            // A private copy, so crops and flattening stay out of the viewer's documents.
            let private = path.map(|p| unsafe { b.FPDF_LoadDocument(p, None) }).filter(|d| !d.is_null());
            match private {
                Some(doc) => Source { doc, private: true, page: None },
                None => {
                    let doc = ctx.document(item.doc_id).ok_or("A document in the layout is no longer open")?;
                    Source { doc, private: false, page: None }
                }
            }
        };
        let r = (src.doc, src.private);
        self.sources.insert(item.doc_id, src);
        Ok(r)
    }

    fn xobject(&mut self, ctx: &mut WorkerCtx, item: &Item, images: &HashMap<String, ImageData>) -> Result<FPDF_XOBJECT, String> {
        let key = (item.doc_id, item.page, item.crop.map(|c| [c.x0, c.y0, c.x1, c.y1].map(|v| (v * 100.0).round() as i64)));
        if let Some(&x) = self.xobjects.get(&key) {
            return Ok(x);
        }
        let (doc, private) = self.source(ctx, item, images)?;
        let b = self.b;
        let idx = item.page as c_int;
        if idx < 0 || idx >= unsafe { b.FPDF_GetPageCount(doc) } {
            return Err(format!("Page {} doesn't exist", item.page + 1));
        }
        let scratch_page = self.sources.get(&item.doc_id).and_then(|s| s.page);
        let xo = unsafe {
            // A page we load here is ours to close; image scratch pages and the worker's cached
            // pages are not.
            let (page, owned) = match scratch_page {
                Some(p) => (p, false),
                None if private => (b.FPDF_LoadPage(doc, idx), true),
                None => (ctx.page(item.doc_id, item.page)?, false),
            };
            if page.is_null() {
                return Err(format!("Couldn't read page {}", item.page + 1));
            }
            if private && owned && b.FPDFPage_GetAnnotCount(page) > 0 {
                // Annotations aren't part of an XObject made from a page; bake them in so the
                // print matches the screen (the viewer renders them).
                b.FPDFPage_Flatten(page, FLAT_PRINT);
                b.FPDF_ClosePage(page);
                let p2 = b.FPDF_LoadPage(doc, idx);
                if p2.is_null() {
                    return Err(format!("Couldn't read page {}", item.page + 1));
                }
                let x = make_xobject(b, self.dest, doc, idx, p2, item.crop.as_ref());
                b.FPDF_ClosePage(p2);
                x
            } else {
                let x = make_xobject(b, self.dest, doc, idx, page, item.crop.as_ref());
                if owned {
                    b.FPDF_ClosePage(page);
                }
                x
            }
        }?;
        self.xobjects.insert(key, xo);
        Ok(xo)
    }
}

/// Make the XObject for one page, cropped if asked. The crop box is put back afterwards: the
/// same page may be placed again with another crop, and shared handles belong to the viewer.
unsafe fn make_xobject(
    b: &dyn PdfiumLibraryBindings,
    dest: FPDF_DOCUMENT,
    doc: FPDF_DOCUMENT,
    idx: c_int,
    page: FPDF_PAGE,
    crop: Option<&Rect>,
) -> Result<FPDF_XOBJECT, String> {
    unsafe {
        let mut restore = None;
        if let Some(crop) = crop {
            let mut r = FS_RECTF { left: 0.0, top: 0.0, right: 0.0, bottom: 0.0 };
            if b.FPDF_GetPageBoundingBox(page, &mut r) == 0 {
                return Err("Couldn't read the page size".into());
            }
            let bbox = (r.left as f64, r.bottom as f64, r.right as f64, r.top as f64);
            let rot = b.FPDFPage_GetRotation(page);
            let (l, bo, rr, t) = job::crop_to_user(bbox, rot, crop).ok_or("The crop is outside the page")?;
            b.FPDFPage_SetCropBox(page, l as f32, bo as f32, rr as f32, t as f32);
            restore = Some(r);
        }
        let xo = b.FPDF_NewXObjectFromPage(dest, doc, idx);
        if let Some(r) = restore {
            b.FPDFPage_SetCropBox(page, r.left, r.bottom, r.right, r.top);
        }
        if xo.is_null() { Err("Couldn't copy a page into the print document".into()) } else { Ok(xo) }
    }
}

/// A one-page scratch document showing an image at its page size.
fn image_source(b: &dyn PdfiumLibraryBindings, img: &ImageData, w: f64, h: f64) -> Result<Source, String> {
    unsafe {
        let doc = b.FPDF_CreateNewDocument();
        if doc.is_null() {
            return Err("Couldn't create the print document".into());
        }
        let fail = |msg: &str| -> Result<Source, String> {
            b.FPDF_CloseDocument(doc);
            Err(msg.to_string())
        };
        let page = b.FPDFPage_New(doc, 0, w, h);
        if page.is_null() {
            return fail("Couldn't add an image");
        }
        let obj = b.FPDFPageObj_NewImageObj(doc);
        let ok = match img {
            ImageData::Jpeg(bytes) => {
                let mut acc = FPDF_FILEACCESS {
                    m_FileLen: bytes.len() as c_ulong,
                    m_GetBlock: Some(get_block),
                    m_Param: bytes as *const Vec<u8> as *mut c_void,
                };
                let mut pages = [page];
                b.FPDFImageObj_LoadJpegFileInline(pages.as_mut_ptr(), 1, obj, &mut acc) != 0
            }
            ImageData::Bgr { w: pw, h: ph, px } => {
                const FPDF_BITMAP_BGR: c_int = 2;
                let stride = *pw as c_int * 3;
                let bmp = b.FPDFBitmap_CreateEx(*pw as c_int, *ph as c_int, FPDF_BITMAP_BGR, px.as_ptr() as *mut c_void, stride);
                if bmp.is_null() {
                    false
                } else {
                    let mut pages = [page];
                    let ok = b.FPDFImageObj_SetBitmap(pages.as_mut_ptr(), 1, obj, bmp) != 0;
                    b.FPDFBitmap_Destroy(bmp);
                    ok
                }
            }
        };
        if !ok {
            b.FPDFPageObj_Destroy(obj);
            b.FPDF_ClosePage(page);
            return fail("Couldn't embed an image");
        }
        let m = FS_MATRIX { a: w as f32, b: 0.0, c: 0.0, d: h as f32, e: 0.0, f: 0.0 };
        b.FPDFPageObj_SetMatrix(obj, &m);
        b.FPDFPage_InsertObject(page, obj);
        if b.FPDFPage_GenerateContent(page) == 0 {
            b.FPDF_ClosePage(page);
            return fail("Couldn't embed an image");
        }
        Ok(Source { doc, private: true, page: Some(page) })
    }
}

pub(crate) unsafe extern "C" fn get_block(param: *mut c_void, pos: c_ulong, buf: *mut c_uchar, size: c_ulong) -> c_int {
    unsafe {
        let bytes = &*(param as *const Vec<u8>);
        let (pos, size) = (pos as usize, size as usize);
        if pos + size > bytes.len() {
            return 0;
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr().add(pos), buf, size);
        1
    }
}

#[repr(C)]
struct Writer {
    base: FPDF_FILEWRITE,
    out: Vec<u8>,
}

unsafe extern "C" fn write_block(this: *mut FPDF_FILEWRITE, data: *const c_void, size: c_ulong) -> c_int {
    unsafe {
        let w = &mut *(this as *mut Writer);
        w.out.extend_from_slice(std::slice::from_raw_parts(data as *const u8, size as usize));
        1
    }
}

/// Save a document to bytes (FPDF_SaveAsCopy).
pub fn save(b: &dyn PdfiumLibraryBindings, doc: FPDF_DOCUMENT) -> Result<Vec<u8>, String> {
    let mut w = Writer { base: FPDF_FILEWRITE { version: 1, WriteBlock: Some(write_block) }, out: Vec::new() };
    let ok = unsafe { b.FPDF_SaveAsCopy(doc, &mut w as *mut Writer as *mut FPDF_FILEWRITE, 0) };
    if ok == 0 {
        return Err("Couldn't write the print document".into());
    }
    Ok(w.out)
}
