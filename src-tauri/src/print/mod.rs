//! Printing (WP-Print): compose a layout into a PDF, print it through GDI, save it as PDF.
//!
//! - `job.rs`: the layout JSON the front end's model emits, and pure geometry (tested).
//! - `compose.rs`: builds the output PDF with PDFium (form XObjects, so vectors stay vectors).
//! - `raster.rs`: renders composed sheets band by band on one PDFium worker.
//! - `gdi.rs`: printers, capabilities, the driver dialog, and sending (Windows only).
//!
//! Commands: `print_compose(job) -> { jobId, sheets, bytes }`, `print_printers()`,
//! `print_capabilities(printer)`, `print_margins(printer, paper, landscape)`,
//! `print_properties(printer)`, `print_send(jobId, options, onProgress)`, `print_cancel()`,
//! `print_save_pdf(jobId, path)`, `print_release(jobId)`, `print_features()`.

pub mod bands;
pub mod compose;
#[cfg(windows)]
pub mod gdi;
pub mod job;
pub mod raster;
pub mod rasterpdf;

use crate::pdfium::PdfiumState;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// Whether "Vector" (FPDF_RenderPage straight to the printer DC) is offered. Verified against
/// Microsoft Print to PDF by `tests/print_gdi.rs`; see docs/v0.1-handoff/print.md.
pub const VECTOR_WORKS: bool = true;

struct Composed {
    bytes: Arc<Vec<u8>>,
    sheets: Vec<(f64, f64)>,
    /// Each sheet's placed pages (sheet points, clipped): Black lines works page by page.
    regions: Vec<Vec<job::Rect>>,
}

/// Composed jobs waiting to be printed or saved, by job id.
#[derive(Default)]
pub struct PrintJobs {
    next: AtomicU64,
    map: Mutex<HashMap<u64, Composed>>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ComposedInfo {
    pub job_id: u64,
    pub sheets: usize,
    pub bytes: usize,
}

impl PrintJobs {
    /// Compose a job and keep it under a new id. Blocking.
    pub fn compose(&self, pdf: &PdfiumState, job: job::Job) -> Result<ComposedInfo, String> {
        job::validate(&job)?;
        let mut images = HashMap::new();
        for s in &job.sheets {
            for it in &s.items {
                if let Some(p) = it.path.as_deref() {
                    if crate::imagedoc::handles(std::path::Path::new(p)) && !images.contains_key(p) {
                        images.insert(p.to_string(), compose::prepare_image(p)?);
                    }
                }
            }
        }
        let sheets: Vec<(f64, f64)> = job.sheets.iter().map(|s| (s.w, s.h)).collect();
        let regions: Vec<Vec<job::Rect>> = job
            .sheets
            .iter()
            .map(|s| {
                s.items
                    .iter()
                    .filter_map(|it| {
                        let b = job::item_bounds(it);
                        match &s.clip {
                            Some(c) => b.intersect(c),
                            None => Some(b),
                        }
                    })
                    .collect()
            })
            .collect();
        let bytes = compose::compose(pdf, job, images)?;
        let job_id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let info = ComposedInfo { job_id, sheets: sheets.len(), bytes: bytes.len() };
        self.map.lock().unwrap().insert(job_id, Composed { bytes: Arc::new(bytes), sheets, regions });
        Ok(info)
    }

    #[allow(clippy::type_complexity)]
    fn get(&self, job_id: u64) -> Result<(Arc<Vec<u8>>, Vec<(f64, f64)>, Vec<Vec<job::Rect>>), String> {
        self.map
            .lock()
            .unwrap()
            .get(&job_id)
            .map(|c| (c.bytes.clone(), c.sheets.clone(), c.regions.clone()))
            .ok_or_else(|| "The print job has expired; try again".to_string())
    }

    pub fn bytes(&self, job_id: u64) -> Result<Arc<Vec<u8>>, String> {
        self.get(job_id).map(|g| g.0)
    }

    /// The job as a raster PDF in Greyscale or Black lines (Save as PDF). Blocking.
    pub fn raster_pdf(&self, pdf: &PdfiumState, job_id: u64, o: &SaveOptions) -> Result<Vec<u8>, String> {
        let (bytes, sheets, regions) = self.get(job_id)?;
        let dpi = o.dpi.clamp(72.0, 1200.0);
        rasterpdf::save(pdf, bytes, &sheets, &regions, &rasterpdf::RasterOptions { colour: o.colour, black_sensitivity: o.black_sensitivity, dpi })
    }

    pub fn release(&self, job_id: u64) {
        self.map.lock().unwrap().remove(&job_id);
    }

    #[cfg(windows)]
    pub fn send(&self, pdf: &PdfiumState, job_id: u64, o: &gdi::SendOptions, progress: impl FnMut(usize, usize)) -> Result<(), String> {
        let (bytes, sheets, regions) = self.get(job_id)?;
        gdi::send(pdf, bytes, &sheets, &regions, o, progress)
    }
}

/// A PDFium pool for tests (the app's memory sampler isn't running).
pub fn pdfium_for_tests(threads: usize) -> PdfiumState {
    PdfiumState::new(Some(threads), Default::default())
}

/// The process-wide job store (kept here rather than in Tauri state so lib.rs only needs
/// the command names).
pub fn jobs() -> Arc<PrintJobs> {
    static J: std::sync::OnceLock<Arc<PrintJobs>> = std::sync::OnceLock::new();
    J.get_or_init(Default::default).clone()
}

// ---- Commands (registered in lib.rs) ----

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Features {
    pub vector: bool,
    pub gdi: bool,
}

#[tauri::command]
pub fn print_features() -> Features {
    Features { vector: VECTOR_WORKS && cfg!(windows), gdi: cfg!(windows) }
}

#[tauri::command]
pub async fn print_compose(
    pdf: tauri::State<'_, PdfiumState>,
    job: job::Job,
) -> Result<ComposedInfo, String> {
    let (pdf, jobs) = (pdf.inner().clone(), jobs());
    blocking(move || jobs.compose(&pdf, job)).await
}

/// How Save as PDF treats colour: Colour saves the composed (vector) PDF; Greyscale and Black
/// lines save a raster one at `dpi` (rasterpdf.rs).
#[derive(serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveOptions {
    #[serde(default)]
    pub colour: job::ColourMode,
    #[serde(default = "default_sensitivity")]
    pub black_sensitivity: u8,
    #[serde(default = "default_dpi")]
    pub dpi: f64,
}

fn default_sensitivity() -> u8 {
    job::BLACK_LINES_SENSITIVITY
}

fn default_dpi() -> f64 {
    600.0
}

#[tauri::command]
pub async fn print_save_pdf(
    pdf: tauri::State<'_, PdfiumState>,
    job_id: u64,
    path: String,
    options: Option<SaveOptions>,
) -> Result<(), String> {
    let (pdf, jobs) = (pdf.inner().clone(), jobs());
    blocking(move || {
        let bytes = match options {
            Some(o) if o.colour != job::ColourMode::Colour => jobs.raster_pdf(&pdf, job_id, &o)?,
            _ => jobs.bytes(job_id)?.as_ref().clone(),
        };
        std::fs::write(&path, &bytes).map_err(|e| crate::errcode::io(&e, format!("Couldn't save {path}: {e}")))
    })
    .await
}

#[tauri::command]
pub fn print_release(job_id: u64) {
    jobs().release(job_id);
}

#[cfg(windows)]
#[tauri::command]
pub async fn print_printers() -> Result<Vec<gdi::PrinterInfo>, String> {
    blocking(gdi::printers).await
}

#[cfg(windows)]
#[tauri::command]
pub async fn print_capabilities(printer: String) -> Result<gdi::Capabilities, String> {
    blocking(move || gdi::capabilities(&printer)).await
}

#[cfg(windows)]
#[tauri::command]
pub async fn print_margins(printer: String, paper: Option<i16>, landscape: bool) -> Result<gdi::Margins, String> {
    blocking(move || gdi::margins(&printer, paper, landscape)).await
}

#[cfg(windows)]
#[tauri::command]
pub async fn print_properties(window: tauri::WebviewWindow, printer: String) -> Result<bool, String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    blocking(move || gdi::properties_dialog(hwnd, &printer)).await
}

#[cfg(windows)]
#[tauri::command]
pub async fn print_send(
    pdf: tauri::State<'_, PdfiumState>,
    job_id: u64,
    options: gdi::SendOptions,
    on_progress: tauri::ipc::Channel<[usize; 2]>,
) -> Result<(), String> {
    let (pdf, jobs) = (pdf.inner().clone(), jobs());
    blocking(move || {
        jobs.send(&pdf, job_id, &options, |done, total| {
            let _ = on_progress.send([done, total]);
        })
    })
    .await
}

#[cfg(windows)]
#[tauri::command]
pub fn print_cancel() {
    gdi::cancel();
}
