//! Black lines over a sheet rendered in bands, shared by printing (gdi.rs) and Save as PDF
//! (rasterpdf.rs). Each placed page is filtered on its own (job::black_lines_in), with its own
//! blueprint check from a small render of the whole sheet; bands are rendered with `radius`
//! extra rows either side so every dot sees its whole neighbourhood.

use super::job::{self, BlackLines, Rect};
use super::raster::{FPDF_PRINTING, SheetRenderer};

/// Black lines for each placed page of sheet `si`: the page in raster pixels (the sheet drawn
/// `rw` x `rh`) and its filter.
#[allow(clippy::too_many_arguments)]
pub fn page_filters(
    r: &SheetRenderer,
    si: usize,
    sw: f64,
    sh: f64,
    rw: i32,
    rh: i32,
    pages: &[Rect],
    sensitivity: u8,
    dpi: f64,
) -> Result<Vec<(Rect, BlackLines)>, String> {
    let radius = job::black_lines_radius(dpi);
    let (tw, th) = job::sheet_pixels(sw, sh, 40.0);
    let small = r.render_band(si, tw, th, 0, 0, tw, th, FPDF_PRINTING)?;
    let (kx, ky) = (tw as f64 / sw, th as f64 / sh);
    Ok(pages
        .iter()
        .map(|p| {
            let sr = (
                (p.x0 * kx).floor().max(0.0) as usize,
                (p.y0 * ky).floor().max(0.0) as usize,
                ((p.x1 * kx).ceil() as usize).min(tw as usize),
                ((p.y1 * ky).ceil() as usize).min(th as usize),
            );
            let invert = job::is_dark_region(&small, tw as usize, sr);
            let pr = Rect::new(p.x0 * rw as f64 / sw, p.y0 * rh as f64 / sh, p.x1 * rw as f64 / sw, p.y1 * rh as f64 / sh);
            (pr, BlackLines { sensitivity, radius, invert })
        })
        .collect())
}

/// Black lines over one rendered band: `px` is `bw` pixels wide starting at raster column `x0`,
/// rows `ya..yb` of the sheet. Only the placed pages are touched.
pub fn filter_band(px: &mut [u8], bw: i32, x0: i32, ya: i32, yb: i32, filters: &[(Rect, BlackLines)]) {
    for (pr, bl) in filters {
        let rx0 = (pr.x0.floor() as i32 - x0).clamp(0, bw) as usize;
        let rx1 = (pr.x1.ceil() as i32 - x0).clamp(0, bw) as usize;
        let ry0 = (pr.y0.floor() as i32 - ya).clamp(0, yb - ya) as usize;
        let ry1 = (pr.y1.ceil() as i32 - ya).clamp(0, yb - ya) as usize;
        job::black_lines_in(px, bw as usize, (rx0, ry0, rx1, ry1), bl);
    }
}

/// The rows `y..y + h` out of a band rendered for rows `ya..` (`bw` pixels wide).
pub fn crop_rows(px: Vec<u8>, bw: i32, ya: i32, y: i32, h: i32) -> Vec<u8> {
    let row = bw as usize * 4;
    let from = (y - ya) as usize * row;
    if from == 0 && px.len() == h as usize * row {
        return px;
    }
    px[from..from + h as usize * row].to_vec()
}
