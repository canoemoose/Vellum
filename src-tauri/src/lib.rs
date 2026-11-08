pub mod docs;
pub mod imagedoc;
mod memory;
pub mod pdfium;
pub mod previewcache;
pub mod pdfium_lod; // WP-LOD
// WP-Print
pub mod print;
// End WP-Print
pub mod scale;

use docs::{DocInfo, Docs};
use memory::{MemState, MemStats};
use pdfium::{PdfiumState, RegionArgs};
use serde::Serialize;
use std::sync::Arc;
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// Parsed command line. The first non-flag argument is the file to open, so
/// Windows "Open with..." (which passes the path as argv[1]) works.
#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LaunchArgs {
    pub file: Option<String>,
    pub bench: bool,
    pub bench_out: Option<String>,
    pub debug: bool,
    /// Pretend the display has this device pixel ratio (benchmarking HiDPI cost on a
    /// 100% display). The canvas is rendered at this density and scaled by CSS.
    pub dpr: Option<f64>,
    /// Number of parallel PDFium instances (default: half the logical CPUs, max 8).
    pub pdfium_threads: Option<usize>,
    /// Render whole regions instead of streaming bands (benchmark comparison).
    pub no_progressive: bool,
    /// Wall-clock time (ms since epoch) when `run` started; lets the front end
    /// split cold start into process/Rust init and WebView startup.
    pub process_start_epoch_ms: f64,
}

pub fn parse_args(args: impl Iterator<Item = String>) -> LaunchArgs {
    let mut out = LaunchArgs::default();
    let mut it = args.skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--bench" => out.bench = true,
            "--bench-out" => out.bench_out = it.next(),
            // Removed with pdf.js in v0.1 (PDFium is the only renderer). Still consumed with
            // its value so an old command line doesn't open "pdfium" as a file.
            "--renderer" => {
                it.next();
            }
            "--debug" => out.debug = true,
            "--no-progressive" => out.no_progressive = true,
            "--dpr" => out.dpr = it.next().and_then(|v| v.parse().ok()),
            "--pdfium-threads" => out.pdfium_threads = it.next().and_then(|v| v.parse().ok()),
            s if s.starts_with("--") => {} // ignore unknown flags
            _ => {
                if out.file.is_none() {
                    out.file = Some(a);
                }
            }
        }
    }
    out
}

fn epoch_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

struct Launch(LaunchArgs);

#[tauri::command]
fn launch_args(state: tauri::State<Launch>) -> LaunchArgs {
    state.0.clone()
}

/// Return a file's bytes as a binary IPC response (no JSON/base64 overhead).
/// Async so the read happens off the main (window event loop) thread.
#[tauri::command]
async fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("{path}: {e}"))
}

fn perf_log_path() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("Vellum").join("perf-log.csv")
}

/// Append rows to %LOCALAPPDATA%\Vellum\perf-log.csv, writing the header if the file is new.
#[tauri::command]
fn append_perf_log(header: String, rows: Vec<String>) -> Result<String, String> {
    let path = perf_log_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let is_new = !path.exists();
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    if is_new {
        writeln!(f, "{header}").map_err(|e| e.to_string())?;
    }
    for r in rows {
        writeln!(f, "{r}").map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    if let Some(dir) = PathBuf::from(&path).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

/// Raw-body command: the target path travels in the `path` header, bytes in the body.
#[tauri::command]
fn write_binary_file(request: tauri::ipc::Request) -> Result<(), String> {
    let path = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing path header")?
        .to_string();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw body".into());
    };
    if let Some(dir) = PathBuf::from(&path).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(&path, bytes).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn memory_stats(state: tauri::State<MemState>) -> MemStats {
    *state.0.lock().unwrap()
}

#[tauri::command]
fn reset_memory_peak(state: tauri::State<MemState>) {
    state.reset_peak();
}

// ------------------------------------------------------------------------------------------
// Document commands. All take a document id from doc_open; PDFs and images use the same
// commands with the same shapes (docs.rs dispatches on kind). Async + spawn_blocking: the
// PDFium pool or an image resample may take a while, and a sync command would block the
// window's event loop.

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Open a PDF or image. Errors are UI-ready ("Password required", "Wrong password",
/// "Not a PDF or supported image", "pdfium.dll not found: ...").
#[tauri::command]
async fn doc_open(
    pdf: tauri::State<'_, PdfiumState>,
    docs: tauri::State<'_, Arc<Docs>>,
    path: String,
    password: Option<String>,
) -> Result<DocInfo, String> {
    let (pdf, docs) = (pdf.inner().clone(), docs.inner().clone());
    blocking(move || docs.open(&pdf, std::path::Path::new(&path), password.as_deref())).await
}

/// Close a document and free everything it holds.
#[tauri::command]
async fn doc_close(pdf: tauri::State<'_, PdfiumState>, docs: tauri::State<'_, Arc<Docs>>, doc_id: u64) -> Result<(), String> {
    let (pdf, docs) = (pdf.inner().clone(), docs.inner().clone());
    blocking(move || {
        docs.close(&pdf, doc_id);
        Ok(())
    })
    .await
}

/// Render a region; returns raw RGBA bytes (w*h*4), or an empty body if cancelled.
#[tauri::command]
async fn doc_render(
    pdf: tauri::State<'_, PdfiumState>,
    docs: tauri::State<'_, Arc<Docs>>,
    doc_id: u64,
    region: RegionArgs,
) -> Result<tauri::ipc::Response, String> {
    let (pdf, docs) = (pdf.inner().clone(), docs.inner().clone());
    let bytes = blocking(move || docs.render(&pdf, doc_id, region)).await?;
    Ok(tauri::ipc::Response::new(bytes.unwrap_or_default()))
}

/// Render a region band by band. Each band goes to `on_band` as soon as it is drawn, as raw
/// bytes: the band's RGBA pixels (tightly packed) followed by a 16-byte trailer of four
/// little-endian u32s: x, y (the band's offset within the region), w, h. Returns the number
/// of bands sent (wait for that many messages: they can arrive after the command resolves),
/// or null if the request was cancelled before it started.
#[tauri::command]
async fn doc_render_stream(
    pdf: tauri::State<'_, PdfiumState>,
    docs: tauri::State<'_, Arc<Docs>>,
    doc_id: u64,
    region: RegionArgs,
    on_band: tauri::ipc::Channel,
) -> Result<Option<usize>, String> {
    let (pdf, docs) = (pdf.inner().clone(), docs.inner().clone());
    blocking(move || {
        docs.render_stream(&pdf, doc_id, region, |part, mut buf| {
            for v in [part.rx as u32, part.ry as u32, part.w as u32, part.h as u32] {
                buf.extend_from_slice(&v.to_le_bytes());
            }
            on_band.send(tauri::ipc::InvokeResponseBody::Raw(buf)).is_ok()
        })
    })
    .await
}

/// Skip a doc_render / doc_render_stream request that hasn't started (by its region id).
#[tauri::command]
fn doc_cancel(pdf: tauri::State<PdfiumState>, id: u64) {
    pdf.cancel(id);
}

/// A page scaled so its longer side is `max_side` px: RGBA bytes followed by an 8-byte
/// trailer of two little-endian u32s, w and h.
#[tauri::command]
async fn doc_thumbnail(
    pdf: tauri::State<'_, PdfiumState>,
    docs: tauri::State<'_, Arc<Docs>>,
    doc_id: u64,
    page: usize,
    max_side: u32,
) -> Result<tauri::ipc::Response, String> {
    let (pdf, docs) = (pdf.inner().clone(), docs.inner().clone());
    let (w, h, mut buf) = blocking(move || docs.thumbnail(&pdf, doc_id, page, max_side)).await?;
    buf.extend_from_slice(&w.to_le_bytes());
    buf.extend_from_slice(&h.to_le_bytes());
    Ok(tauri::ipc::Response::new(buf))
}

/// The page's text (empty for images).
#[tauri::command]
async fn doc_page_text(
    pdf: tauri::State<'_, PdfiumState>,
    docs: tauri::State<'_, Arc<Docs>>,
    doc_id: u64,
    page: usize,
) -> Result<String, String> {
    let (pdf, docs) = (pdf.inner().clone(), docs.inner().clone());
    blocking(move || docs.page_text(&pdf, doc_id, page)).await
}

/// Bookmarks as a tree (empty for images and PDFs without them).
#[tauri::command]
async fn doc_outline(
    pdf: tauri::State<'_, PdfiumState>,
    docs: tauri::State<'_, Arc<Docs>>,
    doc_id: u64,
) -> Result<Vec<pdfium::OutlineNode>, String> {
    let (pdf, docs) = (pdf.inner().clone(), docs.inner().clone());
    blocking(move || docs.outline(&pdf, doc_id)).await
}

/// Drawing-scale notes on a page ("1:100"), best first; bbox in page points, y down.
#[tauri::command]
async fn doc_find_scale(
    pdf: tauri::State<'_, PdfiumState>,
    docs: tauri::State<'_, Arc<Docs>>,
    doc_id: u64,
    page: usize,
) -> Result<Vec<scale::ScaleCandidate>, String> {
    let (pdf, docs) = (pdf.inner().clone(), docs.inner().clone());
    blocking(move || docs.find_scale(&pdf, doc_id, page)).await
}

/// The page preview stored on disk for this document's file (WebP bytes), or an empty body.
#[tauri::command]
async fn doc_cached_preview(docs: tauri::State<'_, Arc<Docs>>, doc_id: u64, page: usize) -> Result<tauri::ipc::Response, String> {
    let key = docs.cache_key(doc_id);
    let bytes = blocking(move || {
        Ok(key.and_then(|k| previewcache::get(&previewcache::cache_dir(), &k, page)).unwrap_or_default())
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Store a page preview on disk for this document's file. Raw body (WebP bytes) with
/// `doc-id` and `page` headers. Written on a background thread; failures are only logged.
#[tauri::command]
fn doc_store_preview(docs: tauri::State<'_, Arc<Docs>>, request: tauri::ipc::Request) -> Result<(), String> {
    let header = |name: &str| -> Result<u64, String> {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
            .ok_or_else(|| format!("missing {name} header"))
    };
    let doc_id = header("doc-id")?;
    let page = header("page")? as usize;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw body".into());
    };
    let Some(key) = docs.cache_key(doc_id) else { return Ok(()) };
    let bytes = bytes.clone();
    std::thread::spawn(move || {
        if let Err(e) = previewcache::put(&previewcache::cache_dir(), &key, page, &bytes, previewcache::MAX_BYTES) {
            eprintln!("[preview-cache] could not store page {}: {e}", page + 1);
        }
    });
    Ok(())
}

/// How many times the PDFium memory guard has trimmed page caches (benchmark reporting).
#[tauri::command]
fn pdfium_trims(state: tauri::State<PdfiumState>) -> usize {
    state.trims()
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle, code: i32) {
    app.exit(code);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut args = parse_args(std::env::args());
    args.process_start_epoch_ms = epoch_ms();
    let bench = args.bench;
    let pdfium_threads = args.pdfium_threads;

    let mem = MemState::default();
    memory::start_sampler(mem.0.clone(), Duration::from_millis(200));
    let pdfium_state = PdfiumState::new(pdfium_threads, mem.0.clone());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Launch(args))
        .manage(mem)
        .manage(pdfium_state.clone())
        .manage(Arc::new(Docs::default()))
        .setup(move |app| {
            pdfium_state.set_resource_dir(app.path().resource_dir().ok());
            if bench {
                // Fixed, on-top window so benchmark runs are comparable and
                // never throttled by being occluded.
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_size(tauri::LogicalSize::new(1600.0, 1000.0));
                    let _ = w.center();
                    let _ = w.set_always_on_top(true);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_args,
            read_file,
            append_perf_log,
            write_text_file,
            write_binary_file,
            memory_stats,
            reset_memory_peak,
            exit_app,
            doc_open,
            doc_close,
            doc_render,
            doc_render_stream,
            doc_cancel,
            doc_thumbnail,
            doc_page_text,
            doc_outline,
            doc_find_scale,
            doc_cached_preview,
            doc_store_preview,
            pdfium_trims,
            // WP-Print
            print::print_features,
            print::print_compose,
            print::print_save_pdf,
            print::print_release,
            print::print_printers,
            print::print_capabilities,
            print::print_margins,
            print::print_properties,
            print::print_send,
            print::print_cancel,
            // End WP-Print
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
