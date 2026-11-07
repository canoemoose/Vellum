mod memory;
mod pdfium;

use memory::{MemState, MemStats};
use pdfium::{PdfiumState, RegionArgs};
use serde::Serialize;
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
    pub renderer: Option<String>,
    pub debug: bool,
    /// Pretend the display has this device pixel ratio (benchmarking HiDPI cost on a
    /// 100% display). The canvas is rendered at this density and scaled by CSS.
    pub dpr: Option<f64>,
    /// Wall-clock time (ms since epoch) when `run` started; lets the front end
    /// split cold start into process/Rust init and WebView startup.
    pub process_start_epoch_ms: f64,
}

fn parse_args(args: impl Iterator<Item = String>) -> LaunchArgs {
    let mut out = LaunchArgs::default();
    let mut it = args.skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--bench" => out.bench = true,
            "--bench-out" => out.bench_out = it.next(),
            "--renderer" => out.renderer = it.next(),
            "--debug" => out.debug = true,
            "--dpr" => out.dpr = it.next().and_then(|v| v.parse().ok()),
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

/// Open a document in the PDFium backend. Async + spawn_blocking: the PDFium thread
/// may take a while and sync commands would block the window's event loop.
#[tauri::command]
async fn pdfium_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, PdfiumState>,
    path: String,
) -> Result<pdfium::DocInfo, String> {
    let st = state.inner().clone();
    let res_dir = app.path().resource_dir().ok();
    tauri::async_runtime::spawn_blocking(move || st.open(res_dir, path))
        .await
        .map_err(|e| e.to_string())?
}

/// Render a region; returns raw RGBA bytes (w*h*4), or an empty body if cancelled.
#[tauri::command]
async fn pdfium_render(
    state: tauri::State<'_, PdfiumState>,
    args: RegionArgs,
) -> Result<tauri::ipc::Response, String> {
    let st = state.inner().clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || st.render(args))
        .await
        .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes.unwrap_or_default()))
}

#[tauri::command]
fn pdfium_cancel(state: tauri::State<PdfiumState>, id: u64) {
    state.cancel(id);
}

#[tauri::command]
fn pdfium_cancel_upto(state: tauri::State<PdfiumState>, id: u64) {
    state.cancel_upto(id);
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

    let mem = MemState::default();
    memory::start_sampler(mem.0.clone(), Duration::from_millis(200));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Launch(args))
        .manage(mem)
        .manage(PdfiumState::default())
        .setup(move |app| {
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
            pdfium_open,
            pdfium_render,
            pdfium_cancel,
            pdfium_cancel_upto,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(v: &[&str]) -> LaunchArgs {
        parse_args(v.iter().map(|s| s.to_string()))
    }

    #[test]
    fn first_positional_is_file() {
        let a = p(&["vellum.exe", "C:\\a b\\x.pdf"]);
        assert_eq!(a.file.as_deref(), Some("C:\\a b\\x.pdf"));
        assert!(!a.bench);
    }

    #[test]
    fn bench_flags() {
        let a = p(&[
            "v", "--bench", "f.pdf", "--bench-out", "o.json", "--renderer", "pdfium",
        ]);
        assert!(a.bench);
        assert_eq!(a.file.as_deref(), Some("f.pdf"));
        assert_eq!(a.bench_out.as_deref(), Some("o.json"));
        assert_eq!(a.renderer.as_deref(), Some("pdfium"));
    }
}
