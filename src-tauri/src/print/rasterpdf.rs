//! Save as PDF in Greyscale or Black lines. Colour saves the composed (vector) PDF as it is;
//! these modes work on dots, so each sheet is rendered in strips at the print resolution,
//! filtered exactly as printing does (bands.rs), and written as greyscale JPEG strips. JPEG
//! keeps the file and the memory small: PDFium holds each strip encoded until the save.

use super::bands;
use super::job::{self, ColourMode, Rect};
use super::raster::{FPDF_PRINTING, SheetRenderer};
use crate::pdfium::PdfiumState;
use std::sync::Arc;

/// Rows per strip. Bigger strips mean fewer seams for viewers to show and a little more memory.
const STRIP_ROWS: i32 = 1024;

pub struct RasterOptions {
    pub colour: ColourMode,
    pub black_sensitivity: u8,
    pub dpi: f64,
}

/// A raster PDF of the composed job's sheets in `o.colour` (Greyscale or Black lines).
pub fn save(
    pdf: &PdfiumState,
    bytes: Arc<Vec<u8>>,
    sheets: &[(f64, f64)],
    regions: &[Vec<Rect>],
    o: &RasterOptions,
) -> Result<Vec<u8>, String> {
    let r = SheetRenderer::open(pdf, bytes)?;
    r.out_begin()?;
    let black = o.colour == ColourMode::BlackLines;
    let grey = job::BlackLines { sensitivity: 0, radius: 1, invert: false };
    // Black lines is bilevel: a high quality keeps its edges clean; greyscale scans tolerate less.
    let quality = if black { 92 } else { 85 };
    for (si, &(sw, sh)) in sheets.iter().enumerate() {
        let (rw, rh) = job::sheet_pixels(sw, sh, o.dpi);
        r.out_page(sw, sh)?;
        let filters = if black {
            bands::page_filters(&r, si, sw, sh, rw, rh, regions.get(si).map(|v| v.as_slice()).unwrap_or(&[]), o.black_sensitivity, o.dpi)?
        } else {
            Vec::new()
        };
        let pad = if black { job::black_lines_radius(o.dpi) as i32 } else { 0 };
        for (y, h) in job::bands(0, rh, STRIP_ROWS) {
            let (ya, yb) = ((y - pad).max(0), (y + h + pad).min(rh));
            let mut px = r.render_band(si, rw, rh, 0, ya, rw, yb - ya, FPDF_PRINTING)?;
            if black {
                bands::filter_band(&mut px, rw, 0, ya, yb, &filters);
            }
            // Greyscale; for Black lines, only what's outside the pages changes (the pages are
            // black and white already): margins, stamp and marks.
            job::apply_colour(&mut px, rw as usize, ColourMode::Greyscale, &grey);
            let px = bands::crop_rows(px, rw, ya, y, h);
            let gray: Vec<u8> = px.chunks_exact(4).map(|p| p[0]).collect();
            let jpeg = encode_jpeg(&gray, rw as u32, h as u32, quality)?;
            // A strip a hair taller than its share, so viewers don't show a seam between strips.
            let top = y as f64 * sh / rh as f64;
            let height = h as f64 * sh / rh as f64 + if y + h < rh { 0.25 } else { 0.0 };
            r.out_image(jpeg, 0.0, top, sw, height)?;
        }
        r.release();
    }
    r.out_finish()
}

fn encode_jpeg(gray: &[u8], w: u32, h: u32, quality: u8) -> Result<Vec<u8>, String> {
    use image::ImageEncoder;
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality)
        .write_image(gray, w, h, image::ExtendedColorType::L8)
        .map_err(|e| format!("Couldn't encode a sheet: {e}"))?;
    Ok(out)
}
