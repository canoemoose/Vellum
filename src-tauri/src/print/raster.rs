//! Rendering a composed job's sheets, one band at a time, on one PDFium worker.
//!
//! The composed PDF is opened privately on one worker (not registered with the viewer's
//! document registry): printing renders one sheet at a time at 300 or 600 dpi, and a sheet
//! carrying a heavy drawing decodes its images once, on one instance, and frees them when
//! the sheet is done (`release`). Registering it with `Docs` would have every worker parse
//! and cache every sheet.
//!
//! Each band is one [`PdfiumState::run_on_worker_index`] call, so the viewer's own renders on
//! that worker interleave with printing instead of waiting for the whole job. The handles
//! live in a thread-local on that worker between calls, which is why every call for a job
//! goes to the same worker index.

use crate::pdfium::PdfiumState;
use pdfium_render::prelude::*;
use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_int;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

const FPDF_BITMAP_BGRX: c_int = 3;
pub const FPDF_PRINTING: c_int = 0x800;
pub const FPDF_GRAYSCALE: c_int = 0x08;

struct Private {
    /// Keeps the bytes PDFium reads from alive.
    _bytes: Arc<Vec<u8>>,
    doc: FPDF_DOCUMENT,
    page: Option<(usize, FPDF_PAGE)>,
}

/// A PDF being written on the same worker (Save as PDF in Greyscale or Black lines).
struct Out {
    doc: FPDF_DOCUMENT,
    page: Option<(FPDF_PAGE, f64)>,
    pages: c_int,
}

thread_local! {
    static OPEN: RefCell<HashMap<u64, Private>> = RefCell::new(HashMap::new());
    static OUT: RefCell<HashMap<u64, Out>> = RefCell::new(HashMap::new());
}

/// Finish the page being written: generate its content and close it.
fn end_out_page(b: &dyn PdfiumLibraryBindings, o: &mut Out) -> Result<(), String> {
    if let Some((page, _)) = o.page.take() {
        let ok = unsafe { b.FPDFPage_GenerateContent(page) } != 0;
        unsafe { b.FPDF_ClosePage(page) };
        if !ok {
            return Err("Couldn't write a sheet".into());
        }
    }
    Ok(())
}

static NEXT_KEY: AtomicU64 = AtomicU64::new(1);

/// A composed PDF open on one worker for band rendering. Closed on drop.
pub struct SheetRenderer {
    pdf: PdfiumState,
    worker: usize,
    key: u64,
    pub sheets: usize,
}

impl SheetRenderer {
    pub fn open(pdf: &PdfiumState, bytes: Arc<Vec<u8>>) -> Result<SheetRenderer, String> {
        let key = NEXT_KEY.fetch_add(1, Ordering::Relaxed);
        let n = pdf.worker_count()?;
        let worker = (key as usize) % n;
        let sheets = pdf.run_on_worker_index(worker, move |ctx| {
            let b = ctx.bindings();
            let doc = unsafe { b.FPDF_LoadMemDocument64(&bytes, None) };
            if doc.is_null() {
                return Err("Couldn't read the composed print document".to_string());
            }
            let count = unsafe { b.FPDF_GetPageCount(doc) }.max(0) as usize;
            OPEN.with(|m| m.borrow_mut().insert(key, Private { _bytes: bytes, doc, page: None }));
            Ok(count)
        })??;
        Ok(SheetRenderer { pdf: pdf.clone(), worker, key, sheets })
    }

    /// Run `f` with sheet `index` loaded (kept loaded for the next call on the same sheet).
    fn with_page<R: Send + 'static>(
        &self,
        index: usize,
        f: impl for<'a> FnOnce(&'a dyn PdfiumLibraryBindings, FPDF_PAGE) -> Result<R, String> + Send + 'static,
    ) -> Result<R, String> {
        let key = self.key;
        self.pdf.run_on_worker_index(self.worker, move |ctx| {
            let b = ctx.bindings();
            OPEN.with(|m| {
                let mut m = m.borrow_mut();
                let p = m.get_mut(&key).ok_or("print document closed")?;
                let page = match p.page {
                    Some((i, page)) if i == index => page,
                    other => {
                        if let Some((_, old)) = other {
                            unsafe { b.FPDF_ClosePage(old) };
                            p.page = None;
                        }
                        let page = unsafe { b.FPDF_LoadPage(p.doc, index as c_int) };
                        if page.is_null() {
                            return Err(format!("Couldn't read sheet {}", index + 1));
                        }
                        p.page = Some((index, page));
                        page
                    }
                };
                f(b, page)
            })
        })?
    }

    /// Render the part of sheet `index` at (x, y, w, h) device pixels of the whole sheet
    /// drawn at `full_w` x `full_h`. Returns BGRx rows of `w * 4` bytes on white.
    #[allow(clippy::too_many_arguments)]
    pub fn render_band(&self, index: usize, full_w: i32, full_h: i32, x: i32, y: i32, w: i32, h: i32, flags: c_int) -> Result<Vec<u8>, String> {
        if w <= 0 || h <= 0 {
            return Ok(Vec::new());
        }
        self.with_page(index, move |b, page| {
            let stride = w as usize * 4;
            let mut buf = vec![0xFFu8; stride * h as usize];
            unsafe {
                let bmp = b.FPDFBitmap_CreateEx(w, h, FPDF_BITMAP_BGRX, buf.as_mut_ptr() as *mut _, stride as c_int);
                if bmp.is_null() {
                    return Err("Out of memory rendering a sheet".into());
                }
                b.FPDF_RenderPageBitmap(bmp, page, -x, -y, full_w, full_h, 0, flags);
                b.FPDFBitmap_Destroy(bmp);
            }
            Ok(buf)
        })
    }

    /// Render sheet `index` straight to a device context (the Vector path).
    #[cfg(windows)]
    #[allow(clippy::too_many_arguments)]
    pub fn render_to_dc(&self, index: usize, hdc: usize, x: i32, y: i32, w: i32, h: i32, flags: c_int) -> Result<(), String> {
        self.with_page(index, move |b, page| {
            let dc = windows::Win32::Graphics::Gdi::HDC(hdc as *mut _);
            unsafe { b.FPDF_RenderPage(dc, page, x, y, w, h, 0, flags) };
            Ok(())
        })
    }

    /// Start writing a new PDF on this renderer's worker (out_page, out_image, out_finish).
    pub fn out_begin(&self) -> Result<(), String> {
        let key = self.key;
        self.pdf.run_on_worker_index(self.worker, move |ctx| {
            let b = ctx.bindings();
            let doc = unsafe { b.FPDF_CreateNewDocument() };
            if doc.is_null() {
                return Err("Couldn't create the PDF".to_string());
            }
            OUT.with(|m| m.borrow_mut().insert(key, Out { doc, page: None, pages: 0 }));
            Ok(())
        })?
    }

    /// Start a new page of `w` x `h` points in the PDF being written.
    pub fn out_page(&self, w: f64, h: f64) -> Result<(), String> {
        let key = self.key;
        self.pdf.run_on_worker_index(self.worker, move |ctx| {
            let b = ctx.bindings();
            OUT.with(|m| {
                let mut m = m.borrow_mut();
                let o = m.get_mut(&key).ok_or("PDF closed")?;
                end_out_page(b, o)?;
                let page = unsafe { b.FPDFPage_New(o.doc, o.pages, w, h) };
                if page.is_null() {
                    return Err("Couldn't add a sheet".to_string());
                }
                o.pages += 1;
                o.page = Some((page, h));
                Ok(())
            })
        })?
    }

    /// Place a JPEG on the current page at (x, y) w x h points, y down from the top.
    pub fn out_image(&self, jpeg: Vec<u8>, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
        let key = self.key;
        self.pdf.run_on_worker_index(self.worker, move |ctx| {
            let b = ctx.bindings();
            OUT.with(|m| {
                let mut m = m.borrow_mut();
                let o = m.get_mut(&key).ok_or("PDF closed")?;
                let (page, page_h) = o.page.ok_or("No sheet started")?;
                unsafe {
                    let obj = b.FPDFPageObj_NewImageObj(o.doc);
                    let mut acc = FPDF_FILEACCESS {
                        m_FileLen: jpeg.len() as std::ffi::c_ulong,
                        m_GetBlock: Some(super::compose::get_block),
                        m_Param: &jpeg as *const Vec<u8> as *mut std::ffi::c_void,
                    };
                    let mut pages = [page];
                    if b.FPDFImageObj_LoadJpegFileInline(pages.as_mut_ptr(), 1, obj, &mut acc) == 0 {
                        b.FPDFPageObj_Destroy(obj);
                        return Err("Couldn't write a sheet".to_string());
                    }
                    let mtx = FS_MATRIX { a: w as f32, b: 0.0, c: 0.0, d: h as f32, e: x as f32, f: (page_h - y - h) as f32 };
                    b.FPDFPageObj_SetMatrix(obj, &mtx);
                    b.FPDFPage_InsertObject(page, obj);
                }
                Ok(())
            })
        })?
    }

    /// Finish the PDF being written and return its bytes.
    pub fn out_finish(&self) -> Result<Vec<u8>, String> {
        let key = self.key;
        self.pdf.run_on_worker_index(self.worker, move |ctx| {
            let b = ctx.bindings();
            OUT.with(|m| {
                let mut o = m.borrow_mut().remove(&key).ok_or("PDF closed")?;
                let done = end_out_page(b, &mut o).and_then(|_| super::compose::save(b, o.doc));
                unsafe { b.FPDF_CloseDocument(o.doc) };
                done
            })
        })?
    }

    /// Free the loaded sheet and its decoded images.
    pub fn release(&self) {
        let key = self.key;
        let _ = self.pdf.run_on_worker_index(self.worker, move |ctx| {
            let b = ctx.bindings();
            OPEN.with(|m| {
                if let Some(p) = m.borrow_mut().get_mut(&key) {
                    if let Some((_, page)) = p.page.take() {
                        unsafe { b.FPDF_ClosePage(page) };
                    }
                }
            })
        });
    }
}

impl Drop for SheetRenderer {
    fn drop(&mut self) {
        let key = self.key;
        let _ = self.pdf.run_on_worker_index(self.worker, move |ctx| {
            let b = ctx.bindings();
            OPEN.with(|m| {
                if let Some(p) = m.borrow_mut().remove(&key) {
                    unsafe {
                        if let Some((_, page)) = p.page {
                            b.FPDF_ClosePage(page);
                        }
                        b.FPDF_CloseDocument(p.doc);
                    }
                }
            });
            // A PDF left unfinished (an error part way): close it.
            OUT.with(|m| {
                if let Some(o) = m.borrow_mut().remove(&key) {
                    unsafe {
                        if let Some((page, _)) = o.page {
                            b.FPDF_ClosePage(page);
                        }
                        b.FPDF_CloseDocument(o.doc);
                    }
                }
            })
        });
    }
}
