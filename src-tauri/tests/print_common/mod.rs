//! Shared helpers for the print tests: build fixture PDFs with PDFium, render pages and
//! measure where the ink landed.

#![allow(dead_code)]

use pdfium_render::prelude::*;
use std::ffi::c_int;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use vellum_lib::docs::Docs;
use vellum_lib::pdfium::PdfiumState;
use vellum_lib::print::raster::SheetRenderer;

pub fn pdfium() -> &'static PdfiumState {
    static P: OnceLock<PdfiumState> = OnceLock::new();
    P.get_or_init(|| vellum_lib::print::pdfium_for_tests(2))
}

pub fn docs() -> &'static Docs {
    static D: OnceLock<Docs> = OnceLock::new();
    D.get_or_init(Docs::default)
}

pub fn temp_dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("vellum-print-test-{}-{tag}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// One fixture page: size in points, /Rotate in quarter turns, filled black rectangles in
/// PDF user space (x0, y0, x1, y1, y up), and optionally a noisy RGB image of n x n pixels
/// filling the page (incompressible, to make page copies show in the file size).
#[derive(Clone, Default)]
pub struct PageSpec {
    pub w: f64,
    pub h: f64,
    pub rotate: i32,
    pub rects: Vec<(f64, f64, f64, f64)>,
    pub noise_image: Option<u32>,
}

pub fn page(w: f64, h: f64, rects: &[(f64, f64, f64, f64)]) -> PageSpec {
    PageSpec { w, h, rects: rects.to_vec(), ..Default::default() }
}

/// Build a PDF with PDFium.
pub fn make_pdf(pages: Vec<PageSpec>) -> Vec<u8> {
    pdfium()
        .run_on_worker(move |ctx| {
            let b = ctx.bindings();
            unsafe {
                let doc = b.FPDF_CreateNewDocument();
                for (i, p) in pages.iter().enumerate() {
                    let page = b.FPDFPage_New(doc, i as c_int, p.w, p.h);
                    if let Some(n) = p.noise_image {
                        let mut px = vec![0u8; (n * n * 3) as usize];
                        let mut s: u32 = 12345;
                        for v in px.iter_mut() {
                            s = s.wrapping_mul(1103515245).wrapping_add(12345);
                            *v = (s >> 16) as u8 | 0x80; // light, so it never reads as ink
                        }
                        let bmp = b.FPDFBitmap_CreateEx(n as c_int, n as c_int, 2, px.as_mut_ptr() as *mut _, (n * 3) as c_int);
                        let img = b.FPDFPageObj_NewImageObj(doc);
                        let mut pg = [page];
                        b.FPDFImageObj_SetBitmap(pg.as_mut_ptr(), 1, img, bmp);
                        b.FPDFBitmap_Destroy(bmp);
                        let m = FS_MATRIX { a: p.w as f32, b: 0.0, c: 0.0, d: p.h as f32, e: 0.0, f: 0.0 };
                        b.FPDFPageObj_SetMatrix(img, &m);
                        b.FPDFPage_InsertObject(page, img);
                    }
                    for &(x0, y0, x1, y1) in &p.rects {
                        let r = b.FPDFPageObj_CreateNewRect(x0 as f32, y0 as f32, (x1 - x0) as f32, (y1 - y0) as f32);
                        b.FPDFPageObj_SetFillColor(r, 0, 0, 0, 255);
                        b.FPDFPath_SetDrawMode(r, 1, 0);
                        b.FPDFPage_InsertObject(page, r);
                    }
                    b.FPDFPage_GenerateContent(page);
                    if p.rotate != 0 {
                        b.FPDFPage_SetRotation(page, p.rotate);
                    }
                    b.FPDF_ClosePage(page);
                }
                let out = vellum_lib::print::compose::save(b, doc).unwrap();
                b.FPDF_CloseDocument(doc);
                out
            }
        })
        .unwrap()
}

/// Write a fixture PDF and open it as a document. Returns (doc id, path).
pub fn open_fixture(tag: &str, bytes: &[u8]) -> (u64, String) {
    let path = temp_dir("fixtures").join(format!("{tag}.pdf"));
    std::fs::write(&path, bytes).unwrap();
    let info = docs().open(pdfium(), &path, None).unwrap();
    (info.doc_id, path.to_string_lossy().into_owned())
}

/// The bounding box of the ink (any channel under 128) in a BGRx/RGBA buffer, in pixels:
/// (x0, y0, x1, y1), exclusive ends. None if blank.
pub fn ink_bbox(px: &[u8], w: i32, h: i32) -> Option<(i32, i32, i32, i32)> {
    let mut bb: Option<(i32, i32, i32, i32)> = None;
    for y in 0..h {
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            if px[i].min(px[i + 1]).min(px[i + 2]) < 128 {
                bb = Some(match bb {
                    None => (x, y, x + 1, y + 1),
                    Some((a, b, c, d)) => (a.min(x), b.min(y), c.max(x + 1), d.max(y + 1)),
                });
            }
        }
    }
    bb
}

/// Render page `index` of a PDF (bytes) whole at `ppp` pixels per point; returns
/// (pixels, w, h).
pub fn render_pdf_page(bytes: Arc<Vec<u8>>, index: usize, w_pt: f64, h_pt: f64, ppp: f64) -> (Vec<u8>, i32, i32) {
    let r = SheetRenderer::open(pdfium(), bytes).unwrap();
    let (w, h) = ((w_pt * ppp).round() as i32, (h_pt * ppp).round() as i32);
    let px = r.render_band(index, w, h, 0, 0, w, h, 0).unwrap();
    (px, w, h)
}

/// Ink bbox of a PDF page in points, y down.
pub fn ink_bbox_pt(bytes: Arc<Vec<u8>>, index: usize, w_pt: f64, h_pt: f64) -> Option<(f64, f64, f64, f64)> {
    let ppp = 4.0;
    let (px, w, h) = render_pdf_page(bytes, index, w_pt, h_pt, ppp);
    ink_bbox(&px, w, h).map(|(a, b, c, d)| (a as f64 / ppp, b as f64 / ppp, c as f64 / ppp, d as f64 / ppp))
}

/// Page sizes of a PDF in points (as PDFium reports them, after /Rotate).
pub fn page_sizes(bytes: Arc<Vec<u8>>) -> Vec<(f64, f64)> {
    pdfium()
        .run_on_worker(move |ctx| {
            let b = ctx.bindings();
            unsafe {
                let doc = b.FPDF_LoadMemDocument64(&bytes, None);
                assert!(!doc.is_null(), "output is not a readable PDF");
                let n = b.FPDF_GetPageCount(doc);
                let mut v = Vec::new();
                for i in 0..n {
                    let mut w = 0.0;
                    let mut h = 0.0;
                    b.FPDF_GetPageSizeByIndex(doc, i, &mut w, &mut h);
                    v.push((w, h));
                }
                b.FPDF_CloseDocument(doc);
                v
            }
        })
        .unwrap()
}

pub fn assert_near(got: (f64, f64, f64, f64), want: (f64, f64, f64, f64), tol: f64, what: &str) {
    let ok = (got.0 - want.0).abs() <= tol && (got.1 - want.1).abs() <= tol && (got.2 - want.2).abs() <= tol && (got.3 - want.3).abs() <= tol;
    assert!(ok, "{what}: got {got:?}, want {want:?} (tolerance {tol})");
}
