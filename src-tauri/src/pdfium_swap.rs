//! Image swaps: images PDFium would decode again and again are decoded once and swapped in.
//!
//! PDFium keeps a decoded image between renders only while it's between about 12 and 60 MB
//! decoded, and converting through an ICC profile with a lookup table costs it 170 to 240 ms
//! per megapixel. So a 24 MP scan with a scanner profile cost Bayou Towers about 4.2 s on
//! every render, and every deep tile paid again. Measurements and the reasoning behind every
//! threshold here: docs/bayou-image-scope.md.
//!
//! For each page, an image is swapped when its decoded size is over NEVER_KEPT_BYTES or it has
//! a lookup-table profile and is at least LUT_MIN_PIXELS. Its pixels come from our own decode
//! (`jpeg-decoder`, plus `moxcms` for a profile that passes `profile_agrees`) when we can
//! reproduce PDFium's colours, otherwise from PDFium's own decode, taken once. Either way they
//! are set into a second copy of the page (`FPDFImageObj_SetBitmap`), opened from a second
//! document handle so the original is untouched (PDFium shares one image object per stream
//! across a document), and that copy is rendered at every scale from then on.
//!
//! Pages with a swap or an image that's slow to decode render as one band (`pdfium.rs`, `bands_for_page`),
//! so every render of them goes to one worker and only that worker ever holds the swapped copy.
//!
//! Threading: every PDFium call happens on the worker thread that owns the document; the
//! per-worker state is thread-local. Only the profile verdicts are shared.

use pdfium_render::prelude::*;
use std::cell::RefCell;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

/// PDFium never keeps a decoded image bigger than this between renders (measured: a 20 MP
/// RGB image at 59.99 MB is kept, a 60 MP grey one at 60.01 MB isn't).
pub const NEVER_KEPT_BYTES: u64 = 60_000_000;
/// An image with a lookup-table profile is swapped from this size: 98 to 105 ms a render at
/// 0.5 MP, against about 9 ms once for ours.
pub const LUT_MIN_PIXELS: u64 = 500_000;
/// A page with an image PDFium takes this long to decode renders as one band even when it
/// isn't swapped: every worker whose band crosses the image decodes it, so eight bands cost
/// seven extra decodes (at least a second of CPU at this threshold) and seven extra copies, and
/// once the image is kept a zoomed render of it costs 1 to 3 ms banded or not. Cheaper images
/// stay banded: the 50 MB sample (11 MP) measured 2.4x faster banded at 400%. The threshold is
/// a judgement; the rates in `decode_ms` are measured (docs/bayou-image-scope.md).
pub const ONE_BAND_DECODE_MS: f64 = 150.0;
/// At most this much swapped (at 4 bytes a pixel, PDFium's copy) per page, biggest first.
pub const PAGE_SWAP_BYTES: u64 = 400_000_000;
/// At most this much swapped per worker across pages; least recently used pages close first.
pub const WORKER_SWAP_BYTES: u64 = 1_000_000_000;

/// Swapped images, by where the pixels came from (process-wide; tests and diagnostics).
pub static SWAPS_OURS: AtomicUsize = AtomicUsize::new(0);
pub static SWAPS_PDFIUM: AtomicUsize = AtomicUsize::new(0);

const FPDF_PAGEOBJ_IMAGE: i32 = 3;
const FPDF_PAGEOBJ_FORM: i32 = 5;
// FPDF_COLORSPACE_*
const CS_GRAY: i32 = 1;
const CS_RGB: i32 = 2;
const CS_ICC: i32 = 7;

fn timing() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("VELLUM_PDFIUM_TIMING").is_some())
}

// ---------- decisions (pure, tested) ----------

/// What the plan needs to know about one image.
#[derive(Clone, Debug, Default)]
pub struct ImageInfo {
    pub w: u32,
    pub h: u32,
    pub bpp: u32,
    pub colorspace: i32,
    pub filters: Vec<String>,
    /// The image's ICC profile, if it has one.
    pub icc: Option<Arc<Vec<u8>>>,
    /// Soft mask, blend mode or alpha: left alone.
    pub transparent: bool,
}

impl ImageInfo {
    pub fn pixels(&self) -> u64 {
        self.w as u64 * self.h as u64
    }
    /// Decoded size at the image's own bit depth, as PDFium holds it.
    pub fn decoded_bytes(&self) -> u64 {
        (self.pixels() * self.bpp as u64).div_ceil(8)
    }
    /// What PDFium's swapped copy costs (it stores 32 bits a pixel).
    pub fn swapped_bytes(&self) -> u64 {
        self.pixels() * 4
    }
    fn has_lut_profile(&self) -> bool {
        self.icc.as_deref().is_some_and(|p| icc_has_lut(p))
    }
}

/// Whether swapping this image would pay off.
pub fn worth_swapping(i: &ImageInfo) -> bool {
    if i.transparent || i.bpp <= 1 || i.w == 0 || i.h == 0 {
        return false; // masks and 1-bit scans (JBIG2, CCITT) are kept by PDFium and stay with it
    }
    i.decoded_bytes() > NEVER_KEPT_BYTES || (i.has_lut_profile() && i.pixels() >= LUT_MIN_PIXELS)
}

/// Which images on a page to swap: worth it, biggest first, within PAGE_SWAP_BYTES.
pub fn pick_swaps(images: &[ImageInfo]) -> Vec<usize> {
    let mut idx: Vec<usize> = (0..images.len()).filter(|&k| worth_swapping(&images[k])).collect();
    idx.sort_by_key(|&k| std::cmp::Reverse(images[k].pixels()));
    let mut total = 0u64;
    idx.retain(|&k| {
        let b = images[k].swapped_bytes();
        let fits = total + b <= PAGE_SWAP_BYTES;
        if fits {
            total += b;
        }
        fits
    });
    idx
}

/// Roughly what PDFium takes to decode this image once, in ms, from per-megapixel rates
/// measured on this machine's class of CPU: JPEG grey 2.3, JPEG colour 5, CCITT G4 2.5 to 3.2,
/// JBIG2 3.6 to 4.6 (Bayou's scans). JPEG 2000 couldn't be measured (no encoder to hand) and
/// gets a cautious 15; anything else, 3.
pub fn decode_ms(i: &ImageInfo) -> f64 {
    let mp = i.pixels() as f64 / 1e6;
    let rate = match i.filters.last().map(String::as_str) {
        Some("DCTDecode") if i.bpp <= 8 => 2.3,
        Some("DCTDecode") => 5.0,
        Some("CCITTFaxDecode") => 3.2,
        Some("JBIG2Decode") => 4.6,
        Some("JPXDecode") => 15.0,
        _ => 3.0,
    };
    mp * rate
}

/// Whether a page should render as one band: when it has a swap, so that one worker holds
/// the swapped copy, or an image that takes ONE_BAND_DECODE_MS or more to decode.
pub fn one_band(images: &[ImageInfo]) -> bool {
    images.iter().any(|i| decode_ms(i) >= ONE_BAND_DECODE_MS) || !pick_swaps(images).is_empty()
}

/// Whether we can decode this image ourselves (before any profile check): a single DCTDecode
/// filter, 8-bit grey or 24-bit RGB samples, device grey, device RGB or an RGB ICC profile.
/// CMYK (stored inverted, often with a Decode array), Lab and Indexed go to PDFium.
pub fn our_decode_possible(i: &ImageInfo) -> bool {
    let single_dct = i.filters.len() == 1 && i.filters[0] == "DCTDecode";
    let model = match i.colorspace {
        CS_GRAY => i.bpp == 8,
        CS_RGB => i.bpp == 24,
        CS_ICC => i.bpp == 24 && i.icc.as_deref().is_some_and(|p| icc_colour_space(p) == Some(*b"RGB ")),
        _ => false,
    };
    single_dct && model
}

/// The profile's data colour space signature (bytes 16 to 19 of the header).
pub fn icc_colour_space(icc: &[u8]) -> Option<[u8; 4]> {
    icc.get(16..20).map(|s| [s[0], s[1], s[2], s[3]])
}

/// Whether the profile converts through a lookup table (an A2B0, A2B1 or A2B2 tag), rather
/// than a matrix and curves. Table profiles are what make PDFium slow.
pub fn icc_has_lut(icc: &[u8]) -> bool {
    let Some(n) = icc.get(128..132).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize) else {
        return false;
    };
    (0..n.min(256)).any(|k| icc.get(132 + k * 12..136 + k * 12).is_some_and(|sig| matches!(sig, b"A2B0" | b"A2B1" | b"A2B2")))
}

/// Whether our conversion of a test grid matches PDFium's closely enough to use instead:
/// mean difference at most 1 level, at most 1% of samples more than 8 levels off.
pub fn colours_agree(ours: &[u8], theirs: &[u8]) -> bool {
    if ours.len() != theirs.len() || ours.is_empty() {
        return false;
    }
    let (mut sum, mut far) = (0u64, 0usize);
    for (a, b) in ours.iter().zip(theirs) {
        let d = (*a as i32 - *b as i32).unsigned_abs();
        sum += d as u64;
        if d > 8 {
            far += 1;
        }
    }
    sum as f64 / ours.len() as f64 <= 1.0 && far as f64 / ours.len() as f64 <= 0.01
}

/// The test grid for the profile check: 17 steps per channel, every combination, RGB.
pub fn test_grid() -> Vec<u8> {
    let step = |k: usize| (k * 255 / 16) as u8;
    let mut v = Vec::with_capacity(17 * 17 * 17 * 3);
    for r in 0..17 {
        for g in 0..17 {
            for b in 0..17 {
                v.extend_from_slice(&[step(r), step(g), step(b)]);
            }
        }
    }
    v
}

// ---------- our decode ----------

/// Decoded samples: grey (1 channel) or RGB (3).
pub struct Decoded {
    pub w: u32,
    pub h: u32,
    pub channels: usize,
    pub samples: Vec<u8>,
}

/// Decode a JPEG at full size. None if it can't (CMYK, 12-bit, damaged).
pub fn decode_jpeg(jpeg: &[u8]) -> Option<Decoded> {
    let mut d = jpeg_decoder::Decoder::new(jpeg);
    let samples = d.decode().ok()?;
    let info = d.info()?;
    let channels = match info.pixel_format {
        jpeg_decoder::PixelFormat::L8 => 1,
        jpeg_decoder::PixelFormat::RGB24 => 3,
        _ => return None,
    };
    let (w, h) = (info.width as u32, info.height as u32);
    (samples.len() >= w as usize * h as usize * channels).then_some(Decoded { w, h, channels, samples })
}

/// Our transform from an RGB profile to sRGB: tetrahedral interpolation, as LittleCMS does.
/// Measured on Bayou's profile at 24 MP it's both closer to PDFium and faster than the
/// default (353 against 418 ms on one thread); dropping fixed point is a hair closer still
/// but slower (407 ms).
fn srgb_transform(icc: &[u8]) -> Option<Arc<moxcms::Transform8BitExecutor>> {
    let src = moxcms::ColorProfile::new_from_slice(icc).ok()?;
    if src.color_space != moxcms::DataColorSpace::Rgb {
        return None;
    }
    let opts = moxcms::TransformOptions {
        interpolation_method: moxcms::InterpolationMethod::Tetrahedral,
        allow_use_cicp_transfer: false,
        ..Default::default()
    };
    src.create_transform_8bit(moxcms::Layout::Rgb, &moxcms::ColorProfile::new_srgb(), moxcms::Layout::Rgb, opts).ok()
}

/// Convert RGB samples from an ICC profile to sRGB in place, a chunk of rows per core. False
/// (samples untouched) if the profile can't be used.
pub fn icc_to_srgb(img: &mut Decoded, icc: &[u8]) -> bool {
    if img.channels != 3 {
        return false;
    }
    let Some(t) = srgb_transform(icc) else { return false };
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

// ---------- the profile check ----------

fn profile_key(icc: &[u8]) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    icc.hash(&mut h);
    h.finish()
}

/// Process-wide: profile hash -> whether our conversion matches PDFium's.
fn verdicts() -> &'static Mutex<HashMap<u64, bool>> {
    static V: OnceLock<Mutex<HashMap<u64, bool>>> = OnceLock::new();
    V.get_or_init(Default::default)
}

/// A one-page PDF holding `grid` as an uncompressed 8-bit RGB image in `icc`'s colour space.
pub fn grid_pdf(grid: &[u8], icc: &[u8]) -> Vec<u8> {
    let w = grid.len() / 3;
    let stream = |dict: String, data: &[u8]| {
        let mut o = format!("<<{dict}/Length {}>>\nstream\n", data.len()).into_bytes();
        o.extend_from_slice(data);
        o.extend_from_slice(b"\nendstream");
        o
    };
    let objs: Vec<Vec<u8>> = vec![
        b"<</Type/Catalog/Pages 2 0 R>>".to_vec(),
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>".to_vec(),
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]/Resources<</XObject<</Im0 5 0 R>>>>/Contents 4 0 R>>".to_vec(),
        stream(String::new(), b"q 10 0 0 10 0 0 cm /Im0 Do Q\n"),
        stream(format!("/Type/XObject/Subtype/Image/Width {w}/Height 1/ColorSpace[/ICCBased 6 0 R]/BitsPerComponent 8"), grid),
        stream("/N 3".into(), icc),
    ];
    let mut out = b"%PDF-1.7\n".to_vec();
    let mut offs = Vec::new();
    for (i, o) in objs.iter().enumerate() {
        offs.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        out.extend_from_slice(o);
        out.extend_from_slice(b"\nendobj\n");
    }
    let x = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
    for o in offs {
        out.extend_from_slice(format!("{o:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(format!("trailer\n<</Size {}/Root 1 0 R>>\nstartxref\n{x}\n%%EOF\n", objs.len() + 1).as_bytes());
    out
}

/// PDFium's decode of an image object as RGB samples (grey expanded). None on failure.
unsafe fn pdfium_rgb(b: &dyn PdfiumLibraryBindings, o: FPDF_PAGEOBJECT) -> Option<Vec<u8>> {
    unsafe {
        let bmp = b.FPDFImageObj_GetBitmap(o);
        if bmp.is_null() {
            return None;
        }
        let (w, h, st, fmt) = (b.FPDFBitmap_GetWidth(bmp) as usize, b.FPDFBitmap_GetHeight(bmp) as usize, b.FPDFBitmap_GetStride(bmp) as usize, b.FPDFBitmap_GetFormat(bmp));
        let buf = std::slice::from_raw_parts(b.FPDFBitmap_GetBuffer(bmp) as *const u8, st * h);
        let pch = match fmt {
            1 => 1,
            2 => 3,
            3 | 4 => 4,
            _ => 0,
        };
        let mut rgb = Vec::with_capacity(w * h * 3);
        if pch > 0 {
            for y in 0..h {
                for x in 0..w {
                    let p = &buf[y * st + x * pch..];
                    if pch == 1 {
                        rgb.extend_from_slice(&[p[0], p[0], p[0]]);
                    } else {
                        rgb.extend_from_slice(&[p[2], p[1], p[0]]);
                    }
                }
            }
        }
        b.FPDFBitmap_Destroy(bmp);
        (pch > 0).then_some(rgb)
    }
}

/// Whether our conversion through `icc` matches PDFium's, checked once per profile per
/// process on a 17-step grid of every RGB combination.
pub fn profile_agrees(b: &dyn PdfiumLibraryBindings, icc: &[u8]) -> bool {
    let key = profile_key(icc);
    if let Some(v) = verdicts().lock().unwrap().get(&key) {
        return *v;
    }
    let t0 = std::time::Instant::now();
    let grid = test_grid();
    let ours = srgb_transform(icc).and_then(|t| {
        let mut out = vec![0u8; grid.len()];
        t.transform(&grid, &mut out).ok().map(|_| out)
    });
    let theirs = ours.as_ref().and_then(|_| unsafe {
        let pdf = grid_pdf(&grid, icc);
        let doc = b.FPDF_LoadMemDocument64(&pdf, None);
        if doc.is_null() {
            return None;
        }
        let page = b.FPDF_LoadPage(doc, 0);
        let r = if page.is_null() { None } else { pdfium_rgb(b, b.FPDFPage_GetObject(page, 0)) };
        if !page.is_null() {
            b.FPDF_ClosePage(page);
        }
        b.FPDF_CloseDocument(doc);
        r
    });
    let ok = matches!((&ours, &theirs), (Some(o), Some(t)) if colours_agree(o, t));
    eprintln!(
        "[swap] colour profile {key:016x} ({} bytes): {} ({} ms)",
        icc.len(),
        if ok { "our conversion matches PDFium" } else { "using PDFium's decode" },
        t0.elapsed().as_millis()
    );
    verdicts().lock().unwrap().insert(key, ok);
    ok
}

// ---------- reading a page ----------

/// Every image on a page, including those nested in form XObjects, with its path: the index
/// on the page, then the index within each enclosing form.
pub unsafe fn page_images(b: &dyn PdfiumLibraryBindings, page: FPDF_PAGE) -> Vec<(Vec<i32>, FPDF_PAGEOBJECT)> {
    unsafe {
        let mut out = Vec::new();
        let mut stack: Vec<(Vec<i32>, FPDF_PAGEOBJECT)> = (0..b.FPDFPage_CountObjects(page).max(0)).map(|i| (vec![i], b.FPDFPage_GetObject(page, i))).collect();
        stack.reverse();
        while let Some((path, o)) = stack.pop() {
            if o.is_null() {
                continue;
            }
            match b.FPDFPageObj_GetType(o) {
                FPDF_PAGEOBJ_IMAGE => out.push((path, o)),
                FPDF_PAGEOBJ_FORM if path.len() < 8 => {
                    let n = b.FPDFFormObj_CountObjects(o).max(0);
                    for j in (0..n).rev() {
                        let mut p = path.clone();
                        p.push(j);
                        stack.push((p, b.FPDFFormObj_GetObject(o, j as _)));
                    }
                }
                _ => {}
            }
        }
        out
    }
}

/// The object at `path` on `page` (see `page_images`).
unsafe fn object_at(b: &dyn PdfiumLibraryBindings, page: FPDF_PAGE, path: &[i32]) -> FPDF_PAGEOBJECT {
    unsafe {
        let mut o = b.FPDFPage_GetObject(page, path[0]);
        for &j in &path[1..] {
            if o.is_null() {
                break;
            }
            o = b.FPDFFormObj_GetObject(o, j as _);
        }
        o
    }
}

fn filters(b: &dyn PdfiumLibraryBindings, o: FPDF_PAGEOBJECT) -> Vec<String> {
    let n = unsafe { b.FPDFImageObj_GetImageFilterCount(o) }.max(0);
    (0..n)
        .map(|i| {
            let mut buf = [0u8; 64];
            let len = unsafe { b.FPDFImageObj_GetImageFilter(o, i, buf.as_mut_ptr() as *mut _, buf.len() as _) } as usize;
            String::from_utf8_lossy(&buf[..len.saturating_sub(1).min(buf.len())]).into_owned()
        })
        .collect()
}

fn icc_profile(b: &dyn PdfiumLibraryBindings, o: FPDF_PAGEOBJECT, page: FPDF_PAGE) -> Option<Vec<u8>> {
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

/// What the plan needs to know about each image on the page.
pub unsafe fn image_infos(b: &dyn PdfiumLibraryBindings, page: FPDF_PAGE) -> Vec<(Vec<i32>, ImageInfo)> {
    unsafe {
        page_images(b, page)
            .into_iter()
            .map(|(path, o)| {
                let mut md: FPDF_IMAGEOBJ_METADATA = std::mem::zeroed();
                b.FPDFImageObj_GetImageMetadata(o, page, &mut md);
                let colorspace = md.colorspace;
                let info = ImageInfo {
                    w: md.width,
                    h: md.height,
                    bpp: md.bits_per_pixel,
                    colorspace,
                    filters: filters(b, o),
                    icc: if colorspace == CS_ICC { icc_profile(b, o, page).map(Arc::new) } else { None },
                    transparent: b.FPDFPageObj_HasTransparency(o) != 0,
                };
                (path, info)
            })
            .collect()
    }
}

/// Whether this page should render as one band (see `one_band`).
pub fn page_one_band(b: &dyn PdfiumLibraryBindings, page: FPDF_PAGE) -> bool {
    let infos: Vec<ImageInfo> = unsafe { image_infos(b, page) }.into_iter().map(|(_, i)| i).collect();
    one_band(&infos)
}

// ---------- per-worker swapped pages ----------

/// How to open a second handle on a document.
#[derive(Clone)]
pub enum Reopen {
    Path(std::path::PathBuf),
    Memory(Arc<Vec<u8>>),
}

struct Swapped {
    /// Its own document handle, so closing it frees the swapped pixels.
    doc: FPDF_DOCUMENT,
    page: FPDF_PAGE,
    bytes: u64,
}

struct SwapDoc {
    reopen: Reopen,
    password: Option<String>,
    /// None: page looked at, nothing to swap.
    pages: HashMap<usize, Option<Swapped>>,
}

#[derive(Default)]
struct Worker {
    docs: HashMap<usize, SwapDoc>,
    /// (document handle, page), least recently used first.
    order: Vec<(usize, usize)>,
    bytes: u64,
}

thread_local! {
    static WORKER: RefCell<Worker> = RefCell::new(Worker::default());
}

/// A document opened on this worker.
pub fn on_open(handle: FPDF_DOCUMENT, reopen: Reopen, password: Option<String>) {
    WORKER.with(|w| {
        w.borrow_mut().docs.insert(handle as usize, SwapDoc { reopen, password, pages: HashMap::new() });
    });
}

unsafe fn close_swapped(b: &dyn PdfiumLibraryBindings, s: Swapped) {
    unsafe {
        b.FPDF_ClosePage(s.page);
        b.FPDF_CloseDocument(s.doc);
    }
}

/// A document is about to close on this worker: free its swapped pages.
pub fn on_close(b: &dyn PdfiumLibraryBindings, handle: FPDF_DOCUMENT) {
    WORKER.with(|w| {
        let mut w = w.borrow_mut();
        let key = handle as usize;
        if let Some(d) = w.docs.remove(&key) {
            for s in d.pages.into_values().flatten() {
                w.bytes -= s.bytes;
                unsafe { close_swapped(b, s) };
            }
        }
        w.order.retain(|(d, _)| *d != key);
    });
}

/// The swapped copy of this page, if it has one (building it the first time it's asked
/// for); None to render the original.
pub fn page_for_render(b: &dyn PdfiumLibraryBindings, handle: FPDF_DOCUMENT, index: usize, original: FPDF_PAGE) -> Option<FPDF_PAGE> {
    WORKER.with(|w| {
        let mut w = w.borrow_mut();
        let key = handle as usize;
        let known = w.docs.get(&key)?.pages.get(&index).map(|s| s.as_ref().map(|s| s.page));
        let page = match known {
            Some(p) => p,
            None => {
                let d = w.docs.get(&key)?;
                let built = unsafe { build(b, &d.reopen, d.password.as_deref(), index, original) };
                let p = built.as_ref().map(|s| s.page);
                if let Some(s) = &built {
                    w.bytes += s.bytes;
                }
                w.docs.get_mut(&key)?.pages.insert(index, built);
                p
            }
        };
        if page.is_some() {
            w.order.retain(|e| *e != (key, index));
            w.order.push((key, index));
            evict(b, &mut w);
        }
        // Eviction never takes the page just used, so this is still open.
        page
    })
}

/// Close least recently used swapped pages until the worker is within WORKER_SWAP_BYTES,
/// always keeping the most recent one.
fn evict(b: &dyn PdfiumLibraryBindings, w: &mut Worker) {
    while w.bytes > WORKER_SWAP_BYTES && w.order.len() > 1 {
        let (dk, pi) = w.order.remove(0);
        // Forget the page entirely, so a later visit builds it again.
        if let Some(Some(s)) = w.docs.get_mut(&dk).and_then(|d| d.pages.remove(&pi)) {
            w.bytes -= s.bytes;
            if timing() {
                eprintln!("[swap] closing swapped page {} to stay under {} MB", pi + 1, WORKER_SWAP_BYTES / 1_000_000);
            }
            unsafe { close_swapped(b, s) };
        }
    }
}

/// Decide what to swap on the page and build the swapped copy. None if nothing is swapped.
unsafe fn build(b: &dyn PdfiumLibraryBindings, reopen: &Reopen, password: Option<&str>, index: usize, original: FPDF_PAGE) -> Option<Swapped> {
    unsafe {
        let images = image_infos(b, original);
        let infos: Vec<ImageInfo> = images.iter().map(|(_, i)| i.clone()).collect();
        let picks = pick_swaps(&infos);
        if picks.is_empty() {
            return None;
        }
        let t0 = std::time::Instant::now();
        let doc = match reopen {
            Reopen::Path(p) => b.FPDF_LoadDocument(&p.to_string_lossy(), password),
            Reopen::Memory(m) => b.FPDF_LoadMemDocument64(m, password),
        };
        if doc.is_null() {
            eprintln!("[swap] page {}: could not open a second handle on the document, not swapped", index + 1);
            return None;
        }
        let mut page = b.FPDF_LoadPage(doc, index as i32);
        if page.is_null() {
            b.FPDF_CloseDocument(doc);
            return None;
        }
        let mut bytes = 0u64;
        for k in picks {
            let (path, info) = &images[k];
            let src = object_at(b, original, path);
            let dst = object_at(b, page, path);
            if src.is_null() || dst.is_null() || b.FPDFPageObj_GetType(dst) != FPDF_PAGEOBJ_IMAGE {
                continue;
            }
            let ti = std::time::Instant::now();
            let ours = if our_decode_possible(info) && info.icc.as_deref().is_none_or(|p| profile_agrees(b, p)) {
                ours_bitmap(b, src, info)
            } else {
                None
            };
            let (bmp, from) = match ours {
                Some(bmp) => (bmp, "our"),
                None => match pdfium_bitmap(b, src) {
                    Some(bmp) => (bmp, "PDFium's"),
                    None => {
                        eprintln!("[swap] page {}: image {}x{} could not be decoded, left as it is", index + 1, info.w, info.h);
                        continue;
                    }
                },
            };
            if b.FPDFImageObj_SetBitmap(&mut page, 1, dst, bmp) != 0 {
                bytes += info.swapped_bytes();
                if from == "our" { &SWAPS_OURS } else { &SWAPS_PDFIUM }.fetch_add(1, Ordering::Relaxed);
                eprintln!(
                    "[swap] page {}: {}x{} image ({:.1} MP{}) swapped from {from} decode in {} ms",
                    index + 1,
                    info.w,
                    info.h,
                    info.pixels() as f64 / 1e6,
                    if info.has_lut_profile() { ", table profile" } else { "" },
                    ti.elapsed().as_millis()
                );
            }
            b.FPDFBitmap_Destroy(bmp);
        }
        if bytes == 0 {
            b.FPDF_ClosePage(page);
            b.FPDF_CloseDocument(doc);
            return None;
        }
        if timing() {
            eprintln!("[swap] page {}: swapped copy ready in {} ms", index + 1, t0.elapsed().as_millis());
        }
        Some(Swapped { doc, page, bytes })
    }
}

/// Our decode of the image as a BGRx bitmap. None if it can't be done.
unsafe fn ours_bitmap(b: &dyn PdfiumLibraryBindings, o: FPDF_PAGEOBJECT, info: &ImageInfo) -> Option<FPDF_BITMAP> {
    unsafe {
        let len = b.FPDFImageObj_GetImageDataRaw(o, std::ptr::null_mut(), 0) as usize;
        let mut raw = vec![0u8; len];
        if len == 0 {
            return None;
        }
        b.FPDFImageObj_GetImageDataRaw(o, raw.as_mut_ptr() as *mut _, len as _);
        let mut img = decode_jpeg(&raw)?;
        if img.w != info.w || img.h != info.h {
            return None;
        }
        if let Some(icc) = &info.icc {
            if !icc_to_srgb(&mut img, icc) {
                return None;
            }
        }
        let bmp = b.FPDFBitmap_Create(img.w as i32, img.h as i32, 0);
        if bmp.is_null() {
            return None;
        }
        let stride = b.FPDFBitmap_GetStride(bmp) as usize;
        let buf = std::slice::from_raw_parts_mut(b.FPDFBitmap_GetBuffer(bmp) as *mut u8, stride * img.h as usize);
        to_bgrx(&img.samples, img.channels, img.w as usize, img.h as usize, buf, stride);
        Some(bmp)
    }
}

/// PDFium's own decode of the image (colour converted as PDFium would), as a BGRx bitmap.
unsafe fn pdfium_bitmap(b: &dyn PdfiumLibraryBindings, o: FPDF_PAGEOBJECT) -> Option<FPDF_BITMAP> {
    unsafe {
        let src = b.FPDFImageObj_GetBitmap(o);
        if src.is_null() {
            return None;
        }
        if matches!(b.FPDFBitmap_GetFormat(src), 3 | 4) {
            return Some(src);
        }
        // Grey or BGR: widen to BGRx, the format our own swaps use.
        let (w, h, st, fmt) = (b.FPDFBitmap_GetWidth(src), b.FPDFBitmap_GetHeight(src), b.FPDFBitmap_GetStride(src) as usize, b.FPDFBitmap_GetFormat(src));
        let pch = match fmt {
            1 => 1usize,
            2 => 3,
            _ => {
                b.FPDFBitmap_Destroy(src);
                return None;
            }
        };
        let dst = b.FPDFBitmap_Create(w, h, 0);
        if dst.is_null() {
            b.FPDFBitmap_Destroy(src);
            return None;
        }
        let dst_st = b.FPDFBitmap_GetStride(dst) as usize;
        let s = std::slice::from_raw_parts(b.FPDFBitmap_GetBuffer(src) as *const u8, st * h as usize);
        let d = std::slice::from_raw_parts_mut(b.FPDFBitmap_GetBuffer(dst) as *mut u8, dst_st * h as usize);
        for y in 0..h as usize {
            for x in 0..w as usize {
                let p = &s[y * st + x * pch..];
                let q = &mut d[y * dst_st + x * 4..y * dst_st + x * 4 + 4];
                if pch == 1 {
                    q.copy_from_slice(&[p[0], p[0], p[0], 255]);
                } else {
                    q.copy_from_slice(&[p[0], p[1], p[2], 255]);
                }
            }
        }
        b.FPDFBitmap_Destroy(src);
        Some(dst)
    }
}
