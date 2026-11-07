//! PDFium rendering backend (the alternative to pdf.js that this spike evaluates).
//!
//! PDFium is not thread-safe, so a single dedicated thread owns the library, the open
//! document and its loaded pages. Tauri commands send it requests over a channel and
//! wait for the reply on a per-request channel. Rendering happens off the WebView's
//! main thread entirely, which is the main architectural difference from pdf.js.
//!
//! Regions are rendered straight into a Vec<u8> in RGBA order (FPDF_REVERSE_BYTE_ORDER)
//! and returned as a raw binary IPC response, so the front end can wrap it in ImageData
//! without conversion.

use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};

// Constants from fpdfview.h (stable across PDFium versions).
const FPDF_ANNOT: i32 = 0x01;
const FPDF_REVERSE_BYTE_ORDER: i32 = 0x10;
const FPDF_BITMAP_BGRA: i32 = 4;

#[derive(Serialize, Clone, Copy)]
pub struct PageSize {
    pub w: f32,
    pub h: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocInfo {
    pub num_pages: usize,
    pub sizes: Vec<PageSize>,
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

enum Req {
    Open(PathBuf, Sender<Result<DocInfo, String>>),
    Render(RegionArgs, Sender<Result<Option<Vec<u8>>, String>>),
}

#[derive(Clone)]
pub struct PdfiumState {
    tx: Arc<Mutex<Option<Sender<Req>>>>,
    /// Requests with id <= this are skipped (cancelled) if not yet started.
    cancel_upto: Arc<AtomicU64>,
    cancelled: Arc<Mutex<std::collections::HashSet<u64>>>,
}

impl Default for PdfiumState {
    fn default() -> Self {
        Self {
            tx: Arc::new(Mutex::new(None)),
            cancel_upto: Arc::new(AtomicU64::new(0)),
            cancelled: Arc::new(Mutex::new(Default::default())),
        }
    }
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

impl PdfiumState {
    fn sender(&self, resource_dir: Option<PathBuf>) -> Result<Sender<Req>, String> {
        let mut g = self.tx.lock().unwrap();
        if let Some(tx) = g.as_ref() {
            return Ok(tx.clone());
        }
        let (tx, rx) = channel::<Req>();
        let (ready_tx, ready_rx) = channel::<Result<(), String>>();
        let cancel_upto = self.cancel_upto.clone();
        let cancelled = self.cancelled.clone();
        let candidates = library_candidates(resource_dir);
        std::thread::Builder::new()
            .name("pdfium".into())
            .spawn(move || render_thread(rx, ready_tx, candidates, cancel_upto, cancelled))
            .map_err(|e| e.to_string())?;
        ready_rx.recv().map_err(|e| e.to_string())??;
        *g = Some(tx.clone());
        Ok(tx)
    }

    pub fn open(&self, resource_dir: Option<PathBuf>, path: String) -> Result<DocInfo, String> {
        let tx = self.sender(resource_dir)?;
        let (rtx, rrx) = channel();
        tx.send(Req::Open(PathBuf::from(path), rtx)).map_err(|e| e.to_string())?;
        rrx.recv().map_err(|e| e.to_string())?
    }

    pub fn render(&self, args: RegionArgs) -> Result<Option<Vec<u8>>, String> {
        let tx = self.sender(None)?;
        let (rtx, rrx) = channel();
        tx.send(Req::Render(args, rtx)).map_err(|e| e.to_string())?;
        rrx.recv().map_err(|e| e.to_string())?
    }

    pub fn cancel(&self, id: u64) {
        self.cancelled.lock().unwrap().insert(id);
    }

    pub fn cancel_upto(&self, id: u64) {
        self.cancel_upto.fetch_max(id, Ordering::SeqCst);
    }
}

struct Doc {
    handle: FPDF_DOCUMENT,
    pages: HashMap<usize, FPDF_PAGE>,
}

fn render_thread(
    rx: Receiver<Req>,
    ready: Sender<Result<(), String>>,
    candidates: Vec<PathBuf>,
    cancel_upto: Arc<AtomicU64>,
    cancelled: Arc<Mutex<std::collections::HashSet<u64>>>,
) {
    // Bind to the first pdfium.dll we can load.
    let mut last_err = String::from("pdfium.dll not found");
    let mut lib: Option<Box<dyn PdfiumLibraryBindings>> = None;
    for dir in &candidates {
        let p = Pdfium::pdfium_platform_library_name_at_path(dir);
        if !p.exists() {
            continue;
        }
        match Pdfium::bind_to_library(&p) {
            Ok(b) => {
                eprintln!("[pdfium] loaded {}", p.display());
                lib = Some(b);
                break;
            }
            Err(e) => last_err = format!("{}: {e:?}", p.display()),
        }
    }
    let Some(b) = lib else {
        let searched: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
        let _ = ready.send(Err(format!("{last_err}; searched {}", searched.join(", "))));
        return;
    };
    unsafe { b.FPDF_InitLibrary() };
    let _ = ready.send(Ok(()));

    let mut doc: Option<Doc> = None;

    while let Ok(req) = rx.recv() {
        match req {
            Req::Open(path, reply) => {
                if let Some(d) = doc.take() {
                    close_doc(b.as_ref(), d);
                }
                let r = open_doc(b.as_ref(), &path).map(|(d, info)| {
                    doc = Some(d);
                    info
                });
                let _ = reply.send(r);
            }
            Req::Render(args, reply) => {
                let skip = args.id <= cancel_upto.load(Ordering::SeqCst)
                    || cancelled.lock().unwrap().remove(&args.id);
                if skip {
                    let _ = reply.send(Ok(None));
                    continue;
                }
                let r = match doc.as_mut() {
                    Some(d) => render_region(b.as_ref(), d, &args).map(Some),
                    None => Err("no document open".into()),
                };
                let _ = reply.send(r);
            }
        }
    }
}

fn open_doc(b: &dyn PdfiumLibraryBindings, path: &PathBuf) -> Result<(Doc, DocInfo), String> {
    let p = path.to_string_lossy();
    let handle = unsafe { b.FPDF_LoadDocument(&p, None) };
    if handle.is_null() {
        let code = unsafe { b.FPDF_GetLastError() };
        return Err(format!("PDFium could not open {p} (error {code})"));
    }
    let n = unsafe { b.FPDF_GetPageCount(handle) }.max(0) as usize;
    let mut d = Doc { handle, pages: HashMap::new() };
    let mut sizes = Vec::with_capacity(n);
    for i in 0..n {
        // FPDF_GetPageSizeByIndexF avoids loading (parsing) every page up front.
        let mut s = FS_SIZEF { width: 0.0, height: 0.0 };
        let ok = unsafe { b.FPDF_GetPageSizeByIndexF(handle, i as i32, &mut s) };
        if ok == 0 {
            let page = get_page(b, &mut d, i)?;
            s.width = unsafe { b.FPDF_GetPageWidthF(page) };
            s.height = unsafe { b.FPDF_GetPageHeightF(page) };
        }
        sizes.push(PageSize { w: s.width, h: s.height });
    }
    Ok((d, DocInfo { num_pages: n, sizes }))
}

fn get_page(b: &dyn PdfiumLibraryBindings, d: &mut Doc, i: usize) -> Result<FPDF_PAGE, String> {
    if let Some(p) = d.pages.get(&i) {
        return Ok(*p);
    }
    let p = unsafe { b.FPDF_LoadPage(d.handle, i as i32) };
    if p.is_null() {
        return Err(format!("could not load page {}", i + 1));
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

fn close_doc(b: &dyn PdfiumLibraryBindings, d: Doc) {
    unsafe {
        for (_, p) in d.pages {
            b.FPDF_ClosePage(p);
        }
        b.FPDF_CloseDocument(d.handle);
    }
}

/// Render the device-pixel region (x, y, w, h) of page `page` at `rs` device px per point.
fn render_region(b: &dyn PdfiumLibraryBindings, d: &mut Doc, a: &RegionArgs) -> Result<Vec<u8>, String> {
    if a.w <= 0 || a.h <= 0 {
        return Err("empty region".into());
    }
    let page = get_page(b, d, a.page)?;
    let (pw, ph) = unsafe { (b.FPDF_GetPageWidthF(page), b.FPDF_GetPageHeightF(page)) };
    let stride = a.w * 4;
    // Opaque white background; PDFium paints over it.
    let mut buf = vec![0xFFu8; (stride as usize) * (a.h as usize)];
    let bmp = unsafe {
        b.FPDFBitmap_CreateEx(a.w, a.h, FPDF_BITMAP_BGRA, buf.as_mut_ptr() as *mut _, stride)
    };
    if bmp.is_null() {
        return Err("could not create bitmap".into());
    }
    // FPDF_RenderPageBitmapWithMatrix first maps the page into a (0,0)-(W,H) display rect
    // whose size is the page size truncated to whole points, then applies our matrix.
    // Compensate for the truncation so tiles line up exactly with the true page size.
    let sx = a.rs * pw as f64 / (pw as f64).trunc().max(1.0);
    let sy = a.rs * ph as f64 / (ph as f64).trunc().max(1.0);
    let m = FS_MATRIX {
        a: sx as f32,
        b: 0.0,
        c: 0.0,
        d: sy as f32,
        e: -a.x as f32,
        f: -a.y as f32,
    };
    let clip = FS_RECTF { left: 0.0, top: 0.0, right: a.w as f32, bottom: a.h as f32 };
    unsafe {
        b.FPDF_RenderPageBitmapWithMatrix(bmp, page, &m, &clip, FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER);
        b.FPDFBitmap_Destroy(bmp);
    }
    Ok(buf)
}
