//! PDFium rendering backend: a pool of PDFium instances, each on its own worker thread.
//!
//! PDFium is not thread-safe: all of its state is global to the loaded DLL. To render in
//! parallel anyway we load N *copies* of pdfium.dll under different file names
//! (pdfium.dll, then %TEMP%\vellum-pdfium\<size>-<mtime>\pdfium-1.dll, ...). Windows maps each as a
//! separate module with its own globals, so each copy is an independent PDFium instance. One
//! worker thread owns each instance, every open document and their parsed pages. **Every
//! PDFium call happens on the thread that owns the instance**; other modules get there with
//! [`PdfiumState::run_on_worker`].
//!
//! Documents are identified by an id allocated by `docs.rs` (shared with image documents).
//! Each worker keeps a map from id to its own handle of that document.
//!
//! A region request is split into bands along the page's longer axis ([`split_region`]) and
//! the bands are rendered concurrently, worker *s* always taking band *s*, so each image is
//! decoded and cached by one instance only. [`PdfiumState::render`] has every band write
//! straight into one shared RGBA buffer (FPDFBitmap_CreateEx over an external buffer with the
//! full row stride); [`PdfiumState::render_stream`] gives each band its own buffer and hands it
//! over as soon as that band finishes, for progressive paint.
//!
//! Pixels come back in RGBA order (FPDF_REVERSE_BYTE_ORDER) and are wrapped in ImageData on
//! the front end without conversion.

use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex, OnceLock};

// Constants from fpdfview.h (stable across PDFium versions).
const FPDF_ANNOT: i32 = 0x01;
const FPDF_REVERSE_BYTE_ORDER: i32 = 0x10;
const FPDF_BITMAP_BGRA: i32 = 4;
const FPDF_ERR_FILE: u64 = 2;
const FPDF_ERR_FORMAT: u64 = 3;
const FPDF_ERR_PASSWORD: u64 = 4;
const FPDF_ERR_SECURITY: u64 = 5;

/// Parsed pages kept per document per worker; parsing is the expensive part for heavy pages.
const PAGES_PER_DOC: usize = 16;

/// Regions up to this many pixels render on one worker (see `bands_for`).
const SMALL_REGION_PX: i64 = 512 * 1024;

/// Pages with at least this many objects (forms counted into) are banded even for a small
/// region. The aerial drawing has 327k; the densest ordinary sheet measured, 88k (22 Nov).
pub const HEAVY_PAGE_OBJECTS: usize = 200_000;

/// The worker that owns a page: one-strip renders and the band-count check go there, so a
/// page that isn't banded is parsed by one worker only.
fn page_worker(page: usize, workers: usize) -> usize {
    page % workers.max(1)
}

// Errors the user may see carry a code (errcode.rs); the front end words the message.
pub const ERR_DLL_MISSING: &str = "[pdfium_missing] pdfium.dll not found: run `node tools/fetch-pdfium.mjs`";
pub const ERR_PASSWORD_REQUIRED: &str = "[password_required] Password required";
pub const ERR_WRONG_PASSWORD: &str = "[wrong_password] Wrong password";
pub const ERR_NOT_SUPPORTED: &str = "[not_supported] Not a PDF or supported image";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct PageSize {
    pub w: f32,
    pub h: f32,
}

/// Document-level metadata read from the PDF (all optional).
#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PdfMeta {
    pub pdf_version: Option<String>,
    pub title: Option<String>,
    pub author: Option<String>,
    pub subject: Option<String>,
    pub producer: Option<String>,
    pub creator: Option<String>,
}

/// What the pool reports after opening a PDF.
#[derive(Clone, Debug)]
pub struct PdfOpened {
    pub num_pages: usize,
    pub sizes: Vec<PageSize>,
    pub meta: PdfMeta,
}

/// A region of a page bitmap: device pixels at `rs` device pixels per point.
#[derive(Deserialize, Debug, Clone)]
pub struct RegionArgs {
    /// Request id for cancellation (allocated by the front end; 0 = never cancelled).
    pub id: u64,
    pub page: usize,
    pub rs: f64,
    pub x: i64,
    pub y: i64,
    pub w: i32,
    pub h: i32,
}

/// One bookmark.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OutlineNode {
    pub title: String,
    /// Zero-based target page, if the bookmark points into this document.
    pub page: Option<usize>,
    /// Target position from the top of the page in points, when the destination gives one.
    pub y: Option<f32>,
    pub children: Vec<OutlineNode>,
}

// ------------------------------------------------------------------------------------------
// Band splitting (pure)

/// What a page's own worker found when it first parsed it, kept by the coordinator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageProfile {
    /// A swapped or slow-to-decode image: render on one worker (pdfium_swap::page_one_band).
    pub one_band: bool,
    /// Objects on the page, including those nested in forms.
    pub objects: usize,
}

/// How many workers render a region of `w` x `h` px of a page.
///
/// A small region (zoomed out, often many pages on screen) goes whole to the page's own
/// worker: banding it would make every worker parse every visible page, and with more pages
/// on screen than a worker keeps parsed (PAGES_PER_DOC) they thrash, reparsing pages for
/// seconds. A heavy page is the exception: it is almost always alone on screen, and one
/// worker drawing all of it is the slow part (aerial drawing at fit: 2.3 s on one worker).
pub fn bands_for(w: i32, h: i32, p: PageProfile, max: usize) -> usize {
    let small = (w as i64) * (h as i64) <= SMALL_REGION_PX;
    if p.one_band || (small && p.objects < HEAVY_PAGE_OBJECTS) {
        1
    } else {
        max.max(1)
    }
}

/// The part of a region that one band renders.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BandPart {
    /// Band index, which is also the worker that renders it.
    pub band: usize,
    /// Device-pixel origin of the part within the page bitmap.
    pub x: i64,
    pub y: i64,
    pub w: i32,
    pub h: i32,
    /// Origin of the part relative to the region's top-left corner.
    pub rx: i32,
    pub ry: i32,
    /// Byte offset of the part's top-left pixel in a region buffer of stride `region_w * 4`.
    pub offset: usize,
}

/// Split region (x, y, w, h) of a page bitmap that is `page_w` x `page_h` device pixels into
/// the parts that fall in each of `n` equal bands along the page's longer axis. Band
/// boundaries are rounded to whole pixels; the first and last bands extend to infinity so
/// any region (even one past the rounded page edge) is covered exactly once. Parts come in
/// band order and never overlap; empty parts are omitted.
///
/// An off-by-one here makes two workers write the same bytes or one write past its slice,
/// so this is unit-tested (tests/bands.rs) rather than trusted.
pub fn split_region(page_w: f64, page_h: f64, n: usize, x: i64, y: i64, w: i32, h: i32) -> Vec<BandPart> {
    let n = n.max(1);
    if w <= 0 || h <= 0 {
        return Vec::new();
    }
    let along_x = page_w >= page_h;
    let page_len = if along_x { page_w } else { page_h };
    let (r0, r1) = if along_x { (x, x + w as i64) } else { (y, y + h as i64) };
    let mut out = Vec::with_capacity(n);
    for s in 0..n {
        let b0 = if s == 0 { i64::MIN } else { (page_len * s as f64 / n as f64).round() as i64 };
        let b1 = if s + 1 == n { i64::MAX } else { (page_len * (s + 1) as f64 / n as f64).round() as i64 };
        let p0 = r0.max(b0);
        let p1 = r1.min(b1);
        if p1 <= p0 {
            continue;
        }
        let off = (p0 - r0) as i32;
        let len = (p1 - p0) as i32;
        out.push(if along_x {
            BandPart { band: s, x: p0, y, w: len, h, rx: off, ry: 0, offset: off as usize * 4 }
        } else {
            BandPart { band: s, x, y: p0, w, h: len, rx: 0, ry: off, offset: off as usize * w as usize * 4 }
        });
    }
    out
}

// ------------------------------------------------------------------------------------------
// The pool

/// A strip to render into an externally owned buffer.
struct Strip {
    page: usize,
    rs: f64,
    /// Device-pixel origin of the strip within the page bitmap.
    x: i64,
    y: i64,
    w: i32,
    h: i32,
    /// Address of the strip's top-left pixel in the target buffer, and the row stride.
    ptr: usize,
    stride: i32,
    /// Set when the request this strip belongs to is cancelled: a worker that hasn't
    /// started the strip yet skips it.
    cancel: Option<Arc<AtomicBool>>,
}

enum DocSource {
    Path(PathBuf),
    Memory(Arc<Vec<u8>>),
}

type Job = Box<dyn for<'a> FnOnce(&mut WorkerCtx<'a>) + Send>;

enum WorkerReq {
    Open { doc_id: u64, src: DocSource, password: Option<String>, info: bool, reply: Sender<Result<Option<PdfOpened>, String>> },
    Close { doc_id: u64 },
    /// `tag` comes back with the result so one receiver can collect several strips.
    Render { doc_id: u64, strip: Strip, tag: usize, reply: Sender<(usize, Result<(), String>)> },
    /// Close parsed pages, which frees PDFium's decoded-image caches.
    Trim,
    /// Parse a page and describe it (see `page_profile`). Ok(None) if `cancel` was set before
    /// the worker reached it, so a render abandoned mid-scroll doesn't parse its page.
    Profile { doc_id: u64, page: usize, cancel: Option<Arc<AtomicBool>>, reply: Sender<Result<Option<PageProfile>, String>> },
    Run(Job),
    /// Parse a page into the cache ahead of its first render (no reply).
    Prefetch { doc_id: u64, page: usize },
}

/// Per-document facts the coordinator needs without asking a worker.
struct DocMeta {
    sizes: Vec<PageSize>,
    profiles: HashMap<usize, PageProfile>,
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
    resource_dir: Mutex<Option<PathBuf>>,
    workers: OnceLock<Result<Vec<Sender<WorkerReq>>, String>>,
    /// Ids cancelled before their request started. Guarded by the `running` lock too (taken
    /// first), so a cancel can't fall between a request's check and its registration.
    cancelled: Mutex<HashSet<u64>>,
    /// Cancel flags of requests whose strips are queued on or running in the workers.
    running: Mutex<HashMap<u64, Arc<AtomicBool>>>,
    docs: Mutex<HashMap<u64, DocMeta>>,
    /// Round-robin cursor for single-worker jobs (text, outline, run_on_worker).
    next_worker: AtomicUsize,
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
                resource_dir: Mutex::new(None),
                workers: OnceLock::new(),
                cancelled: Mutex::new(HashSet::new()),
                running: Mutex::new(HashMap::new()),
                docs: Mutex::new(HashMap::new()),
                next_worker: AtomicUsize::new(0),
            }),
        }
    }

    /// Where the bundled pdfium.dll lives in an installed build (set once at startup).
    pub fn set_resource_dir(&self, dir: Option<PathBuf>) {
        *self.inner.resource_dir.lock().unwrap() = dir;
    }

    /// The worker channels, starting the pool on first use.
    fn workers(&self) -> Result<&Vec<Sender<WorkerReq>>, String> {
        self.inner
            .workers
            .get_or_init(|| {
                let dir = self.inner.resource_dir.lock().unwrap().clone();
                start_workers(self.inner.threads, dir)
            })
            .as_ref()
            .map_err(|e| e.clone())
    }

    /// Number of PDFium instances (starts the pool if needed).
    pub fn worker_count(&self) -> Result<usize, String> {
        Ok(self.workers()?.len())
    }

    /// Open a PDF file on every worker under `doc_id`.
    pub fn open(&self, doc_id: u64, path: &Path, password: Option<&str>) -> Result<PdfOpened, String> {
        self.open_src(doc_id, |_| DocSource::Path(path.to_path_buf()), password)
    }

    /// Open a PDF held in memory (for example one composed for printing) on every worker.
    /// The bytes are shared by all workers and freed when the document is closed.
    pub fn open_memory(&self, doc_id: u64, bytes: Arc<Vec<u8>>, password: Option<&str>) -> Result<PdfOpened, String> {
        self.open_src(doc_id, |_| DocSource::Memory(bytes.clone()), password)
    }

    fn open_src(&self, doc_id: u64, src: impl Fn(usize) -> DocSource, password: Option<&str>) -> Result<PdfOpened, String> {
        let workers = self.workers()?;
        let replies: Vec<_> = workers
            .iter()
            .enumerate()
            .map(|(i, w)| {
                let (tx, rx) = channel();
                let req = WorkerReq::Open { doc_id, src: src(i), password: password.map(str::to_owned), info: i == 0, reply: tx };
                let _ = w.send(req);
                rx
            })
            .collect();
        let mut info = None;
        let mut err = None;
        for rx in replies {
            match rx.recv().map_err(|e| e.to_string()).and_then(|r| r) {
                Ok(Some(i)) => info = Some(i),
                Ok(None) => {}
                Err(e) => err = Some(e),
            }
        }
        if let Some(e) = err {
            // Some workers may have opened it; don't leave those handles behind.
            for w in workers {
                let _ = w.send(WorkerReq::Close { doc_id });
            }
            return Err(e);
        }
        let info = info.ok_or("no workers")?;
        // Parsing a heavy page takes most of a second. Worker 0 parses the first page anyway
        // (to decide its band count before the first render); have the others parse it at
        // the same time instead of after, so their bands are ready to render sooner.
        // VELLUM_PDFIUM_PREFETCH=0 turns this off (it trades a later first band for an
        // earlier fully sharp page on heavy drawings; see docs/v0.1-handoff/engine.md).
        if info.num_pages > 0 && std::env::var("VELLUM_PDFIUM_PREFETCH").map_or(true, |v| v != "0") {
            for w in workers.iter().skip(1) {
                let _ = w.send(WorkerReq::Prefetch { doc_id, page: 0 });
            }
        }
        self.inner
            .docs
            .lock()
            .unwrap()
            .insert(doc_id, DocMeta { sizes: info.sizes.clone(), profiles: HashMap::new() });
        Ok(info)
    }

    /// Close the document on every worker, freeing its parsed pages and image caches.
    pub fn close(&self, doc_id: u64) {
        self.inner.docs.lock().unwrap().remove(&doc_id);
        if let Ok(workers) = self.workers() {
            for w in workers {
                let _ = w.send(WorkerReq::Close { doc_id });
            }
        }
    }

    pub fn page_sizes(&self, doc_id: u64) -> Option<Vec<PageSize>> {
        self.inner.docs.lock().unwrap().get(&doc_id).map(|d| d.sizes.clone())
    }

    fn page_size(&self, doc_id: u64, page: usize) -> Result<PageSize, String> {
        let docs = self.inner.docs.lock().unwrap();
        let d = docs.get(&doc_id).ok_or("document not open")?;
        d.sizes.get(page).copied().ok_or_else(|| format!("no page {}", page + 1))
    }

    /// Start tracking request `id`: its cancel flag, or None if it was cancelled before it
    /// started (or has no id, in which case it can't be cancelled and gets no flag).
    fn begin(&self, id: u64) -> Result<Option<Arc<AtomicBool>>, ()> {
        if id == 0 {
            return Ok(None);
        }
        let mut running = self.inner.running.lock().unwrap();
        if self.inner.cancelled.lock().unwrap().remove(&id) {
            return Err(());
        }
        let flag = Arc::new(AtomicBool::new(false));
        running.insert(id, flag.clone());
        Ok(Some(flag))
    }

    /// Stop tracking request `id`; true if it was cancelled while it ran.
    fn end(&self, id: u64, flag: &Option<Arc<AtomicBool>>) -> bool {
        if id != 0 {
            self.inner.running.lock().unwrap().remove(&id);
        }
        flag.as_ref().is_some_and(|f| f.load(Ordering::Relaxed))
    }

    /// Plan a region render: band parts in band order, and the worker each part goes to.
    /// `one_worker` skips the page profile and renders on the page's own worker (thumbnails:
    /// nobody waits on them, and banding them would have every worker parse every heavy page).
    /// None if the request was cancelled while the page's profile was being found.
    #[allow(clippy::type_complexity)]
    fn plan(
        &self,
        doc_id: u64,
        a: &RegionArgs,
        cancel: &Option<Arc<AtomicBool>>,
        one_worker: bool,
    ) -> Result<Option<(Vec<BandPart>, Vec<usize>)>, String> {
        if a.w <= 0 || a.h <= 0 {
            return Err("empty region".into());
        }
        let workers = self.workers()?;
        let n = if one_worker {
            1
        } else {
            match self.profile(workers, doc_id, a.page, cancel)? {
                Some(p) => bands_for(a.w, a.h, p, workers.len()),
                None => return Ok(None),
            }
        };
        let size = self.page_size(doc_id, a.page)?;
        let parts = split_region(size.w as f64 * a.rs, size.h as f64 * a.rs, n, a.x, a.y, a.w, a.h);
        // Banded: band k renders on worker k. Unbanded: the page's own worker, so each page is
        // parsed once and different pages still render in parallel on different workers.
        let to = parts.iter().map(|p| if n == 1 { page_worker(a.page, workers.len()) } else { p.band }).collect();
        Ok(Some((parts, to)))
    }

    /// Render a region into one RGBA buffer (w*h*4, opaque white background). None if the
    /// request was cancelled before it started.
    pub fn render(&self, doc_id: u64, a: RegionArgs) -> Result<Option<Vec<u8>>, String> {
        self.render_region(doc_id, a, false)
    }

    fn render_region(&self, doc_id: u64, a: RegionArgs, one_worker: bool) -> Result<Option<Vec<u8>>, String> {
        let Ok(cancel) = self.begin(a.id) else {
            return Ok(None);
        };
        let r = self.render_inner(doc_id, &a, &cancel, one_worker);
        if self.end(a.id, &cancel) {
            return Ok(None); // some strips were skipped: the buffer is incomplete
        }
        r
    }

    fn render_inner(
        &self,
        doc_id: u64,
        a: &RegionArgs,
        cancel: &Option<Arc<AtomicBool>>,
        one_worker: bool,
    ) -> Result<Option<Vec<u8>>, String> {
        let Some((parts, to)) = self.plan(doc_id, a, cancel, one_worker)? else {
            return Ok(None);
        };
        let workers = self.workers()?;
        let stride = a.w * 4;
        let mut buf = vec![0xFFu8; stride as usize * a.h as usize];
        let base = buf.as_mut_ptr() as usize;
        let (tx, rx) = channel();
        let mut sent = 0;
        let mut err = None;
        for (p, &w) in parts.iter().zip(&to) {
            let strip = Strip { page: a.page, rs: a.rs, x: p.x, y: p.y, w: p.w, h: p.h, ptr: base + p.offset, stride, cancel: cancel.clone() };
            if let Err(e) = workers[w].send(WorkerReq::Render { doc_id, strip, tag: p.band, reply: tx.clone() }) {
                // Don't return yet: strips already sent may still be writing into `buf`.
                err = Some(e.to_string());
                break;
            }
            sent += 1;
        }
        drop(tx);
        // Wait for every strip before touching or returning `buf`: workers write into it.
        for _ in 0..sent {
            match rx.recv() {
                Ok((_, Ok(()))) => {}
                Ok((_, Err(e))) => err = Some(e),
                Err(e) => err = Some(e.to_string()),
            }
        }
        self.maybe_trim(workers);
        match err {
            Some(e) => Err(e),
            None => Ok(Some(buf)),
        }
    }

    /// Render a region band by band, calling `on_band` with each band's part and its own
    /// RGBA buffer (part.w * part.h * 4, tightly packed) in the order the bands finish.
    /// Returns the number of bands delivered, or None if cancelled before it started.
    /// If `on_band` returns false (the receiver has gone), remaining bands are still waited
    /// for (they write into buffers owned here) but not delivered.
    pub fn render_stream(
        &self,
        doc_id: u64,
        a: RegionArgs,
        on_band: impl FnMut(&BandPart, Vec<u8>) -> bool,
    ) -> Result<Option<usize>, String> {
        let Ok(cancel) = self.begin(a.id) else {
            return Ok(None);
        };
        let r = self.render_stream_inner(doc_id, &a, &cancel, on_band);
        self.end(a.id, &cancel);
        r
    }

    fn render_stream_inner(
        &self,
        doc_id: u64,
        a: &RegionArgs,
        cancel: &Option<Arc<AtomicBool>>,
        mut on_band: impl FnMut(&BandPart, Vec<u8>) -> bool,
    ) -> Result<Option<usize>, String> {
        let Some((parts, to)) = self.plan(doc_id, a, cancel, false)? else {
            return Ok(None);
        };
        let workers = self.workers()?;
        // Allocate every buffer before taking pointers so none moves while workers write.
        // Spare capacity lets the IPC layer append its trailer without copying the band.
        let mut bufs: Vec<Option<Vec<u8>>> = parts
            .iter()
            .map(|p| {
                let n = p.w as usize * p.h as usize * 4;
                let mut v = Vec::with_capacity(n + crate::docs::STREAM_TRAILER);
                v.resize(n, 0xFF);
                Some(v)
            })
            .collect();
        let (tx, rx) = channel();
        let mut sent = 0;
        let mut err = None;
        for (k, p) in parts.iter().enumerate() {
            let ptr = bufs[k].as_mut().unwrap().as_mut_ptr() as usize;
            let strip = Strip { page: a.page, rs: a.rs, x: p.x, y: p.y, w: p.w, h: p.h, ptr, stride: p.w * 4, cancel: cancel.clone() };
            if let Err(e) = workers[to[k]].send(WorkerReq::Render { doc_id, strip, tag: k, reply: tx.clone() }) {
                err = Some(e.to_string());
                break;
            }
            sent += 1;
        }
        drop(tx);
        let mut delivered = 0;
        let mut open = true;
        for _ in 0..sent {
            match rx.recv() {
                Ok((k, Ok(()))) => {
                    // A cancelled request's skipped strips are blank: never deliver them.
                    let cancelled = cancel.as_ref().is_some_and(|f| f.load(Ordering::Relaxed));
                    if open && err.is_none() && !cancelled {
                        let b = bufs[k].take().unwrap();
                        open = on_band(&parts[k], b);
                        if open {
                            delivered += 1;
                        }
                    }
                }
                Ok((_, Err(e))) => err = Some(e),
                Err(e) => err = Some(e.to_string()),
            }
        }
        self.maybe_trim(workers);
        match err {
            Some(e) => Err(e),
            None => Ok(Some(delivered)),
        }
    }

    /// Whole page scaled so its longer side is `max_side` device pixels: (w, h, rgba).
    pub fn thumbnail(&self, doc_id: u64, page: usize, max_side: u32) -> Result<(u32, u32, Vec<u8>), String> {
        let size = self.page_size(doc_id, page)?;
        let rs = max_side.max(1) as f64 / size.w.max(size.h).max(1.0) as f64;
        let w = ((size.w as f64 * rs).ceil() as i32).max(1);
        let h = ((size.h as f64 * rs).ceil() as i32).max(1);
        let buf = self
            .render_region(doc_id, RegionArgs { id: 0, page, rs, x: 0, y: 0, w, h }, true)?
            .ok_or("cancelled")?;
        Ok((w as u32, h as u32, buf))
    }

    /// Memory guard. Image-heavy drawings make PDFium cache gigabytes of decoded images per
    /// parsed page. Closing a page frees them; the worker re-parses it straight away (in the
    /// background, before its next request) so the next render doesn't pay for it.
    fn maybe_trim(&self, workers: &[Sender<WorkerReq>]) {
        if !self.inner.trim_above_mb.is_finite() {
            return;
        }
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
    }

    /// How many workers a `w` x `h` region of a page renders on, if the page's profile is
    /// already known (its first render has been planned), without asking a worker. Lets the
    /// front end tell a one-worker render from a banded one.
    pub fn known_bands(&self, doc_id: u64, page: usize, w: i32, h: i32) -> Option<usize> {
        let p = *self.inner.docs.lock().unwrap().get(&doc_id)?.profiles.get(&page)?;
        Some(bands_for(w, h, p, self.inner.threads))
    }

    /// A page's profile, asked of the page's own worker once and remembered. None if the
    /// request was cancelled before the worker got to it (nothing is remembered then).
    fn profile(
        &self,
        workers: &[Sender<WorkerReq>],
        doc_id: u64,
        page: usize,
        cancel: &Option<Arc<AtomicBool>>,
    ) -> Result<Option<PageProfile>, String> {
        if let Some(&p) = self.inner.docs.lock().unwrap().get(&doc_id).and_then(|d| d.profiles.get(&page)) {
            return Ok(Some(p));
        }
        let (tx, rx) = channel();
        workers[page_worker(page, workers.len())]
            .send(WorkerReq::Profile { doc_id, page, cancel: cancel.clone(), reply: tx })
            .map_err(|e| e.to_string())?;
        let p = rx.recv().map_err(|e| e.to_string())??;
        if let (Some(p), Some(d)) = (p, self.inner.docs.lock().unwrap().get_mut(&doc_id)) {
            d.profiles.insert(page, p);
        }
        Ok(p)
    }

    pub fn trims(&self) -> usize {
        self.inner.trims.load(Ordering::Relaxed)
    }

    /// Cancel a request. One that hasn't started is skipped; one that has skips every strip
    /// a worker hasn't begun yet. (A strip already inside PDFium completes.)
    pub fn cancel(&self, id: u64) {
        let running = self.inner.running.lock().unwrap();
        if let Some(f) = running.get(&id) {
            f.store(true, Ordering::Relaxed);
            return;
        }
        let mut c = self.inner.cancelled.lock().unwrap();
        // Cancels that arrive after their render finished are never consumed; don't let
        // them accumulate for the life of the process.
        if c.len() > 4096 {
            c.clear();
        }
        c.insert(id);
    }

    /// Run `f` on one PDFium worker thread (round robin) with that worker's instance and
    /// documents, and wait for its result. This is the only way other modules (printing,
    /// composing) may call PDFium: never call it off its worker thread. Blocks the caller, so
    /// call it from `spawn_blocking` or another non-UI thread. `f` runs between renders on
    /// that worker, so keep it short or the visible tiles queued behind it wait.
    pub fn run_on_worker<R, F>(&self, f: F) -> Result<R, String>
    where
        R: Send + 'static,
        F: for<'a> FnOnce(&mut WorkerCtx<'a>) -> R + Send + 'static,
    {
        let n = self.worker_count()?;
        let i = self.inner.next_worker.fetch_add(1, Ordering::Relaxed) % n;
        self.run_on_worker_index(i, f)
    }

    /// As [`run_on_worker`](Self::run_on_worker), on a specific worker (0..worker_count).
    pub fn run_on_worker_index<R, F>(&self, index: usize, f: F) -> Result<R, String>
    where
        R: Send + 'static,
        F: for<'a> FnOnce(&mut WorkerCtx<'a>) -> R + Send + 'static,
    {
        let workers = self.workers()?;
        let w = workers.get(index).ok_or("no such worker")?;
        let (tx, rx) = channel();
        let job: Job = Box::new(move |ctx| {
            let _ = tx.send(f(ctx));
        });
        w.send(WorkerReq::Run(job)).map_err(|e| e.to_string())?;
        rx.recv().map_err(|_| "PDFium worker stopped".to_string())
    }

    /// The page's text in reading order, as PDFium extracts it.
    pub fn page_text(&self, doc_id: u64, page: usize) -> Result<String, String> {
        self.run_on_worker(move |ctx| {
            let b = ctx.bindings();
            let p = ctx.page(doc_id, page)?;
            with_text_page(b, p, |tp| {
                let n = unsafe { b.FPDFText_CountChars(tp) }.max(0);
                if n == 0 {
                    return Ok(String::new());
                }
                let mut buf = vec![0u16; n as usize + 1];
                let got = unsafe { b.FPDFText_GetText(tp, 0, n, buf.as_mut_ptr()) }.max(0) as usize;
                buf.truncate(got.min(buf.len()));
                while buf.last() == Some(&0) {
                    buf.pop();
                }
                Ok(String::from_utf16_lossy(&buf))
            })
        })?
    }

    /// Scale notes ("1:100", "1 : 50", "1/200") on a page, best first (see scale.rs).
    pub fn find_scale(&self, doc_id: u64, page: usize) -> Result<Vec<crate::scale::ScaleCandidate>, String> {
        let size = self.page_size(doc_id, page)?;
        self.run_on_worker(move |ctx| {
            let b = ctx.bindings();
            let p = ctx.page(doc_id, page)?;
            // Char boxes are in user space; the frame applies /Rotate and the page box origin.
            let frame = crate::text::page_frame(b, p);
            with_text_page(b, p, |tp| {
                let n = unsafe { b.FPDFText_CountChars(tp) }.max(0);
                // One char per PDFium char index, so match positions map straight to char boxes.
                let chars: Vec<char> = (0..n)
                    .map(|i| char::from_u32(unsafe { b.FPDFText_GetUnicode(tp, i) }).unwrap_or('\u{FFFD}'))
                    .collect();
                let raw = crate::scale::find_scale_matches(&chars)
                    .into_iter()
                    .filter_map(|m| {
                        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
                        for i in m.start..m.end {
                            let (mut l, mut r, mut bo, mut t) = (0f64, 0f64, 0f64, 0f64);
                            let ok = unsafe { b.FPDFText_GetCharBox(tp, i as i32, &mut l, &mut r, &mut bo, &mut t) };
                            if ok == 0 || (r - l).abs() < 1e-9 && (t - bo).abs() < 1e-9 {
                                continue; // generated or invisible char
                            }
                            // Report page points, y down from the top of the page as shown.
                            let q = frame.rect(l, bo, r, t);
                            x0 = x0.min(q[0] as f64);
                            y0 = y0.min(q[1] as f64);
                            x1 = x1.max(q[2] as f64);
                            y1 = y1.max(q[3] as f64);
                        }
                        (x0 <= x1).then(|| crate::scale::RawCandidate {
                            ratio: m.ratio,
                            text: m.text,
                            bbox: [x0, y0, x1, y1],
                            labelled: m.labelled,
                            sheet: m.sheet,
                        })
                    })
                    .collect();
                Ok(crate::scale::rank_candidates(raw, size.w as f64, size.h as f64))
            })
        })?
    }

    /// The document's bookmarks as a tree.
    pub fn outline(&self, doc_id: u64) -> Result<Vec<OutlineNode>, String> {
        self.run_on_worker(move |ctx| {
            let doc = ctx.document(doc_id).ok_or("document not open")?;
            Ok(read_outline(ctx.bindings(), doc))
        })?
    }
}

/// Load the text layer of a parsed page for the duration of `f`.
pub(crate) fn with_text_page<R>(
    b: &dyn PdfiumLibraryBindings,
    page: FPDF_PAGE,
    f: impl FnOnce(FPDF_TEXTPAGE) -> Result<R, String>,
) -> Result<R, String> {
    let tp = unsafe { b.FPDFText_LoadPage(page) };
    if tp.is_null() {
        return Err("could not read the page's text".into());
    }
    let r = f(tp);
    unsafe { b.FPDFText_ClosePage(tp) };
    r
}

/// Walk the bookmark tree. Bounded (depth, count, loop detection) because malformed files
/// can link bookmarks in a cycle.
fn read_outline(b: &dyn PdfiumLibraryBindings, doc: FPDF_DOCUMENT) -> Vec<OutlineNode> {
    const MAX_NODES: usize = 20_000;
    const MAX_DEPTH: usize = 64;
    let mut seen = HashSet::new();
    fn walk(
        b: &dyn PdfiumLibraryBindings,
        doc: FPDF_DOCUMENT,
        parent: FPDF_BOOKMARK,
        depth: usize,
        seen: &mut HashSet<usize>,
    ) -> Vec<OutlineNode> {
        let mut out = Vec::new();
        if depth > MAX_DEPTH {
            return out;
        }
        let mut bm = unsafe { b.FPDFBookmark_GetFirstChild(doc, parent) };
        while !bm.is_null() && seen.len() < MAX_NODES && seen.insert(bm as usize) {
            let title = utf16_text(|buf, len| unsafe { b.FPDFBookmark_GetTitle(bm, buf, len) });
            let mut dest = unsafe { b.FPDFBookmark_GetDest(doc, bm) };
            if dest.is_null() {
                let action = unsafe { b.FPDFBookmark_GetAction(bm) };
                if !action.is_null() {
                    dest = unsafe { b.FPDFAction_GetDest(doc, action) };
                }
            }
            let (mut page, mut y) = (None, None);
            if !dest.is_null() {
                let idx = unsafe { b.FPDFDest_GetDestPageIndex(doc, dest) };
                if idx >= 0 {
                    page = Some(idx as usize);
                    let (mut hx, mut hy, mut hz) = (0, 0, 0);
                    let (mut dx, mut dy, mut dz) = (0f32, 0f32, 0f32);
                    let ok = unsafe { b.FPDFDest_GetLocationInPage(dest, &mut hx, &mut hy, &mut hz, &mut dx, &mut dy, &mut dz) };
                    if ok != 0 && hy != 0 {
                        let mut s = FS_SIZEF { width: 0.0, height: 0.0 };
                        if unsafe { b.FPDF_GetPageSizeByIndexF(doc, idx, &mut s) } != 0 {
                            y = Some((s.height - dy).clamp(0.0, s.height));
                        }
                    }
                }
            }
            let children = walk(b, doc, bm, depth + 1, seen);
            out.push(OutlineNode { title, page, y, children });
            bm = unsafe { b.FPDFBookmark_GetNextSibling(doc, bm) };
        }
        out
    }
    walk(b, doc, std::ptr::null_mut(), 0, &mut seen)
}

/// Call a PDFium "fill this UTF-16LE buffer, return bytes needed" function twice and decode.
fn utf16_text(mut get: impl FnMut(*mut std::ffi::c_void, std::ffi::c_ulong) -> std::ffi::c_ulong) -> String {
    let need = get(std::ptr::null_mut(), 0) as usize;
    if need <= 2 {
        return String::new();
    }
    let mut buf = vec![0u16; need.div_ceil(2)];
    get(buf.as_mut_ptr() as *mut _, (buf.len() * 2) as std::ffi::c_ulong);
    while buf.last() == Some(&0) {
        buf.pop();
    }
    String::from_utf16_lossy(&buf).trim().to_string()
}

/// Access to one worker's PDFium instance and its open documents, for code running on that
/// worker through [`PdfiumState::run_on_worker`]. Handles from here are only valid on this
/// worker and only during the call; never send them elsewhere or keep them.
pub struct WorkerCtx<'a> {
    b: &'a dyn PdfiumLibraryBindings,
    docs: &'a mut HashMap<u64, Doc>,
    /// Which worker this is (0..worker_count).
    pub index: usize,
}

impl<'a> WorkerCtx<'a> {
    /// The raw PDFium API of this worker's instance.
    pub fn bindings(&self) -> &'a dyn PdfiumLibraryBindings {
        self.b
    }

    /// This worker's handle for an open document.
    pub fn document(&self, doc_id: u64) -> Option<FPDF_DOCUMENT> {
        self.docs.get(&doc_id).map(|d| d.handle)
    }

    /// A parsed page of an open document, from this worker's cache. Owned by the cache:
    /// don't close it.
    pub fn page(&mut self, doc_id: u64, index: usize) -> Result<FPDF_PAGE, String> {
        let d = self.docs.get_mut(&doc_id).ok_or("document not open")?;
        get_page(self.b, d, index)
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
    eprintln!("[pdfium] pdfium.dll not found; searched {}", searched.join(", "));
    Err(ERR_DLL_MISSING.into())
}

/// Root of the renamed DLL copies: %TEMP%\vellum-pdfium.
fn copies_root() -> PathBuf {
    std::env::temp_dir().join("vellum-pdfium")
}

/// Folder name for copies of one particular pdfium.dll: its size and modification time
/// (seconds since the epoch). A new pdfium.dll gets a new folder; the same one is shared by
/// every Vellum process.
pub fn copies_key(size: u64, mtime_secs: u64) -> String {
    format!("{size}-{mtime_secs}")
}

/// Where the copies of `original` live under `root`.
pub fn copies_dir_for(root: &Path, original: &Path) -> Result<PathBuf, String> {
    let m = std::fs::metadata(original).map_err(|e| format!("{}: {e}", original.display()))?;
    let mtime = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    Ok(root.join(copies_key(m.len(), mtime)))
}

/// Make sure `dest` is a complete copy of `original`, reusing it if it already is.
///
/// Copies are shared across processes and reused across launches: writing fresh DLLs on
/// every start made Windows Defender scan each one before it could load (about 300 ms per
/// open on the v0.1 benchmark). An existing copy is never overwritten, because another
/// running Vellum may have it mapped; a new one is written to a temporary name and renamed
/// into place, so a process starting at the same moment never loads half a file.
pub fn ensure_copy(original: &Path, dest: &Path) -> Result<(), String> {
    let want = std::fs::metadata(original).map_err(|e| e.to_string())?.len();
    if std::fs::metadata(dest).is_ok_and(|m| m.len() == want) {
        return Ok(());
    }
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = dest.with_extension(format!("tmp{}", std::process::id()));
    std::fs::copy(original, &tmp).map_err(|e| format!("copy {}: {e}", tmp.display()))?;
    // Another process may have finished the same copy meanwhile: keep theirs.
    if std::fs::metadata(dest).is_ok_and(|m| m.len() == want) {
        let _ = std::fs::remove_file(&tmp);
        return Ok(());
    }
    let r = std::fs::rename(&tmp, dest);
    let _ = std::fs::remove_file(&tmp);
    match r {
        Ok(()) => Ok(()),
        // Lost a race to a copy that is now in use: fine as long as it's complete.
        Err(_) if std::fs::metadata(dest).is_ok_and(|m| m.len() == want) => Ok(()),
        Err(e) => Err(format!("copy {}: {e}", dest.display())),
    }
}

/// Delete everything under `root` except `keep`: copies of older pdfium.dll builds, the
/// per-process folders of an earlier v0.1 build, and the pre-v0.1 flat layout. Best effort:
/// a DLL still loaded by a running Vellum can't be deleted and is skipped, and anything
/// touched in the last minute is left alone in case another process is still copying.
pub fn clean_other_copies(root: &Path, keep: &Path) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p == keep {
            continue;
        }
        let recent = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age.as_secs() < 60);
        if recent {
            continue;
        }
        if p.is_dir() {
            let _ = std::fs::remove_dir_all(&p);
        } else {
            let _ = std::fs::remove_file(&p);
        }
    }
}

/// Worker i > 0 loads its own renamed copy so it gets a separate module instance.
fn library_copy(original: &Path, dir: &Path, i: usize) -> Result<PathBuf, String> {
    if i == 0 {
        return Ok(original.to_path_buf());
    }
    let dest = dir.join(format!("pdfium-{i}.dll"));
    ensure_copy(original, &dest)?;
    Ok(dest)
}

fn start_workers(n: usize, resource_dir: Option<PathBuf>) -> Result<Vec<Sender<WorkerReq>>, String> {
    let original = find_library(resource_dir)?;
    let root = copies_root();
    let dir = copies_dir_for(&root, &original)?;
    clean_other_copies(&root, &dir);
    let mut senders = Vec::with_capacity(n);
    let mut readies = Vec::with_capacity(n);
    for i in 0..n {
        let lib = library_copy(&original, &dir, i)?;
        let (tx, rx) = channel::<WorkerReq>();
        let (ready_tx, ready_rx) = channel::<Result<(), String>>();
        std::thread::Builder::new()
            .name(format!("pdfium-{i}"))
            .spawn(move || worker(i, lib, rx, ready_tx))
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
    /// Least recently used first.
    order: Vec<usize>,
    /// Keeps an in-memory document's bytes alive while PDFium reads them.
    _bytes: Option<Arc<Vec<u8>>>,
}

fn worker(index: usize, lib: PathBuf, rx: Receiver<WorkerReq>, ready: Sender<Result<(), String>>) {
    let b = match Pdfium::bind_to_library(&lib) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[pdfium] could not load {}: {e:?}", lib.display());
            let _ = ready.send(Err(crate::errcode::coded("pdfium_load", format!("Couldn't load PDFium ({}): {e:?}", lib.display()))));
            return;
        }
    };
    unsafe { b.FPDF_InitLibrary() };
    let _ = ready.send(Ok(()));

    let mut docs: HashMap<u64, Doc> = HashMap::new();
    while let Ok(req) = rx.recv() {
        match req {
            WorkerReq::Open { doc_id, src, password, info, reply } => {
                if let Some(d) = docs.remove(&doc_id) {
                    close_doc(b.as_ref(), d);
                }
                let r = open_doc(b.as_ref(), src, password.as_deref(), info).map(|(d, i)| {
                    docs.insert(doc_id, d);
                    i
                });
                let _ = reply.send(r);
            }
            WorkerReq::Close { doc_id } => {
                if let Some(d) = docs.remove(&doc_id) {
                    close_doc(b.as_ref(), d);
                }
            }
            WorkerReq::Trim => {
                for d in docs.values_mut() {
                    let loaded = std::mem::take(&mut d.order);
                    for (_, p) in d.pages.drain() {
                        unsafe { b.FPDF_ClosePage(p) };
                    }
                    for i in loaded {
                        let _ = get_page(b.as_ref(), d, i);
                    }
                }
            }
            WorkerReq::Profile { doc_id, page, cancel, reply } => {
                let r = if cancel.as_ref().is_some_and(|f| f.load(Ordering::Relaxed)) {
                    Ok(None)
                } else {
                    match docs.get_mut(&doc_id) {
                        Some(d) => page_profile(b.as_ref(), d, page).map(Some),
                        None => Err("document not open".into()),
                    }
                };
                let _ = reply.send(r);
            }
            WorkerReq::Render { doc_id, strip, tag, reply } => {
                let skip = strip.cancel.as_ref().is_some_and(|f| f.load(Ordering::Relaxed));
                let r = if skip {
                    Ok(())
                } else {
                    match docs.get_mut(&doc_id) {
                        Some(d) => render_strip(b.as_ref(), d, &strip),
                        None => Err("document not open".into()),
                    }
                };
                let _ = reply.send((tag, r));
            }
            WorkerReq::Prefetch { doc_id, page } => {
                if let Some(d) = docs.get_mut(&doc_id) {
                    let _ = get_page(b.as_ref(), d, page);
                }
            }
            WorkerReq::Run(job) => {
                let mut ctx = WorkerCtx { b: b.as_ref(), docs: &mut docs, index };
                job(&mut ctx);
            }
        }
    }
}

fn open_doc(
    b: &dyn PdfiumLibraryBindings,
    src: DocSource,
    password: Option<&str>,
    want_info: bool,
) -> Result<(Doc, Option<PdfOpened>), String> {
    let lod_path = match &src { DocSource::Path(p) => Some(p.clone()), DocSource::Memory(_) => None }; // WP-LOD
    let reopen = match &src {
        DocSource::Path(p) => crate::pdfium_swap::Reopen::Path(p.clone()),
        DocSource::Memory(m) => crate::pdfium_swap::Reopen::Memory(m.clone()),
    };
    let (handle, bytes) = match src {
        DocSource::Path(p) => (unsafe { b.FPDF_LoadDocument(&p.to_string_lossy(), password) }, None),
        DocSource::Memory(m) => (unsafe { b.FPDF_LoadMemDocument64(&m, password) }, Some(m)),
    };
    if handle.is_null() {
        let code = unsafe { b.FPDF_GetLastError() } as u64;
        return Err(match code {
            FPDF_ERR_PASSWORD if password.is_none_or(str::is_empty) => ERR_PASSWORD_REQUIRED.into(),
            FPDF_ERR_PASSWORD => ERR_WRONG_PASSWORD.into(),
            FPDF_ERR_FORMAT => ERR_NOT_SUPPORTED.into(),
            FPDF_ERR_FILE => crate::errcode::coded("read_failed", "PDFium couldn't read the file"),
            FPDF_ERR_SECURITY => crate::errcode::coded("unsupported_security", "unsupported security handler"),
            c => crate::errcode::coded("open_failed", format!("PDFium couldn't open the file (error {c})")),
        });
    }
    crate::pdfium_lod::on_open(handle, lod_path); // WP-LOD
    crate::pdfium_swap::on_open(handle, reopen, password.map(str::to_owned));
    let mut d = Doc { handle, pages: HashMap::new(), order: Vec::new(), _bytes: bytes };
    if !want_info {
        return Ok((d, None));
    }
    let n = unsafe { b.FPDF_GetPageCount(handle) }.max(0) as usize;
    let mut sizes = Vec::with_capacity(n);
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
    let meta = read_meta(b, handle);
    Ok((d, Some(PdfOpened { num_pages: n, sizes, meta })))
}

fn read_meta(b: &dyn PdfiumLibraryBindings, doc: FPDF_DOCUMENT) -> PdfMeta {
    let text = |tag: &str| {
        let s = utf16_text(|buf, len| unsafe { b.FPDF_GetMetaText(doc, tag, buf, len) });
        (!s.is_empty()).then_some(s)
    };
    let mut v = 0;
    let version = (unsafe { b.FPDF_GetFileVersion(doc, &mut v) } != 0 && v > 0).then(|| format!("{}.{}", v / 10, v % 10));
    PdfMeta {
        pdf_version: version,
        title: text("Title"),
        author: text("Author"),
        subject: text("Subject"),
        producer: text("Producer"),
        creator: text("Creator"),
    }
}

/// A parsed page from the document's cache, parsing it on a miss (least recently used page
/// evicted beyond PAGES_PER_DOC).
fn get_page(b: &dyn PdfiumLibraryBindings, d: &mut Doc, i: usize) -> Result<FPDF_PAGE, String> {
    if let Some(p) = d.pages.get(&i) {
        let p = *p;
        if let Some(k) = d.order.iter().position(|&x| x == i) {
            d.order.remove(k);
        }
        d.order.push(i);
        return Ok(p);
    }
    let p = load_page(b, d.handle, i)?;
    if d.pages.len() >= PAGES_PER_DOC && !d.order.is_empty() {
        let old = d.order.remove(0);
        if let Some(op) = d.pages.remove(&old) {
            unsafe { b.FPDF_ClosePage(op) };
        }
    }
    d.pages.insert(i, p);
    d.order.push(i);
    Ok(p)
}

/// Parse one page. Every page any worker renders, measures or reads text from is parsed here
/// and nowhere else, so this is the hook point for work that must happen once per parsed
/// page (WP-LOD's downsampled-image swap goes here or immediately after it).
fn load_page(b: &dyn PdfiumLibraryBindings, doc: FPDF_DOCUMENT, i: usize) -> Result<FPDF_PAGE, String> {
    let t0 = std::time::Instant::now();
    let p = unsafe { b.FPDF_LoadPage(doc, i as i32) };
    if p.is_null() {
        return Err(format!("could not load page {}", i + 1));
    }
    if timing() {
        eprintln!("[pdfium] load page {} in {} ms", i + 1, t0.elapsed().as_millis());
    }
    Ok(p)
}

/// Objects on a page, including those nested in form XObjects (to the same depth as
/// pdfium_swap::page_images).
fn count_objects(b: &dyn PdfiumLibraryBindings, page: FPDF_PAGE) -> usize {
    const FPDF_PAGEOBJ_FORM: i32 = 5; // fpdf_edit.h
    unsafe {
        let mut n = 0;
        let mut stack: Vec<(FPDF_PAGEOBJECT, usize)> =
            (0..b.FPDFPage_CountObjects(page).max(0)).map(|i| (b.FPDFPage_GetObject(page, i), 1)).collect();
        while let Some((o, depth)) = stack.pop() {
            if o.is_null() {
                continue;
            }
            n += 1;
            if b.FPDFPageObj_GetType(o) == FPDF_PAGEOBJ_FORM && depth < 8 {
                for j in 0..b.FPDFFormObj_CountObjects(o).max(0) {
                    stack.push((b.FPDFFormObj_GetObject(o, j as _), depth + 1));
                }
            }
        }
        n
    }
}

/// Parse a page and describe it for `bands_for`. A swapped image is held by every worker that
/// renders its page, and an image that's slow to decode is decoded by every one, so those
/// pages render on one worker (pdfium_swap::one_band). The object count picks out pages heavy
/// enough to band even when zoomed out.
fn page_profile(b: &dyn PdfiumLibraryBindings, d: &mut Doc, page: usize) -> Result<PageProfile, String> {
    let p = get_page(b, d, page)?;
    let one_band = crate::pdfium_swap::page_one_band(b, p);
    let t0 = std::time::Instant::now();
    let objects = count_objects(b, p);
    if timing() {
        let note = if one_band { ", swapped or slow-to-decode image: 1 band" } else { "" };
        eprintln!("[pdfium] page {}: {} objects (counted in {} ms){note}", page + 1, objects, t0.elapsed().as_millis());
    }
    Ok(PageProfile { one_band, objects })
}

fn close_doc(b: &dyn PdfiumLibraryBindings, d: Doc) {
    crate::pdfium_lod::on_close(b, d.handle); // WP-LOD
    crate::pdfium_swap::on_close(b, d.handle);
    unsafe {
        for (_, p) in d.pages {
            b.FPDF_ClosePage(p);
        }
        b.FPDF_CloseDocument(d.handle);
    }
    // d._bytes drops here, after PDFium has let go of them.
}

/// Render the strip's device-pixel rect of the page at `rs` device px per point.
fn render_strip(b: &dyn PdfiumLibraryBindings, d: &mut Doc, s: &Strip) -> Result<(), String> {
    let page = get_page(b, d, s.page)?;
    let page = match crate::pdfium_swap::page_for_render(b, d.handle, s.page, page) {
        Some(swapped) => swapped,
        None => crate::pdfium_lod::page_for_render(b, d.handle, s.page, s.rs, page), // WP-LOD
    };
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
