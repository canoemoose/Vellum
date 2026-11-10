//! Image level of detail for image-heavy PDF pages (WP-LOD prototype).
//!
//! The aerial test drawing holds 731 JPEG tiles (837 MP). At fit page PDFium decodes every
//! one of them in full to draw a strip a few dozen pixels wide. This module keeps, per PDFium
//! worker, a *second* handle on the same file whose image-heavy pages have each large JPEG
//! swapped for a copy decoded at 1/8 size (scaled IDCT, so the expensive part of the decode
//! is skipped too). Renders below a per-page threshold use that page; anything sharper uses
//! the original, so zooming in never shows the reduced images.
//!
//! Why a second document rather than a second copy of the page: PDFium shares one image
//! object per image stream across a document's pages, and `FPDFImageObj_SetBitmap` rewrites
//! that shared image, so swapping on a second page of the same document would blur the
//! original too.
//!
//! Threading: every PDFium call happens on the worker thread that owns the document (the
//! per-worker state is thread-local). The 1/8 decodes are shared across workers through a
//! process-wide cache and run on scoped threads; only the decode touches them.
//!
//! Hooks in pdfium.rs: `on_open` after a document opens, `on_close` before it closes, and
//! `page_for_render` in the strip renderer.
//!
//! Huge JPEGs (on by default). A single JPEG of HUGE_IMAGE_PIXELS or more is decoded once at
//! full size by us, converted to sRGB through its ICC profile if it has one, and swapped in
//! the same way, for renders at every scale. PDFium itself never caches such an image: Bayou
//! Towers' 24 MP cover scan with a scanner profile costs it about 4.2 s on every render,
//! against about 140 ms once for our decode and colour conversion (docs/bayou-image-scope.md).
//! The 1/8 copies for many smaller JPEGs stay behind VELLUM_IMAGE_LOD.

use pdfium_render::prelude::*;
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

/// Decode factor: images are swapped for a 1/SCALE copy.
pub const SCALE: u32 = 8;
/// Images narrower or shorter than this (in pixels) are left alone.
pub const MIN_IMAGE_SIDE: u32 = 512;
/// A page is worth a reduced copy only when its eligible images add up to this many pixels.
pub const MIN_PAGE_PIXELS: u64 = 16_000_000;

const FPDF_PAGEOBJ_IMAGE: i32 = 3;

/// A JPEG at least this many pixels on its own is decoded by us and swapped in at every
/// scale. The aerial drawing's tiles (about 1 MP each) stay with PDFium.
pub const HUGE_IMAGE_PIXELS: u64 = 16_000_000;

/// How many huge images have been swapped in, process-wide (for tests and diagnostics).
pub static HUGE_SWAPS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// The 1/8 copies for many smaller JPEGs: off unless `VELLUM_IMAGE_LOD=1`. The prototype made
/// the aerial drawing slower, not faster (numbers in docs/v0.1-handoff/lod.md).
pub fn enabled() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var("VELLUM_IMAGE_LOD").is_ok_and(|v| v.trim() == "1"))
}

fn timing() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("VELLUM_PDFIUM_TIMING").is_some())
}

// ---------- pure helpers (tested) ----------

/// The render scale (device px per point) at or below which a 1/SCALE copy of an image of
/// `px_w` x `px_h` pixels drawn over `pt_w` x `pt_h` points still has at least one source
/// pixel per device pixel in both directions.
pub fn image_threshold(px_w: u32, px_h: u32, pt_w: f64, pt_h: f64) -> f64 {
    let sw = px_w.div_ceil(SCALE) as f64;
    let sh = px_h.div_ceil(SCALE) as f64;
    let tx = if pt_w > 0.0 { sw / pt_w } else { f64::INFINITY };
    let ty = if pt_h > 0.0 { sh / pt_h } else { f64::INFINITY };
    tx.min(ty)
}

/// Whether an image object is worth reducing: a single DCTDecode filter, a colour space we
/// can rebuild from the decoded samples, and big enough to matter.
pub fn eligible(filters: &[String], px_w: u32, px_h: u32, colorspace: i32) -> bool {
    // FPDF_COLORSPACE_*: 1 DeviceGray, 2 DeviceRGB, 4 CalGray, 5 CalRGB, 7 ICCBased.
    filters.len() == 1
        && filters[0] == "DCTDecode"
        && px_w >= MIN_IMAGE_SIDE
        && px_h >= MIN_IMAGE_SIDE
        && matches!(colorspace, 1 | 2 | 4 | 5 | 7)
}

/// Whether an image is huge enough to decode ourselves at full size: a single DCTDecode
/// filter, DeviceGray, DeviceRGB or ICCBased (FPDF_COLORSPACE_ 1, 2, 7), and at least
/// HUGE_IMAGE_PIXELS. Whether an ICC profile can actually be applied is decided later.
pub fn huge_eligible(filters: &[String], px_w: u32, px_h: u32, colorspace: i32) -> bool {
    filters.len() == 1
        && filters[0] == "DCTDecode"
        && px_w as u64 * px_h as u64 >= HUGE_IMAGE_PIXELS
        && matches!(colorspace, 1 | 2 | 7)
}

/// Combine per-image thresholds into the page's: the smallest (the image that goes soft
/// first decides), or None when the page isn't image-heavy enough to bother.
pub fn page_threshold(images: &[(u64, f64)]) -> Option<f64> {
    let total: u64 = images.iter().map(|(px, _)| *px).sum();
    if total < MIN_PAGE_PIXELS {
        return None;
    }
    images.iter().map(|(_, t)| *t).fold(None, |m: Option<f64>, t| Some(m.map_or(t, |m| m.min(t))))
}

/// Grey or RGB samples to PDFium's BGRx, row by row into a buffer with `stride`.
pub fn to_bgrx(samples: &[u8], channels: usize, w: usize, h: usize, out: &mut [u8], stride: usize) {
    for y in 0..h {
        let row = &samples[y * w * channels..(y + 1) * w * channels];
        let o = &mut out[y * stride..y * stride + w * 4];
        for x in 0..w {
            let (r, g, b) = if channels == 1 {
                let v = row[x];
                (v, v, v)
            } else {
                (row[x * 3], row[x * 3 + 1], row[x * 3 + 2])
            };
            o[x * 4] = b;
            o[x * 4 + 1] = g;
            o[x * 4 + 2] = r;
            o[x * 4 + 3] = 255;
        }
    }
}

// ---------- reduced decodes, shared across workers ----------

/// One image decoded at 1/SCALE: grey or RGB samples.
pub struct Small {
    pub w: u32,
    pub h: u32,
    pub channels: usize,
    pub samples: Vec<u8>,
}

/// Decode a JPEG at 1/SCALE with scaled IDCT. None if it can't (CMYK, 16-bit, damaged).
pub fn decode_small(jpeg: &[u8], px_w: u32, px_h: u32) -> Option<Small> {
    let mut d = jpeg_decoder::Decoder::new(jpeg);
    let want_w = px_w.div_ceil(SCALE).min(u16::MAX as u32) as u16;
    let want_h = px_h.div_ceil(SCALE).min(u16::MAX as u32) as u16;
    let (w, h) = d.scale(want_w, want_h).ok()?;
    let samples = d.decode().ok()?;
    let channels = match d.info()?.pixel_format {
        jpeg_decoder::PixelFormat::L8 => 1,
        jpeg_decoder::PixelFormat::RGB24 => 3,
        _ => return None,
    };
    (samples.len() >= w as usize * h as usize * channels).then_some(Small { w: w as u32, h: h as u32, channels, samples })
}

/// Decode a JPEG at full size. None if it can't (CMYK, 12-bit, damaged).
pub fn decode_full(jpeg: &[u8]) -> Option<Small> {
    let mut d = jpeg_decoder::Decoder::new(jpeg);
    let samples = d.decode().ok()?;
    let info = d.info()?;
    let channels = match info.pixel_format {
        jpeg_decoder::PixelFormat::L8 => 1,
        jpeg_decoder::PixelFormat::RGB24 => 3,
        _ => return None,
    };
    let (w, h) = (info.width as u32, info.height as u32);
    (samples.len() >= w as usize * h as usize * channels).then_some(Small { w, h, channels, samples })
}

/// Convert RGB samples from the image's ICC profile to sRGB in place. False (samples
/// untouched) if the profile won't parse, isn't RGB, or the transform can't be built; the
/// image is then left to PDFium. Matches PDFium's own conversion to about a level per channel
/// on Bayou's scanner profile.
pub fn icc_to_srgb(img: &mut Small, icc: &[u8]) -> bool {
    if img.channels != 3 {
        return false;
    }
    let Ok(src) = moxcms::ColorProfile::new_from_slice(icc) else { return false };
    if src.color_space != moxcms::DataColorSpace::Rgb {
        return false;
    }
    let dst = moxcms::ColorProfile::new_srgb();
    let Ok(t) = src.create_transform_8bit(moxcms::Layout::Rgb, &dst, moxcms::Layout::Rgb, Default::default()) else {
        return false;
    };
    // Whole rows per chunk, a chunk per core: the transform is per pixel.
    let row = img.w as usize * 3;
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).max(1);
    let chunk = (img.h as usize).div_ceil(threads).max(1) * row;
    let mut out = vec![0u8; img.samples.len()];
    let ok = std::thread::scope(|s| {
        let jobs: Vec<_> = img
            .samples
            .chunks(chunk)
            .zip(out.chunks_mut(chunk))
            .map(|(a, b)| {
                let t = &t;
                s.spawn(move || t.transform(a, b).is_ok())
            })
            .collect();
        jobs.into_iter().all(|j| j.join().unwrap_or(false))
    });
    if ok {
        img.samples = out;
    }
    ok
}

/// The reduced images of one page: object index on the page, and its decode.
type PageSmalls = Vec<(i32, Option<Arc<Small>>)>;

/// Process-wide: (file, page) -> the page's reduced images, decoded once by whichever worker
/// gets there first while the others wait.
fn shared() -> &'static Mutex<HashMap<(PathBuf, usize), Arc<OnceLock<PageSmalls>>>> {
    static S: OnceLock<Mutex<HashMap<(PathBuf, usize), Arc<OnceLock<PageSmalls>>>>> = OnceLock::new();
    S.get_or_init(Default::default)
}

/// Process-wide: (file, page) -> the page's huge images decoded at full size and in sRGB.
fn huge_shared() -> &'static Mutex<HashMap<(PathBuf, usize), Arc<OnceLock<PageSmalls>>>> {
    static S: OnceLock<Mutex<HashMap<(PathBuf, usize), Arc<OnceLock<PageSmalls>>>>> = OnceLock::new();
    S.get_or_init(Default::default)
}

/// Forget a file's decodes once no worker has it open (best effort: called on every close;
/// another worker that still needs a page decodes it again).
fn forget_shared(path: &Path) {
    shared().lock().unwrap().retain(|(p, _), _| p != path);
    huge_shared().lock().unwrap().retain(|(p, _), _| p != path);
}

// ---------- per-worker state ----------

struct LodPage {
    /// The reduced copy of the page, in the worker's second document.
    page: FPDF_PAGE,
    /// Use it for renders at or below this scale.
    max_rs: f64,
}

struct LodDoc {
    path: PathBuf,
    /// Second handle on the same file; null until first needed, or if it couldn't open.
    handle: FPDF_DOCUMENT,
    tried: bool,
    /// None: page analysed and not worth reducing.
    pages: HashMap<usize, Option<LodPage>>,
}

thread_local! {
    /// Keyed by the original document's handle.
    static DOCS: RefCell<HashMap<usize, LodDoc>> = RefCell::new(HashMap::new());
}

/// A document opened on this worker. Only documents opened from a file take part (composed
/// print jobs in memory don't need it).
pub fn on_open(handle: FPDF_DOCUMENT, path: Option<PathBuf>) {
    if let Some(path) = path {
        DOCS.with(|d| {
            d.borrow_mut().insert(handle as usize, LodDoc { path, handle: std::ptr::null_mut(), tried: false, pages: HashMap::new() })
        });
    }
}

/// A document is about to close on this worker: free its reduced copy.
pub fn on_close(b: &dyn PdfiumLibraryBindings, handle: FPDF_DOCUMENT) {
    let Some(ld) = DOCS.with(|d| d.borrow_mut().remove(&(handle as usize))) else {
        return;
    };
    unsafe {
        for p in ld.pages.into_values().flatten() {
            b.FPDF_ClosePage(p.page);
        }
        if !ld.handle.is_null() {
            b.FPDF_CloseDocument(ld.handle);
        }
    }
    forget_shared(&ld.path);
}

/// The page to render a strip from: the reduced copy when the scale is low enough, else
/// `original`.
pub fn page_for_render(b: &dyn PdfiumLibraryBindings, handle: FPDF_DOCUMENT, index: usize, rs: f64, original: FPDF_PAGE) -> FPDF_PAGE {
    DOCS.with(|d| {
        let mut docs = d.borrow_mut();
        let Some(ld) = docs.get_mut(&(handle as usize)) else {
            return original;
        };
        if !ld.pages.contains_key(&index) {
            let lp = prepare_page(b, ld, index, original);
            ld.pages.insert(index, lp);
        }
        match ld.pages.get(&index) {
            Some(Some(lp)) if rs <= lp.max_rs => lp.page,
            _ => original,
        }
    })
}

fn image_filters(b: &dyn PdfiumLibraryBindings, o: FPDF_PAGEOBJECT) -> Vec<String> {
    let n = unsafe { b.FPDFImageObj_GetImageFilterCount(o) }.max(0);
    (0..n)
        .map(|i| {
            let mut buf = [0u8; 64];
            let len = unsafe { b.FPDFImageObj_GetImageFilter(o, i, buf.as_mut_ptr() as *mut _, buf.len() as _) } as usize;
            String::from_utf8_lossy(&buf[..len.saturating_sub(1).min(buf.len())]).into_owned()
        })
        .collect()
}

fn image_raw(b: &dyn PdfiumLibraryBindings, o: FPDF_PAGEOBJECT) -> Vec<u8> {
    let len = unsafe { b.FPDFImageObj_GetImageDataRaw(o, std::ptr::null_mut(), 0) } as usize;
    let mut buf = vec![0u8; len];
    if len > 0 {
        unsafe { b.FPDFImageObj_GetImageDataRaw(o, buf.as_mut_ptr() as *mut _, len as _) };
    }
    buf
}

fn image_icc(b: &dyn PdfiumLibraryBindings, o: FPDF_PAGEOBJECT, page: FPDF_PAGE) -> Option<Vec<u8>> {
    let mut len = 0usize;
    unsafe { b.FPDFImageObj_GetIccProfileDataDecoded(o, page, std::ptr::null_mut(), 0, &mut len) };
    if len == 0 {
        return None;
    }
    let mut buf = vec![0u8; len];
    let ok = unsafe { b.FPDFImageObj_GetIccProfileDataDecoded(o, page, buf.as_mut_ptr(), len, &mut len) } != 0;
    (ok && len <= buf.len()).then(|| {
        buf.truncate(len);
        buf
    })
}

/// Look at the original page: huge JPEGs get a full-size swap; otherwise, with LOD on, an
/// image-heavy page gets the reduced copy.
fn prepare_page(b: &dyn PdfiumLibraryBindings, ld: &mut LodDoc, index: usize, original: FPDF_PAGE) -> Option<LodPage> {
    if let Some(lp) = prepare_huge(b, ld, index, original) {
        return Some(lp);
    }
    if !enabled() {
        return None;
    }
    prepare_reduced(b, ld, index, original)
}

/// Decode the page's huge JPEGs ourselves, once per file and page, and swap them into this
/// worker's second copy of the page, used at every scale.
fn prepare_huge(b: &dyn PdfiumLibraryBindings, ld: &mut LodDoc, index: usize, original: FPDF_PAGE) -> Option<LodPage> {
    let t0 = std::time::Instant::now();
    let mut picks: Vec<(i32, u32, u32, i32)> = Vec::new();
    let n = unsafe { b.FPDFPage_CountObjects(original) };
    for i in 0..n {
        let o = unsafe { b.FPDFPage_GetObject(original, i) };
        if o.is_null() || unsafe { b.FPDFPageObj_GetType(o) } != FPDF_PAGEOBJ_IMAGE {
            continue;
        }
        let mut md: FPDF_IMAGEOBJ_METADATA = unsafe { std::mem::zeroed() };
        if unsafe { b.FPDFImageObj_GetImageMetadata(o, original, &mut md) } == 0 {
            continue;
        }
        // Cheap size check first: most pages have no huge image and needn't read filters.
        if (md.width as u64 * md.height as u64) < HUGE_IMAGE_PIXELS {
            continue;
        }
        if huge_eligible(&image_filters(b, o), md.width, md.height, md.colorspace) {
            picks.push((i, md.width, md.height, md.colorspace));
        }
    }
    if picks.is_empty() {
        return None;
    }
    let cell = huge_shared().lock().unwrap().entry((ld.path.clone(), index)).or_default().clone();
    let decoded = cell.get_or_init(|| {
        picks
            .iter()
            .map(|&(i, w, h, cs)| {
                let o = unsafe { b.FPDFPage_GetObject(original, i) };
                let Some(mut img) = decode_full(&image_raw(b, o)) else {
                    eprintln!("[lod] page {} image {i}: could not decode the JPEG ourselves, left to PDFium", index + 1);
                    return (i, None);
                };
                if img.w != w || img.h != h {
                    eprintln!("[lod] page {} image {i}: decoded {}x{}, PDF says {w}x{h}, left to PDFium", index + 1, img.w, img.h);
                    return (i, None);
                }
                if cs == 7 {
                    let ok = image_icc(b, o, original).is_some_and(|icc| icc_to_srgb(&mut img, &icc));
                    if !ok {
                        eprintln!("[lod] page {} image {i}: ICC profile not applied, left to PDFium", index + 1);
                        return (i, None);
                    }
                }
                (i, Some(Arc::new(img)))
            })
            .collect()
    });
    let page = swap_page(b, ld, index, decoded)?;
    HUGE_SWAPS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    if timing() {
        eprintln!("[lod] page {}: huge JPEG swapped in, {} ms", index + 1, t0.elapsed().as_millis());
    }
    Some(LodPage { page, max_rs: f64::INFINITY })
}

/// Load the page from this worker's second handle on the file and swap each decoded image
/// in. None if the second handle can't open or nothing was swapped.
fn swap_page(b: &dyn PdfiumLibraryBindings, ld: &mut LodDoc, index: usize, images: &PageSmalls) -> Option<FPDF_PAGE> {
    if !ld.tried {
        ld.tried = true;
        ld.handle = unsafe { b.FPDF_LoadDocument(&ld.path.to_string_lossy(), None) };
    }
    if ld.handle.is_null() {
        return None; // e.g. password-protected: no swapped copy
    }
    let mut page = unsafe { b.FPDF_LoadPage(ld.handle, index as i32) };
    if page.is_null() {
        return None;
    }
    let mut swapped = 0;
    for (i, img) in images {
        let Some(sm) = img else { continue };
        let o = unsafe { b.FPDFPage_GetObject(page, *i) };
        if o.is_null() || unsafe { b.FPDFPageObj_GetType(o) } != FPDF_PAGEOBJ_IMAGE {
            continue;
        }
        let bmp = unsafe { b.FPDFBitmap_Create(sm.w as i32, sm.h as i32, 0) };
        if bmp.is_null() {
            continue;
        }
        unsafe {
            let stride = b.FPDFBitmap_GetStride(bmp) as usize;
            let buf = std::slice::from_raw_parts_mut(b.FPDFBitmap_GetBuffer(bmp) as *mut u8, stride * sm.h as usize);
            to_bgrx(&sm.samples, sm.channels, sm.w as usize, sm.h as usize, buf, stride);
            if b.FPDFImageObj_SetBitmap(&mut page, 1, o, bmp) != 0 {
                swapped += 1;
            }
            b.FPDFBitmap_Destroy(bmp);
        }
    }
    if swapped == 0 {
        unsafe { b.FPDF_ClosePage(page) };
        return None;
    }
    Some(page)
}

/// With LOD on: if the page is image-heavy, build the 1/8 copy.
fn prepare_reduced(b: &dyn PdfiumLibraryBindings, ld: &mut LodDoc, index: usize, original: FPDF_PAGE) -> Option<LodPage> {
    let t0 = std::time::Instant::now();
    // Which objects to reduce, and the page's threshold.
    let mut picks: Vec<(i32, u32, u32)> = Vec::new();
    let mut weights: Vec<(u64, f64)> = Vec::new();
    let n = unsafe { b.FPDFPage_CountObjects(original) };
    for i in 0..n {
        let o = unsafe { b.FPDFPage_GetObject(original, i) };
        if o.is_null() || unsafe { b.FPDFPageObj_GetType(o) } != FPDF_PAGEOBJ_IMAGE {
            continue;
        }
        let mut md: FPDF_IMAGEOBJ_METADATA = unsafe { std::mem::zeroed() };
        if unsafe { b.FPDFImageObj_GetImageMetadata(o, original, &mut md) } == 0 {
            continue;
        }
        if !eligible(&image_filters(b, o), md.width, md.height, md.colorspace) {
            continue;
        }
        let (mut l, mut bo, mut r, mut t) = (0f32, 0f32, 0f32, 0f32);
        if unsafe { b.FPDFPageObj_GetBounds(o, &mut l, &mut bo, &mut r, &mut t) } == 0 {
            continue;
        }
        let th = image_threshold(md.width, md.height, (r - l).abs() as f64, (t - bo).abs() as f64);
        picks.push((i, md.width, md.height));
        weights.push((md.width as u64 * md.height as u64, th));
    }
    let max_rs = page_threshold(&weights)?;

    // Decode once per file and page, shared by every worker.
    let cell = shared().lock().unwrap().entry((ld.path.clone(), index)).or_default().clone();
    let smalls = cell.get_or_init(|| {
        let raws: Vec<(i32, u32, u32, Vec<u8>)> = picks
            .iter()
            .map(|&(i, w, h)| {
                let o = unsafe { b.FPDFPage_GetObject(original, i) };
                let len = unsafe { b.FPDFImageObj_GetImageDataRaw(o, std::ptr::null_mut(), 0) } as usize;
                let mut buf = vec![0u8; len];
                if len > 0 {
                    unsafe { b.FPDFImageObj_GetImageDataRaw(o, buf.as_mut_ptr() as *mut _, len as _) };
                }
                (i, w, h, buf)
            })
            .collect();
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(raws.len().max(1));
        let chunk = raws.len().div_ceil(threads).max(1);
        let mut out: PageSmalls = Vec::with_capacity(raws.len());
        std::thread::scope(|s| {
            let handles: Vec<_> = raws
                .chunks(chunk)
                .map(|c| s.spawn(move || c.iter().map(|(i, w, h, raw)| (*i, decode_small(raw, *w, *h).map(Arc::new))).collect::<Vec<_>>()))
                .collect();
            for h in handles {
                out.extend(h.join().unwrap_or_default());
            }
        });
        out
    });

    let page = swap_page(b, ld, index, smalls)?;
    if timing() {
        eprintln!(
            "[lod] page {}: {} images reduced 1/{}, use at rs <= {:.4}, {} ms",
            index + 1, picks.len(), SCALE, max_rs, t0.elapsed().as_millis()
        );
    }
    Some(LodPage { page, max_rs })
}
