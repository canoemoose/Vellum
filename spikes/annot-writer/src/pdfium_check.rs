//! Read the writer's output back through PDFium, the engine Vellum renders with: the same DLL
//! and the same render flags (`FPDF_ANNOT`) as `src-tauri/src/pdfium.rs`.

use pdfium_render::prelude::*;
use std::ffi::{c_int, c_ulong, c_void};

pub const FPDF_ANNOT: i32 = 0x01;
pub const ANNOT_FLAG_HIDDEN: i32 = 2;

pub struct Pdfium {
    pub b: Box<dyn PdfiumLibraryBindings>,
}

#[derive(Clone, Debug)]
pub struct AnnotInfo {
    pub subtype: i32,
    pub rect: [f32; 4],
    pub flags: i32,
    pub nm: String,
    pub contents: String,
    pub vertices: usize,
    pub has_line: bool,
}

pub struct Doc<'a> {
    p: &'a Pdfium,
    pub h: FPDF_DOCUMENT,
    _bytes: Vec<u8>,
}

impl Pdfium {
    pub fn load() -> Result<Self, String> {
        let dll = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/pdfium/bin/pdfium.dll");
        let b = pdfium_render::prelude::Pdfium::bind_to_library(&dll).map_err(|e| format!("could not load {}: {e:?} (run node tools/fetch-pdfium.mjs)", dll.display()))?;
        unsafe { b.FPDF_InitLibrary() };
        Ok(Self { b })
    }

    pub fn open(&self, bytes: Vec<u8>, password: Option<&str>) -> Result<Doc<'_>, String> {
        let h = unsafe { self.b.FPDF_LoadMemDocument64(&bytes, password) };
        if h.is_null() {
            return Err(format!("PDFium could not open it (error {})", unsafe { self.b.FPDF_GetLastError() }));
        }
        Ok(Doc { p: self, h, _bytes: bytes })
    }
}

impl Drop for Doc<'_> {
    fn drop(&mut self) {
        unsafe { self.p.b.FPDF_CloseDocument(self.h) };
    }
}

pub struct Page<'a> {
    b: &'a dyn PdfiumLibraryBindings,
    pub h: FPDF_PAGE,
}

impl Drop for Page<'_> {
    fn drop(&mut self) {
        unsafe { self.b.FPDF_ClosePage(self.h) };
    }
}

fn wide(b: &dyn PdfiumLibraryBindings, a: FPDF_ANNOTATION, key: &str) -> String {
    unsafe {
        let n = b.FPDFAnnot_GetStringValue(a, key, std::ptr::null_mut(), 0);
        if n <= 2 {
            return String::new();
        }
        let mut buf = vec![0u16; n as usize / 2];
        b.FPDFAnnot_GetStringValue(a, key, buf.as_mut_ptr(), n);
        String::from_utf16_lossy(&buf[..buf.len() - 1])
    }
}

impl<'a> Doc<'a> {
    pub fn pages(&self) -> usize {
        unsafe { self.p.b.FPDF_GetPageCount(self.h) as usize }
    }

    pub fn page(&self, i: usize) -> Result<Page<'a>, String> {
        let h = unsafe { self.p.b.FPDF_LoadPage(self.h, i as c_int) };
        if h.is_null() {
            return Err(format!("PDFium could not load page {i}"));
        }
        Ok(Page { b: &*self.p.b, h })
    }

    pub fn permissions(&self) -> u32 {
        unsafe { self.p.b.FPDF_GetDocPermissions(self.h) as u32 }
    }

    pub fn security_revision(&self) -> i32 {
        unsafe { self.p.b.FPDF_GetSecurityHandlerRevision(self.h) }
    }

    pub fn signatures(&self) -> i32 {
        unsafe { self.p.b.FPDF_GetSignatureCount(self.h) }
    }

    /// Save through PDFium (`flags` 0 = full rewrite, 1 = FPDF_INCREMENTAL).
    pub fn save(&self, flags: u32) -> Result<Vec<u8>, String> {
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
        let ok = unsafe { self.p.b.FPDF_SaveAsCopy(self.h, &mut w as *mut W as *mut FPDF_FILEWRITE, flags) };
        if ok == 0 { Err("FPDF_SaveAsCopy failed".into()) } else { Ok(w.out) }
    }
}

impl Page<'_> {
    pub fn size(&self) -> (f32, f32) {
        unsafe { (self.b.FPDF_GetPageWidthF(self.h), self.b.FPDF_GetPageHeightF(self.h)) }
    }

    pub fn annot_count(&self) -> usize {
        unsafe { self.b.FPDFPage_GetAnnotCount(self.h).max(0) as usize }
    }

    /// Every annotation by PDFium's index (None where PDFium has no annotation at that index).
    pub fn annots(&self) -> Vec<Option<AnnotInfo>> {
        (0..self.annot_count()).map(|i| self.annot(i)).collect()
    }

    pub fn annot(&self, i: usize) -> Option<AnnotInfo> {
        let b = self.b;
        unsafe {
            let a = b.FPDFPage_GetAnnot(self.h, i as c_int);
            if a.is_null() {
                return None;
            }
            let mut r = FS_RECTF { left: 0.0, top: 0.0, right: 0.0, bottom: 0.0 };
            b.FPDFAnnot_GetRect(a, &mut r);
            let mut s = FS_POINTF { x: 0.0, y: 0.0 };
            let mut e = FS_POINTF { x: 0.0, y: 0.0 };
            let info = AnnotInfo {
                subtype: b.FPDFAnnot_GetSubtype(a) as i32,
                rect: [r.left.min(r.right), r.bottom.min(r.top), r.left.max(r.right), r.bottom.max(r.top)],
                flags: b.FPDFAnnot_GetFlags(a),
                nm: wide(b, a, "NM"),
                contents: wide(b, a, "Contents"),
                vertices: b.FPDFAnnot_GetVertices(a, std::ptr::null_mut(), 0) as usize,
                has_line: b.FPDFAnnot_GetLine(a, &mut s, &mut e) != 0,
            };
            b.FPDFPage_CloseAnnot(a);
            Some(info)
        }
    }

    pub fn set_flags(&self, i: usize, flags: i32) -> bool {
        unsafe {
            let a = self.b.FPDFPage_GetAnnot(self.h, i as c_int);
            if a.is_null() {
                return false;
            }
            let ok = self.b.FPDFAnnot_SetFlags(a, flags) != 0;
            self.b.FPDFPage_CloseAnnot(a);
            ok
        }
    }

    /// Render the whole page at `scale` device pixels per point, annotations on, as Vellum does.
    pub fn render(&self, scale: f32) -> Image {
        let (pw, ph) = self.size();
        let (w, h) = ((pw * scale).round() as i32, (ph * scale).round() as i32);
        unsafe {
            let bmp = self.b.FPDFBitmap_Create(w, h, 0);
            self.b.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xFFFFFFFF);
            self.b.FPDF_RenderPageBitmap(bmp, self.h, 0, 0, w, h, 0, FPDF_ANNOT);
            let stride = self.b.FPDFBitmap_GetStride(bmp) as usize;
            let buf = self.b.FPDFBitmap_GetBuffer(bmp) as *const u8;
            let mut px = vec![0u8; w as usize * h as usize * 4];
            for y in 0..h as usize {
                std::ptr::copy_nonoverlapping(buf.add(y * stride), px.as_mut_ptr().add(y * w as usize * 4), w as usize * 4);
            }
            self.b.FPDFBitmap_Destroy(bmp);
            let rot = self.b.FPDFPage_GetRotation(self.h);
            Image { w: w as usize, h: h as usize, px, scale, page_w: pw, page_h: ph, rot }
        }
    }
}

/// A rendered page (BGRA).
pub struct Image {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u8>,
    pub scale: f32,
    /// Page size as displayed (after /Rotate) and the rotation (0..3 quarter turns clockwise).
    pub page_w: f32,
    pub page_h: f32,
    pub rot: i32,
}

impl Image {
    /// A page point (PDF user space, y up) on the displayed page in points, y down. Assumes a
    /// MediaBox at the origin, true of the spike's test pages.
    fn to_display(&self, x: f32, y: f32) -> (f32, f32) {
        let (dw, dh) = (self.page_w, self.page_h);
        match self.rot {
            1 => (y, x),
            2 => (dw - x, y),
            3 => (dw - y, dh - x),
            _ => (x, dh - y),
        }
    }

    /// Pixels that differ from `other` inside a rectangle in PDF user space.
    pub fn diff_in(&self, other: &Image, rect: [f32; 4]) -> usize {
        let s = self.scale;
        let a = self.to_display(rect[0], rect[1]);
        let b = self.to_display(rect[2], rect[3]);
        let x0 = ((a.0.min(b.0) * s).floor().max(0.0) as usize).min(self.w);
        let x1 = ((a.0.max(b.0) * s).ceil().max(0.0) as usize).min(self.w);
        let y0 = ((a.1.min(b.1) * s).floor().max(0.0) as usize).min(self.h);
        let y1 = ((a.1.max(b.1) * s).ceil().max(0.0) as usize).min(self.h);
        let mut n = 0;
        for y in y0..y1 {
            for x in x0..x1 {
                let i = (y * self.w + x) * 4;
                let d = (0..3).map(|c| (self.px[i + c] as i32 - other.px[i + c] as i32).abs()).max().unwrap();
                if d > 24 {
                    n += 1;
                }
            }
        }
        n
    }

    /// Pixels that differ anywhere.
    pub fn diff(&self, other: &Image) -> usize {
        self.px.chunks(4).zip(other.px.chunks(4)).filter(|(a, b)| (0..3).any(|c| (a[c] as i32 - b[c] as i32).abs() > 24)).count()
    }
}
