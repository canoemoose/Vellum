//! The print job as the front end's layout model emits it, and the pure geometry that turns
//! it into PDF transforms. No PDFium here: `tests/print_geometry.rs` covers it all.
//!
//! Coordinates in the job are points (1/72 in), y down from the top-left, like the rest of
//! the app. PDF user space is y up, so everything is flipped on the way out.

use serde::{Deserialize, Serialize};

/// An axis-aligned rectangle, y down.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl Rect {
    pub fn new(x0: f64, y0: f64, x1: f64, y1: f64) -> Rect {
        Rect { x0: x0.min(x1), y0: y0.min(y1), x1: x0.max(x1), y1: y0.max(y1) }
    }
    pub fn w(&self) -> f64 {
        self.x1 - self.x0
    }
    pub fn h(&self) -> f64 {
        self.y1 - self.y0
    }
    pub fn intersect(&self, o: &Rect) -> Option<Rect> {
        let r = Rect { x0: self.x0.max(o.x0), y0: self.y0.max(o.y0), x1: self.x1.min(o.x1), y1: self.y1.min(o.y1) };
        (r.x1 > r.x0 && r.y1 > r.y0).then_some(r)
    }
}

/// The whole job: one entry per output sheet.
#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub sheets: Vec<Sheet>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    /// Sheet (paper) size in points.
    pub w: f64,
    pub h: f64,
    /// Placed pages and images, drawn in order.
    #[serde(default)]
    pub items: Vec<Item>,
    /// Everything in `items` is clipped to this rectangle (tiles: the tile's area, so the
    /// margins stay clear for cut marks). Lines and texts are not clipped.
    #[serde(default)]
    pub clip: Option<Rect>,
    /// Stroked lines: cut marks, page borders.
    #[serde(default)]
    pub lines: Vec<Line>,
    /// Text: the margin stamp, scale labels.
    #[serde(default)]
    pub texts: Vec<Text>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    /// The open document (PDF or image) this item shows.
    pub doc_id: u64,
    /// Zero-based page (0 for images).
    pub page: usize,
    /// For image documents: the file to embed (images are re-read from disk at compose).
    #[serde(default)]
    pub path: Option<String>,
    /// The source page's displayed size in points (after its /Rotate), as DocInfo reports.
    pub src_w: f64,
    pub src_h: f64,
    /// The part of the page to show, in displayed page points (y down). None: whole page.
    #[serde(default)]
    pub crop: Option<Rect>,
    /// Where the top-left of the placed (rotated, scaled) crop lands on the sheet.
    pub x: f64,
    pub y: f64,
    /// Sheet points per page point.
    pub scale: f64,
    /// Clockwise quarter turns in degrees: 0, 90, 180 or 270.
    #[serde(default)]
    pub rotation: u32,
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
    /// Stroke width in points.
    pub width: f64,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Text {
    /// Left end of the baseline, y down.
    pub x: f64,
    pub y: f64,
    /// Font size in points.
    pub size: f64,
    pub text: String,
}

/// A PDF matrix [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f.
pub type Matrix = [f64; 6];

pub fn apply(m: &Matrix, x: f64, y: f64) -> (f64, f64) {
    (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
}

/// The affine map that sends (0,0), (1,0), (0,1) where `f` sends them.
fn matrix_from(f: impl Fn(f64, f64) -> (f64, f64)) -> Matrix {
    let (ex, ey) = f(0.0, 0.0);
    let (ax, ay) = f(1.0, 0.0);
    let (cx, cy) = f(0.0, 1.0);
    [ax - ex, ay - ey, cx - ex, cy - ey, ex, ey]
}

pub fn invert(m: &Matrix) -> Option<Matrix> {
    let det = m[0] * m[3] - m[1] * m[2];
    if det.abs() < 1e-12 {
        return None;
    }
    let a = m[3] / det;
    let b = -m[1] / det;
    let c = -m[2] / det;
    let d = m[0] / det;
    let e = -(a * m[4] + c * m[5]);
    let f = -(b * m[4] + d * m[5]);
    Some([a, b, c, d, e, f])
}

/// Normalise a rotation in degrees to 0, 90, 180 or 270 (nearest quarter turn).
pub fn quarter(rotation: u32) -> u32 {
    ((rotation as f64 / 90.0).round() as u32 % 4) * 90
}

/// Size of a w x h box after a clockwise rotation.
pub fn rotated_size(w: f64, h: f64, rotation: u32) -> (f64, f64) {
    if quarter(rotation) % 180 == 90 { (h, w) } else { (w, h) }
}

/// PDFium's page matrix (`CPDF_Page::GetPageMatrix`): PDF user space to the displayed page,
/// y up, origin at the displayed bottom-left. `bbox` is the page's crop box (l, b, r, t) in
/// user space, `rotate` its /Rotate in quarter turns clockwise (0..3).
pub fn page_matrix(bbox: (f64, f64, f64, f64), rotate: i32) -> Matrix {
    let (l, b, r, t) = bbox;
    match rotate.rem_euclid(4) {
        1 => [0.0, -1.0, 1.0, 0.0, -b, r],
        2 => [-1.0, 0.0, 0.0, -1.0, r, t],
        3 => [0.0, 1.0, -1.0, 0.0, t, -l],
        _ => [1.0, 0.0, 0.0, 1.0, -l, -b],
    }
}

/// Displayed size (w, h) of a page with this crop box and rotation.
pub fn display_size(bbox: (f64, f64, f64, f64), rotate: i32) -> (f64, f64) {
    let (w, h) = (bbox.2 - bbox.0, bbox.3 - bbox.1);
    if rotate.rem_euclid(2) == 1 { (h, w) } else { (w, h) }
}

/// A crop given in displayed page points (y down) as a user-space box (l, b, r, t) for
/// FPDFPage_SetCropBox, clamped to the page's current box. None if nothing is left.
pub fn crop_to_user(bbox: (f64, f64, f64, f64), rotate: i32, crop: &Rect) -> Option<(f64, f64, f64, f64)> {
    let (_, dh) = display_size(bbox, rotate);
    let inv = invert(&page_matrix(bbox, rotate))?;
    // Displayed y down -> displayed y up -> user space.
    let corners = [(crop.x0, crop.y0), (crop.x1, crop.y0), (crop.x0, crop.y1), (crop.x1, crop.y1)];
    let pts: Vec<(f64, f64)> = corners.iter().map(|&(x, y)| apply(&inv, x, dh - y)).collect();
    let l = pts.iter().map(|p| p.0).fold(f64::INFINITY, f64::min).max(bbox.0);
    let r = pts.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max).min(bbox.2);
    let b = pts.iter().map(|p| p.1).fold(f64::INFINITY, f64::min).max(bbox.1);
    let t = pts.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max).min(bbox.3);
    (r - l > 1e-6 && t - b > 1e-6).then_some((l, b, r, t))
}

/// The matrix for a form object made from a page (or cropped page) whose displayed size is
/// `cw` x `ch`: PDFium's form XObject draws that displayed page with its bottom-left at the
/// origin, y up. The result places it on a sheet `sheet_h` tall, rotated clockwise by
/// `rotation`, scaled by `scale`, with the rotated box's top-left at (x, y), y down.
pub fn item_matrix(cw: f64, ch: f64, scale: f64, rotation: u32, x: f64, y: f64, sheet_h: f64) -> Matrix {
    let rot = quarter(rotation);
    matrix_from(|u, v| {
        // Form space (y up) -> displayed page, y down.
        let (px, py) = (u, ch - v);
        // Clockwise rotation in y-down space, keeping the box at the origin.
        let (rx, ry) = match rot {
            90 => (ch - py, px),
            180 => (cw - px, ch - py),
            270 => (py, cw - px),
            _ => (px, py),
        };
        // Scale, place, and flip to the sheet's PDF space (y up).
        (x + rx * scale, sheet_h - (y + ry * scale))
    })
}

/// Where an item's displayed size comes from: its crop or the whole page.
pub fn item_display_size(item: &Item) -> (f64, f64) {
    match item.crop {
        Some(c) => (c.w(), c.h()),
        None => (item.src_w, item.src_h),
    }
}

/// The sheet-space box (y down) an item covers.
pub fn item_bounds(item: &Item) -> Rect {
    let (cw, ch) = item_display_size(item);
    let (w, h) = rotated_size(cw, ch, item.rotation);
    Rect::new(item.x, item.y, item.x + w * item.scale, item.y + h * item.scale)
}

/// A y-down sheet rectangle as a PDF rect (left, bottom, right, top).
pub fn sheet_rect_to_pdf(r: &Rect, sheet_h: f64) -> (f64, f64, f64, f64) {
    (r.x0, sheet_h - r.y1, r.x1, sheet_h - r.y0)
}

/// Check a job before composing; errors are shown to the user as they are.
pub fn validate(job: &Job) -> Result<(), String> {
    if job.sheets.is_empty() {
        return Err("Nothing to print".into());
    }
    for (i, s) in job.sheets.iter().enumerate() {
        if !(s.w > 1.0 && s.h > 1.0 && s.w < 14400.0 && s.h < 14400.0) {
            return Err(format!("Sheet {} has an invalid size", i + 1));
        }
        for it in &s.items {
            if !(it.scale.is_finite() && it.scale > 0.0) {
                return Err(format!("Sheet {} has an item with an invalid scale", i + 1));
            }
            if !(it.src_w > 0.0 && it.src_h > 0.0) {
                return Err(format!("Sheet {} has an item with an empty page", i + 1));
            }
            if let Some(c) = it.crop {
                if c.w() <= 0.0 || c.h() <= 0.0 {
                    return Err(format!("Sheet {} has an empty crop", i + 1));
                }
            }
        }
    }
    Ok(())
}

/// Rendering a sheet for the printer: the device-pixel size of a sheet at `dpi`.
pub fn sheet_pixels(w_pt: f64, h_pt: f64, dpi: f64) -> (i32, i32) {
    (((w_pt / 72.0) * dpi).round().max(1.0) as i32, ((h_pt / 72.0) * dpi).round().max(1.0) as i32)
}

/// Horizontal bands of at most `band_h` rows covering `y0..y1`: (y, h) pairs.
pub fn bands(y0: i32, y1: i32, band_h: i32) -> Vec<(i32, i32)> {
    let mut v = Vec::new();
    let band_h = band_h.max(1);
    let mut y = y0;
    while y < y1 {
        let h = band_h.min(y1 - y);
        v.push((y, h));
        y += h;
    }
    v
}

/// A paper size a printer offers, in millimetres, portrait as the driver reports it.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Paper {
    pub id: i16,
    pub name: String,
    pub w: f64,
    pub h: f64,
}

pub const MM_PER_PT: f64 = 25.4 / 72.0;

/// The printer paper for a sheet of w x h millimetres: (paper id, landscape). Matches within
/// 2 mm either way round; the first match in the driver's order wins.
pub fn match_paper(papers: &[Paper], w_mm: f64, h_mm: f64) -> Option<(i16, bool)> {
    const TOL: f64 = 2.0;
    let near = |a: f64, b: f64| (a - b).abs() <= TOL;
    papers.iter().find_map(|p| {
        if near(p.w, w_mm) && near(p.h, h_mm) {
            Some((p.id, false))
        } else if near(p.w, h_mm) && near(p.h, w_mm) {
            Some((p.id, true))
        } else {
            None
        }
    })
}

/// Colour handling for raster output, applied to BGRA/BGRx pixels in place.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ColourMode {
    #[default]
    Colour,
    Greyscale,
    /// Every mark that isn't (near) white prints solid black.
    BlackLines,
}

/// Anything darker than this (on the darkest channel) counts as a mark in Black lines mode.
pub const BLACK_LINES_THRESHOLD: u8 = 245;

/// Apply a colour mode to 4-byte pixels (B, G, R, x). Alpha is left alone.
pub fn apply_colour(px: &mut [u8], mode: ColourMode) {
    match mode {
        ColourMode::Colour => {}
        ColourMode::Greyscale => {
            for p in px.chunks_exact_mut(4) {
                // Rec. 601 luma, integer.
                let y = ((p[2] as u32 * 299 + p[1] as u32 * 587 + p[0] as u32 * 114 + 500) / 1000) as u8;
                p[0] = y;
                p[1] = y;
                p[2] = y;
            }
        }
        ColourMode::BlackLines => {
            for p in px.chunks_exact_mut(4) {
                let v = if p[0].min(p[1]).min(p[2]) < BLACK_LINES_THRESHOLD { 0 } else { 255 };
                p[0] = v;
                p[1] = v;
                p[2] = v;
            }
        }
    }
}
