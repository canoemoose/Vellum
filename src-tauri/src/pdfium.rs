//! PDFium rendering backend (the alternative to pdf.js that this spike evaluates).
//!
//! PDFium is not thread-safe: all of its state is global to the loaded DLL. To render in
//! parallel anyway we load N *copies* of pdfium.dll under different file names
//! (pdfium.dll, pdfium-1.dll, ...). Windows maps each as a separate module with its own
//! globals, so each copy is an independent PDFium instance. One worker thread owns each
//! instance, the open document and its parsed pages.
//!
//! A region request is split into strips along its longer axis and the strips are rendered
//! concurrently, each worker writing straight into its slice of one shared RGBA buffer
//! (FPDFBitmap_CreateEx over an external buffer with the full row stride). Each instance only
//! decodes the images its strip touches, which matters for image-heavy drawings where the
//! cost at low zoom is JPEG decoding, not rasterising.
//!
//! The buffer is returned to the front end as a raw binary IPC response in RGBA order
//! (FPDF_REVERSE_BYTE_ORDER), wrapped in ImageData there without conversion.

use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex, OnceLock};

// Constants from fpdfview.h (stable across PDFium versions).
const FPDF_ANNOT: i32 = 0x01;
const FPDF_REVERSE_BYTE_ORDER: i32 = 0x10;
const FPDF_BITMAP_BGRA: i32 = 4;

#[derive(Serialize, Clone, Copy)]
pub struct PageSize {
    pub w: f32,
    pub h: f32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocInfo {
    pub num_pages: usize,
    pub sizes: Vec<PageSize>,
    /// Number of PDFium instances rendering in parallel.
    pub workers: usize,
}

#[derive(Deserialize, Debug, Clone)]
pub struct RegionArgs {
    pub id: u64,
    pub page: usize,
    pub rs: f64,
    pub x: i64,
    pub y: i64,
    pub w: i32,
    pub h: i32,
}

/// A strip to render into an externally owned buffer.
struct Strip {
    page: usize,
    rs: f64,
    /// Device-pixel origin of the strip within the page bitmap.
    x: i64,
    y: i64,
    w: i32,
    h: i32,
    /// Address of the strip's top-left pixel in the shared buffer, and the row stride.
    ptr: usize,
    stride: i32,
}

enum WorkerReq {
    Open { path: PathBuf, sizes: bool, reply: Sender<Result<DocInfo, String>> },
    Render { strip: Strip, reply: Sender<Result<(), String>> },
    /// Close parsed pages, which frees PDFium's decoded-image caches.
    Trim,
    /// How many bands to split this page into (see `bands_for_page`).
    Bands { page: usize, max: usize, reply: Sender<Result<usize, String>> },
}

#[derive(Clone)]
pub struct PdfiumState {
    inner: Arc<Inner>,
}

struct Inner {
    threads: usize,
    mem: Arc<Mutex<crate::memory::MemStats>>,
    /// Trim workers when the process tree's private working set exceeds this.
    trim_above_mb: f64,
    trims: AtomicUsize,
    last_trim: Mutex<Option<std::time::Instant>>,
    workers: OnceLock<Result<Vec<Sender<WorkerReq>>, String>>,
    cancelled: Mutex<HashSet<u64>>,
    sizes: Mutex<Vec<PageSize>>,
    bands: Mutex<HashMap<usize, usize>>,
}

impl PdfiumState {
    /// `threads`: PDFium instances to run; None picks half the logical CPUs, capped at 8.
    pub fn new(threads: Option<usize>, mem: Arc<Mutex<crate::memory::MemStats>>) -> Self {
        let auto = std::thread::available_parallelism()
            .map(|n| n.get() / 2)
            .unwrap_or(2)
            .clamp(1, 8);
        let threads = threads.unwrap_or(auto).clamp(1, 16);
        Self {
            inner: Arc::new(Inner {
                threads,
                mem,
                trim_above_mb: std::env::var("VELLUM_PDFIUM_TRIM_MB")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    // Off by default: re-parsing a heavy page after a trim costs more than the
                    // memory saves (see RESULTS.md). Opt in with VELLUM_PDFIUM_TRIM_MB.
                    .unwrap_or(f64::INFINITY),
                trims: AtomicUsize::new(0),
                last_trim: Mutex::new(None),
                workers: OnceLock::new(),
                cancelled: Mutex::new(HashSet::new()),
                sizes: Mutex::new(Vec::new()),
                bands: Mutex::new(HashMap::new()),
            }),
        }
    }

    fn workers(&self, resource_dir: Option<PathBuf>) -> Result<&Vec<Sender<WorkerReq>>, String> {
        self.inner
            .workers
            .get_or_init(|| start_workers(self.inner.threads, resource_dir))
            .as_ref()
            .map_err(|e| e.clone())
    }

    pub fn open(&self, resource_dir: Option<PathBuf>, path: String) -> Result<DocInfo, String> {
        let workers = self.workers(resource_dir)?;
        let path = PathBuf::from(path);
        let replies: Vec<_> = workers
            .iter()
            .enumerate()
            .map(|(i, w)| {
                let (tx, rx) = channel();
                let _ = w.send(WorkerReq::Open { path: path.clone(), sizes: i == 0, reply: tx });
                rx
            })
            .collect();
        let mut info = None;
        for (i, rx) in replies.into_iter().enumerate() {
            let r = rx.recv().map_err(|e| e.to_string())??;
            if i == 0 {
                info = Some(r);
            }
        }
        let mut info = info.ok_or("no workers")?;
        info.workers = workers.len();
        *self.inner.sizes.lock().unwrap() = info.sizes.clone();
        self.inner.bands.lock().unwrap().clear();
        Ok(info)
    }

    pub fn render(&self, a: RegionArgs) -> Result<Option<Vec<u8>>, String> {
        if self.inner.cancelled.lock().unwrap().remove(&a.id) {
            return Ok(None);
        }
        if a.w <= 0 || a.h <= 0 {
            return Err("empty region".into());
        }
        let workers = self.workers(None)?;
        let stride = a.w * 4;
        // Opaque white background; PDFium paints over it.
        let mut buf = vec![0xFFu8; stride as usize * a.h as usize];
        let base = buf.as_mut_ptr() as usize;

        // Spatial affinity: the page is cut into N bands along its long axis and worker s
        // owns band s. Every region is split at band boundaries, so a full-page render runs
        // on all workers at once, and each image is decoded and cached by the one worker
        // whose band it sits in, render after render.
        let n = self.bands(workers, a.page)?;
        let size = self.inner.sizes.lock().unwrap().get(a.page).copied().ok_or("bad page")?;
        let (pw_dev, ph_dev) = (size.w as f64 * a.rs, size.h as f64 * a.rs);
        let along_x = pw_dev >= ph_dev;
        let page_len = if along_x { pw_dev } else { ph_dev };
        let (r0, r1) = if along_x { (a.x, a.x + a.w as i64) } else { (a.y, a.y + a.h as i64) };
        let mut pending = Vec::with_capacity(n);
        let mut send_err = None;
        for s in 0..n {
            let b0 = if s == 0 { i64::MIN } else { (page_len * s as f64 / n as f64).round() as i64 };
            let b1 = if s + 1 == n { i64::MAX } else { (page_len * (s + 1) as f64 / n as f64).round() as i64 };
            let p0 = r0.max(b0);
            let p1 = r1.min(b1);
            if p1 <= p0 {
                continue;
            }
            let off = (p0 - r0) as usize;
            let len = (p1 - p0) as i32;
            let strip = if along_x {
                Strip { page: a.page, rs: a.rs, x: p0, y: a.y, w: len, h: a.h, ptr: base + off * 4, stride }
            } else {
                Strip { page: a.page, rs: a.rs, x: a.x, y: p0, w: a.w, h: len, ptr: base + off * stride as usize, stride }
            };
            let (tx, rx) = channel();
            if let Err(e) = workers[s].send(WorkerReq::Render { strip, reply: tx }) {
                // Don't return yet: strips already sent may still be writing into `buf`.
                send_err = Some(e.to_string());
                break;
            }
            pending.push(rx);
        }
        // Wait for every strip before touching or returning `buf`: workers write into it.
        let mut err = send_err;
        for rx in pending {
            match rx.recv() {
                Ok(Ok(())) => {}
                Ok(Err(e)) => err = Some(e),
                Err(e) => err = Some(e.to_string()),
            }
        }
        // Memory guard. Image-heavy drawings make PDFium cache gigabytes of decoded images
        // per parsed page. Closing a page frees them; the worker re-parses it straight away
        // (in the background, before its next request) so the next render doesn't pay for it.
        let used = self.inner.mem.lock().unwrap().current.private_ws_mb;
        let mut last = self.inner.last_trim.lock().unwrap();
        let cooled = last.is_none_or(|t| t.elapsed().as_secs_f64() > 2.0);
        if used > self.inner.trim_above_mb && cooled {
            *last = Some(std::time::Instant::now());
            self.inner.trims.fetch_add(1, Ordering::Relaxed);
            for w in workers {
                let _ = w.send(WorkerReq::Trim);
            }
        }
        match err {
            Some(e) => Err(e),
            None => Ok(Some(buf)),
        }
    }

    /// Band count for a page, asked of worker 0 once per page and remembered.
    fn bands(&self, workers: &[Sender<WorkerReq>], page: usize) -> Result<usize, String> {
        if let Some(&b) = self.inner.bands.lock().unwrap().get(&page) {
            return Ok(b);
        }
        let (tx, rx) = channel();
        workers[0]
            .send(WorkerReq::Bands { page, max: workers.len(), reply: tx })
            .map_err(|e| e.to_string())?;
        let b = rx.recv().map_err(|e| e.to_string())??.clamp(1, workers.len());
        self.inner.bands.lock().unwrap().insert(page, b);
        Ok(b)
    }

    pub fn trims(&self) -> usize {
        self.inner.trims.load(Ordering::Relaxed)
    }

    /// Skip a request that hasn't started yet. (A render already inside PDFium completes.)
    pub fn cancel(&self, id: u64) {
        self.inner.cancelled.lock().unwrap().insert(id);
    }
}

/// Per-call timing to stderr when VELLUM_PDFIUM_TIMING is set (diagnostics only).
fn timing() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("VELLUM_PDFIUM_TIMING").is_some())
}

/// Where to look for pdfium.dll, in order.
fn library_candidates(resource_dir: Option<PathBuf>) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(d) = std::env::var_os("VELLUM_PDFIUM_DIR") {
        v.push(PathBuf::from(d));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            v.push(dir.to_path_buf());
            v.push(dir.join("pdfium").join("bin"));
        }
    }
    if let Some(r) = resource_dir {
        v.push(r.join("pdfium").join("bin"));
        v.push(r);
    }
    // Dev builds: the copy fetched by tools/fetch-pdfium.mjs.
    v.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("pdfium").join("bin"));
    v
}

fn find_library(resource_dir: Option<PathBuf>) -> Result<PathBuf, String> {
    let candidates = library_candidates(resource_dir);
    for dir in &candidates {
        let p = Pdfium::pdfium_platform_library_name_at_path(dir);
        if p.exists() {
            return Ok(p);
        }
    }
    let searched: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
    Err(format!("pdfium.dll not found; searched {}", searched.join(", ")))
}

/// Worker i > 0 loads its own renamed copy so it gets a separate module instance.
fn library_copy(original: &Path, i: usize) -> Result<PathBuf, String> {
    if i == 0 {
        return Ok(original.to_path_buf());
    }
    let dir = std::env::temp_dir().join("vellum-pdfium");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("pdfium-{i}.dll"));
    let want = std::fs::metadata(original).map(|m| m.len()).unwrap_or(0);
    let have = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(u64::MAX);
    if want != have {
        std::fs::copy(original, &dest).map_err(|e| format!("copy {}: {e}", dest.display()))?;
    }
    Ok(dest)
}

fn start_workers(n: usize, resource_dir: Option<PathBuf>) -> Result<Vec<Sender<WorkerReq>>, String> {
    let original = find_library(resource_dir)?;
    let mut senders = Vec::with_capacity(n);
    let mut readies = Vec::with_capacity(n);
    for i in 0..n {
        let lib = library_copy(&original, i)?;
        let (tx, rx) = channel::<WorkerReq>();
        let (ready_tx, ready_rx) = channel::<Result<(), String>>();
        std::thread::Builder::new()
            .name(format!("pdfium-{i}"))
            .spawn(move || worker(lib, rx, ready_tx))
            .map_err(|e| e.to_string())?;
        senders.push(tx);
        readies.push(ready_rx);
    }
    for r in readies {
        r.recv().map_err(|e| e.to_string())??;
    }
    eprintln!("[pdfium] {n} instance(s) ready from {}", original.display());
    Ok(senders)
}

struct Doc {
    handle: FPDF_DOCUMENT,
    pages: HashMap<usize, FPDF_PAGE>,
}

fn worker(lib: PathBuf, rx: Receiver<WorkerReq>, ready: Sender<Result<(), String>>) {
    let b = match Pdfium::bind_to_library(&lib) {
        Ok(b) => b,
        Err(e) => {
            let _ = ready.send(Err(format!("{}: {e:?}", lib.display())));
            return;
        }
    };
    unsafe { b.FPDF_InitLibrary() };
    let _ = ready.send(Ok(()));

    let mut doc: Option<Doc> = None;
    while let Ok(req) = rx.recv() {
        match req {
            WorkerReq::Open { path, sizes, reply } => {
                if let Some(d) = doc.take() {
                    close_doc(b.as_ref(), d);
                }
                let r = open_doc(b.as_ref(), &path, sizes).map(|(d, info)| {
                    doc = Some(d);
                    info
                });
                let _ = reply.send(r);
            }
            WorkerReq::Trim => {
                if let Some(d) = doc.as_mut() {
                    let loaded: Vec<usize> = d.pages.keys().copied().collect();
                    for (_, p) in d.pages.drain() {
                        unsafe { b.FPDF_ClosePage(p) };
                    }
                    for i in loaded {
                        let _ = get_page(b.as_ref(), d, i);
                    }
                }
            }
            WorkerReq::Bands { page, max, reply } => {
                let r = match doc.as_mut() {
                    Some(d) => bands_for_page(b.as_ref(), d, page, max),
                    None => Err("no document open".into()),
                };
                let _ = reply.send(r);
            }
            WorkerReq::Render { strip, reply } => {
                let r = match doc.as_mut() {
                    Some(d) => render_strip(b.as_ref(), d, &strip),
                    None => Err("no document open".into()),
                };
                let _ = reply.send(r);
            }
        }
    }
}

fn open_doc(b: &dyn PdfiumLibraryBindings, path: &Path, want_sizes: bool) -> Result<(Doc, DocInfo), String> {
    let p = path.to_string_lossy();
    let handle = unsafe { b.FPDF_LoadDocument(&p, None) };
    if handle.is_null() {
        let code = unsafe { b.FPDF_GetLastError() };
        return Err(format!("PDFium could not open {p} (error {code})"));
    }
    let n = unsafe { b.FPDF_GetPageCount(handle) }.max(0) as usize;
    let mut d = Doc { handle, pages: HashMap::new() };
    let mut sizes = Vec::new();
    if want_sizes {
        sizes.reserve(n);
        for i in 0..n {
            // By-index size avoids parsing every page's content up front.
            let mut s = FS_SIZEF { width: 0.0, height: 0.0 };
            let ok = unsafe { b.FPDF_GetPageSizeByIndexF(handle, i as i32, &mut s) };
            if ok == 0 {
                let page = get_page(b, &mut d, i)?;
                s.width = unsafe { b.FPDF_GetPageWidthF(page) };
                s.height = unsafe { b.FPDF_GetPageHeightF(page) };
            }
            sizes.push(PageSize { w: s.width, h: s.height });
        }
    }
    Ok((d, DocInfo { num_pages: n, sizes, workers: 1 }))
}

fn get_page(b: &dyn PdfiumLibraryBindings, d: &mut Doc, i: usize) -> Result<FPDF_PAGE, String> {
    if let Some(p) = d.pages.get(&i) {
        return Ok(*p);
    }
    let t0 = std::time::Instant::now();
    let p = unsafe { b.FPDF_LoadPage(d.handle, i as i32) };
    if p.is_null() {
        return Err(format!("could not load page {}", i + 1));
    }
    if timing() {
        eprintln!("[pdfium] load page {} in {} ms", i + 1, t0.elapsed().as_millis());
    }
    // Keep a bounded set of parsed pages; parsing is the expensive part for heavy pages.
    if d.pages.len() >= 16 {
        if let Some((&k, &old)) = d.pages.iter().next() {
            unsafe { b.FPDF_ClosePage(old) };
            d.pages.remove(&k);
        }
    }
    d.pages.insert(i, p);
    Ok(p)
}

/// PDFium decodes an image in full even when only part of it is visible, so an image that
/// spans several bands would be decoded (and cached) once per band. Pages dominated by a
/// large image therefore render on one worker; everything else uses all of them.
fn bands_for_page(b: &dyn PdfiumLibraryBindings, d: &mut Doc, page: usize, max: usize) -> Result<usize, String> {
    const FPDF_PAGEOBJ_IMAGE: i32 = 3;
    let p = get_page(b, d, page)?;
    let page_area = unsafe { b.FPDF_GetPageWidthF(p) * b.FPDF_GetPageHeightF(p) } as f64;
    let n = unsafe { b.FPDFPage_CountObjects(p) };
    for i in 0..n {
        let o = unsafe { b.FPDFPage_GetObject(p, i) };
        if o.is_null() || unsafe { b.FPDFPageObj_GetType(o) } != FPDF_PAGEOBJ_IMAGE {
            continue;
        }
        let (mut l, mut bo, mut r, mut t) = (0f32, 0f32, 0f32, 0f32);
        if unsafe { b.FPDFPageObj_GetBounds(o, &mut l, &mut bo, &mut r, &mut t) } == 0 {
            continue;
        }
        let area = ((r - l) as f64 * (t - bo) as f64).abs();
        if area > page_area * 0.25 {
            if timing() {
                eprintln!("[pdfium] page {} has a large image: 1 band", page + 1);
            }
            return Ok(1);
        }
    }
    Ok(max)
}

fn close_doc(b: &dyn PdfiumLibraryBindings, d: Doc) {
    unsafe {
        for (_, p) in d.pages {
            b.FPDF_ClosePage(p);
        }
        b.FPDF_CloseDocument(d.handle);
    }
}

/// Render the strip's device-pixel rect of the page at `rs` device px per point.
fn render_strip(b: &dyn PdfiumLibraryBindings, d: &mut Doc, s: &Strip) -> Result<(), String> {
    let page = get_page(b, d, s.page)?;
    let (pw, ph) = unsafe { (b.FPDF_GetPageWidthF(page), b.FPDF_GetPageHeightF(page)) };
    let bmp = unsafe { b.FPDFBitmap_CreateEx(s.w, s.h, FPDF_BITMAP_BGRA, s.ptr as *mut _, s.stride) };
    if bmp.is_null() {
        return Err("could not create bitmap".into());
    }
    // FPDF_RenderPageBitmapWithMatrix first maps the page into a (0,0)-(W,H) display rect
    // whose size is the page size truncated to whole points, then applies our matrix.
    // Compensate for the truncation so tiles line up exactly with the true page size.
    let sx = s.rs * pw as f64 / (pw as f64).trunc().max(1.0);
    let sy = s.rs * ph as f64 / (ph as f64).trunc().max(1.0);
    let m = FS_MATRIX { a: sx as f32, b: 0.0, c: 0.0, d: sy as f32, e: -s.x as f32, f: -s.y as f32 };
    let clip = FS_RECTF { left: 0.0, top: 0.0, right: s.w as f32, bottom: s.h as f32 };
    let t0 = std::time::Instant::now();
    unsafe {
        b.FPDF_RenderPageBitmapWithMatrix(bmp, page, &m, &clip, FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER);
        b.FPDFBitmap_Destroy(bmp);
    }
    if timing() {
        eprintln!(
            "[pdfium] render page {} rs={:.4} {}x{} at ({},{}) in {} ms",
            s.page + 1, s.rs, s.w, s.h, s.x, s.y, t0.elapsed().as_millis()
        );
    }
    Ok(())
}
