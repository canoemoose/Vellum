//! PDFium plumbing for the spike: the same `pdfium.dll` the app ships, used to render pages to
//! greyscale for OCR, to read a page's own text layer as the ground truth, and to build the
//! fixtures (a drawing-like page with known text, and image-only "scans" of any page).

use crate::frame::PageFrame;
use pdfium_render::prelude::*;
use std::ffi::{c_int, c_ulong, c_void};
use std::path::PathBuf;

const FPDF_ANNOT: c_int = 0x01;
const FPDFBITMAP_GRAY: c_int = 1;
const FPDFBITMAP_BGRX: c_int = 2;

pub struct Pdfium {
    pub b: Box<dyn PdfiumLibraryBindings>,
}

/// `VELLUM_PDFIUM_DLL`, else the first `src-tauri/pdfium/bin/pdfium.dll` above this crate
/// (a worktree has none of its own; the main checkout's is found further up).
pub fn find_dll() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("VELLUM_PDFIUM_DLL") {
        return Some(PathBuf::from(p));
    }
    let mut dir = Some(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf());
    while let Some(d) = dir {
        let p = d.join("src-tauri/pdfium/bin/pdfium.dll");
        if p.exists() {
            return Some(p);
        }
        dir = d.parent().map(|p| p.to_path_buf());
    }
    None
}

impl Pdfium {
    pub fn load() -> Result<Self, String> {
        let dll = find_dll().ok_or("pdfium.dll not found (run node tools/fetch-pdfium.mjs, or set VELLUM_PDFIUM_DLL)")?;
        let b = pdfium_render::prelude::Pdfium::bind_to_library(&dll).map_err(|e| format!("could not load {}: {e:?}", dll.display()))?;
        unsafe { b.FPDF_InitLibrary() };
        Ok(Self { b })
    }

    pub fn open(&self, bytes: Vec<u8>) -> Result<Doc<'_>, String> {
        let h = unsafe { self.b.FPDF_LoadMemDocument64(&bytes, None) };
        if h.is_null() {
            return Err(format!("PDFium could not open it (error {})", unsafe { self.b.FPDF_GetLastError() }));
        }
        Ok(Doc { b: &*self.b, h, _bytes: bytes })
    }

    pub fn new_doc(&self) -> Doc<'_> {
        Doc { b: &*self.b, h: unsafe { self.b.FPDF_CreateNewDocument() }, _bytes: Vec::new() }
    }
}

pub struct Doc<'a> {
    pub b: &'a dyn PdfiumLibraryBindings,
    pub h: FPDF_DOCUMENT,
    _bytes: Vec<u8>,
}

impl Drop for Doc<'_> {
    fn drop(&mut self) {
        unsafe { self.b.FPDF_CloseDocument(self.h) };
    }
}

pub struct Page<'a> {
    pub b: &'a dyn PdfiumLibraryBindings,
    pub h: FPDF_PAGE,
}

impl Drop for Page<'_> {
    fn drop(&mut self) {
        unsafe { self.b.FPDF_ClosePage(self.h) };
    }
}

/// An 8-bit greyscale image, rows top to bottom.
pub struct Gray {
    pub w: u32,
    pub h: u32,
    pub stride: usize,
    pub px: Vec<u8>,
}

pub use crate::geom::TruthWord;

impl Doc<'_> {
    pub fn page_count(&self) -> usize {
        unsafe { self.b.FPDF_GetPageCount(self.h).max(0) as usize }
    }

    pub fn page(&self, i: usize) -> Result<Page<'_>, String> {
        let h = unsafe { self.b.FPDF_LoadPage(self.h, i as c_int) };
        if h.is_null() { Err(format!("could not load page {}", i + 1)) } else { Ok(Page { b: self.b, h }) }
    }

    pub fn save(&self) -> Result<Vec<u8>, String> {
        #[repr(C)]
        struct W {
            base: FPDF_FILEWRITE,
            out: Vec<u8>,
        }
        unsafe extern "C" fn write_block(this: *mut FPDF_FILEWRITE, data: *const c_void, size: c_ulong) -> c_int {
            unsafe {
                let w = &mut *(this as *mut W);
                w.out.extend_from_slice(std::slice::from_raw_parts(data as *const u8, size as usize));
            }
            1
        }
        let mut w = W { base: FPDF_FILEWRITE { version: 1, WriteBlock: Some(write_block) }, out: Vec::new() };
        let ok = unsafe { self.b.FPDF_SaveAsCopy(self.h, &mut w as *mut W as *mut FPDF_FILEWRITE, 0) };
        if ok == 0 { Err("FPDF_SaveAsCopy failed".into()) } else { Ok(w.out) }
    }
}

impl Page<'_> {
    /// The page as displayed (/Rotate applied), points.
    pub fn size(&self) -> (f32, f32) {
        unsafe { (self.b.FPDF_GetPageWidthF(self.h), self.b.FPDF_GetPageHeightF(self.h)) }
    }

    /// As `text::page_frame` in the app.
    pub fn frame(&self) -> PageFrame {
        let b = self.b;
        let mut r = FS_RECTF { left: 0.0, top: 0.0, right: 0.0, bottom: 0.0 };
        let ok = unsafe { b.FPDF_GetPageBoundingBox(self.h, &mut r) } != 0;
        let rot = unsafe { b.FPDFPage_GetRotation(self.h) };
        if ok {
            PageFrame::new(rot, r.left as f64, r.bottom as f64, r.right as f64, r.top as f64)
        } else {
            let (w, h) = self.size();
            let (w, h) = if rot % 2 == 1 { (h, w) } else { (w, h) };
            PageFrame::new(rot, 0.0, 0.0, w as f64, h as f64)
        }
    }

    /// Characters in the page's text layer (0 for a scan).
    pub fn char_count(&self) -> usize {
        let tp = unsafe { self.b.FPDFText_LoadPage(self.h) };
        if tp.is_null() {
            return 0;
        }
        let n = unsafe { self.b.FPDFText_CountChars(tp) }.max(0) as usize;
        unsafe { self.b.FPDFText_ClosePage(tp) };
        n
    }

    /// Size in pixels of the whole page rendered at `scale` px per point, turned by
    /// `quarter_turns` clockwise.
    pub fn pixel_size(&self, scale: f64, quarter_turns: i32) -> (u32, u32) {
        let (w, h) = self.size();
        let (w, h) = ((w as f64 * scale).round() as u32, (h as f64 * scale).round() as u32);
        if quarter_turns % 2 == 1 { (h, w) } else { (w, h) }
    }

    /// Render the `[x, y, w, h]` pixel region of the page (at `scale` px per point, turned
    /// `quarter_turns` clockwise) to greyscale on white.
    pub fn render_gray(&self, scale: f64, quarter_turns: i32, region: [u32; 4]) -> Result<Gray, String> {
        let b = self.b;
        let (fw, fh) = self.pixel_size(scale, quarter_turns);
        let [x, y, w, h] = region;
        let stride = (w as usize + 3) & !3;
        let mut px = vec![0u8; stride * h as usize];
        unsafe {
            let bmp = b.FPDFBitmap_CreateEx(w as c_int, h as c_int, FPDFBITMAP_GRAY, px.as_mut_ptr() as *mut c_void, stride as c_int);
            if bmp.is_null() {
                return Err("could not create bitmap".into());
            }
            b.FPDFBitmap_FillRect(bmp, 0, 0, w as c_int, h as c_int, 0xFFFF_FFFF);
            b.FPDF_RenderPageBitmap(bmp, self.h, -(x as c_int), -(y as c_int), fw as c_int, fh as c_int, quarter_turns, FPDF_ANNOT);
            b.FPDFBitmap_Destroy(bmp);
        }
        Ok(Gray { w, h, stride, px })
    }

    /// The page's own text, as words (split at white space and line breaks) with boxes in
    /// page points, font size and angle.
    pub fn truth_words(&self) -> Vec<TruthWord> {
        let b = self.b;
        let frame = self.frame();
        let tp = unsafe { b.FPDFText_LoadPage(self.h) };
        if tp.is_null() {
            return Vec::new();
        }
        let n = unsafe { b.FPDFText_CountChars(tp) }.max(0);
        let mut out = Vec::new();
        let mut cur: Option<TruthWord> = None;
        let rot_deg = frame.quarter_turns as f32 * 90.0;
        for i in 0..n {
            let code = unsafe { b.FPDFText_GetUnicode(tp, i) };
            let ch = char::from_u32(code).unwrap_or(' ');
            let mut r = FS_RECTF { left: 0.0, top: 0.0, right: 0.0, bottom: 0.0 };
            let has = unsafe { b.FPDFText_GetLooseCharBox(tp, i, &mut r) } != 0 && (r.right - r.left).abs() > 1e-4;
            if ch.is_whitespace() || ch.is_control() || !has {
                if let Some(w) = cur.take() {
                    out.push(w);
                }
                continue;
            }
            let rect = frame.rect(r.left as f64, r.bottom as f64, r.right as f64, r.top as f64);
            match cur.as_mut() {
                Some(w) => {
                    w.text.push(ch);
                    w.rect = [w.rect[0].min(rect[0]), w.rect[1].min(rect[1]), w.rect[2].max(rect[2]), w.rect[3].max(rect[3])];
                }
                None => {
                    let size = unsafe { b.FPDFText_GetFontSize(tp, i) } as f32;
                    // GetCharAngle is clockwise radians in user space; the page's /Rotate
                    // turns it further clockwise as displayed.
                    let a = unsafe { b.FPDFText_GetCharAngle(tp, i) };
                    let cw = if a < 0.0 { 0.0 } else { a.to_degrees() } + rot_deg;
                    let angle = (360.0 - cw).rem_euclid(360.0);
                    cur = Some(TruthWord { text: ch.to_string(), rect, size, angle });
                }
            }
        }
        if let Some(w) = cur.take() {
            out.push(w);
        }
        unsafe { b.FPDFText_ClosePage(tp) };
        // PDFium's font size ignores the text matrix (CAD exports often set 1 pt text and
        // scale it), so estimate the size from the box across the baseline instead. A
        // Helvetica loose box is about 1.16 times the font size.
        for w in &mut out {
            let (bw, bh) = (w.rect[2] - w.rect[0], w.rect[3] - w.rect[1]);
            let est = match crate::score::angle_bucket(w.angle) {
                "90" | "270" => bw / 1.16,
                "0" | "180" => bh / 1.16,
                _ => continue, // angled: the box says little; keep PDFium's size
            };
            if (w.size - est).abs() > 0.35 * est {
                w.size = est;
            }
        }
        out
    }

    /// A single image covering the page with nothing else, the way a scanner writes a page:
    /// how many image objects and other objects the page has.
    pub fn object_counts(&self) -> (usize, usize) {
        let b = self.b;
        let n = unsafe { b.FPDFPage_CountObjects(self.h) }.max(0);
        let mut images = 0;
        for i in 0..n {
            let o = unsafe { b.FPDFPage_GetObject(self.h, i) };
            if unsafe { b.FPDFPageObj_GetType(o) } == FPDF_PAGEOBJ_IMAGE as c_int {
                images += 1;
            }
        }
        (images, n as usize - images)
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Build an image-only PDF of one page (a "scan"): the page rendered at `dpi` (greyscale,
/// rotation baked in) as the page's only object, on a page of the same displayed size.
pub fn image_only_pdf(p: &Pdfium, page: &Page, dpi: f64) -> Result<Vec<u8>, String> {
    let b = &*p.b;
    let scale = dpi / 72.0;
    let (pw, ph) = page.size();
    let (w, h) = page.pixel_size(scale, 0);
    // Render to BGRx: FPDFImageObj_SetBitmap stores grey bitmaps poorly in some builds.
    let stride = w as usize * 4;
    let mut px = vec![0u8; stride * h as usize];
    let out = p.new_doc();
    unsafe {
        let bmp = b.FPDFBitmap_CreateEx(w as c_int, h as c_int, FPDFBITMAP_BGRX, px.as_mut_ptr() as *mut c_void, stride as c_int);
        b.FPDFBitmap_FillRect(bmp, 0, 0, w as c_int, h as c_int, 0xFFFF_FFFF);
        b.FPDF_RenderPageBitmap(bmp, page.h, 0, 0, w as c_int, h as c_int, 0, FPDF_ANNOT);
        let np = b.FPDFPage_New(out.h, 0, pw as f64, ph as f64);
        let img = b.FPDFPageObj_NewImageObj(out.h);
        let mut pages = [np];
        if b.FPDFImageObj_SetBitmap(pages.as_mut_ptr(), 1, img, bmp) == 0 {
            return Err("FPDFImageObj_SetBitmap failed".into());
        }
        b.FPDFPageObj_SetMatrix(img, &FS_MATRIX { a: pw, b: 0.0, c: 0.0, d: ph, e: 0.0, f: 0.0 });
        b.FPDFPage_InsertObject(np, img);
        b.FPDFPage_GenerateContent(np);
        b.FPDF_ClosePage(np);
        b.FPDFBitmap_Destroy(bmp);
    }
    out.save()
}

/// Build the drawing-like fixture (`fixture::layout`): text items and lines in PDF user
/// space, y up, on an A1 landscape page, optionally with a /Rotate.
pub fn drawing_pdf(p: &Pdfium, texts: &[crate::fixture::Item], lines: &[[f64; 4]], page_rotate: i32) -> Result<Vec<u8>, String> {
    let b = &*p.b;
    let (pw, ph) = (crate::fixture::PAGE_W, crate::fixture::PAGE_H);
    let doc = p.new_doc();
    unsafe {
        let page = b.FPDFPage_New(doc.h, 0, pw, ph);
        for l in lines {
            let path = b.FPDFPageObj_CreateNewPath(l[0] as f32, l[1] as f32);
            b.FPDFPath_LineTo(path, l[2] as f32, l[3] as f32);
            b.FPDFPath_SetDrawMode(path, 0, 1);
            b.FPDFPageObj_SetStrokeWidth(path, 0.3);
            b.FPDFPageObj_SetStrokeColor(path, 40, 40, 40, 255);
            b.FPDFPage_InsertObject(page, path);
        }
        for t in texts {
            let o = b.FPDFPageObj_NewTextObj(doc.h, "Helvetica", t.size as f32);
            let w = wide(&t.text);
            b.FPDFText_SetText(o, w.as_ptr());
            let (s, c) = t.angle.to_radians().sin_cos();
            b.FPDFPageObj_Transform(o, c, s, -s, c, t.x, t.y);
            b.FPDFPage_InsertObject(page, o);
        }
        if page_rotate != 0 {
            b.FPDFPage_SetRotation(page, page_rotate);
        }
        b.FPDFPage_GenerateContent(page);
        b.FPDF_ClosePage(page);
    }
    doc.save()
}

/// Save a greyscale image as PNG (debugging).
pub fn save_png(g: &Gray, path: &std::path::Path) -> Result<(), String> {
    let f = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut enc = png::Encoder::new(std::io::BufWriter::new(f), g.w, g.h);
    enc.set_color(png::ColorType::Grayscale);
    enc.set_depth(png::BitDepth::Eight);
    let mut w = enc.write_header().map_err(|e| e.to_string())?;
    let mut packed = Vec::with_capacity((g.w * g.h) as usize);
    for y in 0..g.h as usize {
        packed.extend_from_slice(&g.px[y * g.stride..y * g.stride + g.w as usize]);
    }
    w.write_image_data(&packed).map_err(|e| e.to_string())
}

impl Page<'_> {
    /// Remove every path object from this loaded page (in memory; never saved): what OCR sees
    /// with all line work gone. Returns how many were removed.
    pub fn remove_paths(&self) -> usize {
        let b = self.b;
        let mut n = 0;
        let mut i = unsafe { b.FPDFPage_CountObjects(self.h) } - 1;
        while i >= 0 {
            let o = unsafe { b.FPDFPage_GetObject(self.h, i) };
            if unsafe { b.FPDFPageObj_GetType(o) } == FPDF_PAGEOBJ_PATH as c_int && unsafe { b.FPDFPage_RemoveObject(self.h, o) } != 0 {
                unsafe { b.FPDFPageObj_Destroy(o) };
                n += 1;
            }
            i -= 1;
        }
        unsafe { b.FPDFPage_GenerateContent(self.h) };
        n
    }
}

impl Page<'_> {
    /// Bounds (page user space, left/bottom/right/top) and segment count of every path object.
    pub fn path_stats(&self) -> Vec<([f32; 4], i32)> {
        let b = self.b;
        let n = unsafe { b.FPDFPage_CountObjects(self.h) };
        let mut out = Vec::new();
        for i in 0..n {
            let o = unsafe { b.FPDFPage_GetObject(self.h, i) };
            if unsafe { b.FPDFPageObj_GetType(o) } != FPDF_PAGEOBJ_PATH as c_int {
                continue;
            }
            let (mut l, mut bo, mut r, mut t) = (0f32, 0f32, 0f32, 0f32);
            unsafe { b.FPDFPageObj_GetBounds(o, &mut l, &mut bo, &mut r, &mut t) };
            let segs = unsafe { b.FPDFPath_CountSegments(o) };
            out.push(([l, bo, r, t], segs));
        }
        out
    }

    /// Remove path objects whose longer side exceeds `max_pt` (in memory; never saved): line
    /// work goes, glyph-sized paths (outline text) stay. Returns (removed, kept).
    pub fn remove_large_paths(&self, max_pt: f32) -> (usize, usize) {
        let b = self.b;
        let (mut removed, mut kept) = (0, 0);
        let mut i = unsafe { b.FPDFPage_CountObjects(self.h) } - 1;
        while i >= 0 {
            let o = unsafe { b.FPDFPage_GetObject(self.h, i) };
            if unsafe { b.FPDFPageObj_GetType(o) } == FPDF_PAGEOBJ_PATH as c_int {
                let (mut l, mut bo, mut r, mut t) = (0f32, 0f32, 0f32, 0f32);
                unsafe { b.FPDFPageObj_GetBounds(o, &mut l, &mut bo, &mut r, &mut t) };
                if (r - l).max(t - bo) > max_pt {
                    if unsafe { b.FPDFPage_RemoveObject(self.h, o) } != 0 {
                        unsafe { b.FPDFPageObj_Destroy(o) };
                        removed += 1;
                    }
                } else {
                    kept += 1;
                }
            }
            i -= 1;
        }
        unsafe { b.FPDFPage_GenerateContent(self.h) };
        (removed, kept)
    }
}
