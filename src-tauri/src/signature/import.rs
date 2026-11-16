//! Import a signature from a photo or scan: find the ink, knock the paper out to transparent,
//! crop to the ink and return a PNG with alpha.
//!
//! The steps:
//! 1. Decode, turn upright from the EXIF orientation, apply the user's framing (quarter turns
//!    and a crop box that may be turned: `Adjust`, chosen on a preview first), and shrink anything huge to a
//!    working size. Cropping comes before the shrink, so a small signature in a big photo keeps
//!    its full resolution.
//! 2. Estimate the paper's colour everywhere: per block, the brightest tenth of pixels, then
//!    interpolated between block centres. Phone photos light paper unevenly (a gradient, the
//!    shadow of the phone), so a single threshold would either eat the ink in the shadow or keep
//!    the shadow as ink. Measured against its local paper, ink is dark everywhere.
//! 3. "Darkness" per pixel is the most any one colour channel has lost against the paper (not
//!    luminance, which gives blue so little weight that a faded blue ink is nearly paper). The paper's noise level is read
//!    from the darkness histogram (median and median absolute deviation: most of the picture is
//!    paper), and alpha ramps from just above the noise to the ink's typical darkness, so stroke
//!    edges stay anti-aliased.
//! 4. Connected marks that are specks (tiny) or blobs (thick: a desk or the paper's edge, a
//!    smudge) are dropped, measured on their solid core so soft edges don't count. Ink is thin.
//! 5. Every pixel is painted one ink colour, with the alpha from step 3: the ink's own hue (a
//!    blue biro stays blue) measured against the paper, so a warm or cool photo doesn't tint it,
//!    and kept as it is: how the ink would look on white paper. One colour means no
//!    paper texture, noise or shading inside the strokes, and no fringes when it is scaled.
//! 6. Crop to the ink with a small margin and cap the size.

use crate::errcode;
use image::{DynamicImage, ImageDecoder, ImageEncoder, ImageReader, Rgb, RgbImage, Rgba, RgbaImage};
use std::io::Cursor;

/// Photos are shrunk to this longest side before the knock-out (a 48 MP photo is no better a
/// signature than a 6 MP one, and is eight times the work).
pub const MAX_WORK_SIDE: u32 = 3000;
/// The longest side of the result. A signature placed 150 mm wide at this size is ~270 dpi.
pub const MAX_OUTPUT_SIDE: u32 = 1600;
/// Smaller than this on either side isn't a photo of anything.
const MIN_SIDE: u32 = 16;

/// The result of an import.
#[derive(Debug, Clone)]
pub struct Imported {
    /// PNG, RGBA.
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// The single ink colour every pixel is painted with (sRGB).
    pub ink: [u8; 3],
    /// Where the result's top-left corner lies in the working image (after orientation and
    /// any shrink to `MAX_WORK_SIDE`), and the result's scale against the working image. For
    /// tests and diagnostics.
    pub origin: (i64, i64),
    pub scale: f64,
    /// The working image's scale against the framed image (oriented, turned and
    /// cropped): 1 unless that was larger than `MAX_WORK_SIDE`.
    pub work_scale: f64,
}

/// How the user framed the photo before the paper is knocked out, on the upright
/// (EXIF-oriented) image: quarter turns, then a crop box, which may be turned to lie along a
/// slanted signature. What's in the box comes out level.
#[derive(Debug, Clone, Copy, Default, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Adjust {
    /// Quarter turns clockwise (larger values wrap). The frame is the turned image.
    pub turns: u8,
    /// The crop box's turn, in degrees clockwise about its own centre. Level (0), the box is
    /// kept inside the frame; turned, it may stick out, and what's beyond the photo repeats
    /// its edge (paper, usually, which knocks out).
    pub angle: f64,
    /// The box before it's turned, as fractions of the frame (0 to 1). None is all of it.
    pub crop: Option<Crop>,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// The longest side of the preview the framing is chosen on.
pub const PREVIEW_SIDE: u32 = 2048;

/// Import a file from disk.
pub fn import_file(path: &str) -> Result<Imported, String> {
    let bytes = std::fs::read(path).map_err(|e| errcode::io(&e, format!("{path}: {e}")))?;
    import_bytes(&bytes)
}

/// Import a file from disk, framed as the user chose.
pub fn import_file_adjusted(path: &str, adjust: &Adjust) -> Result<Imported, String> {
    let bytes = std::fs::read(path).map_err(|e| errcode::io(&e, format!("{path}: {e}")))?;
    import_bytes_adjusted(&bytes, adjust)
}

/// Import an encoded image (JPEG, PNG, WebP, TIFF, BMP, GIF; HEIC through WIC), all of it.
pub fn import_bytes(bytes: &[u8]) -> Result<Imported, String> {
    import_bytes_adjusted(bytes, &Adjust::default())
}

/// Import an encoded image, framed as the user chose.
pub fn import_bytes_adjusted(bytes: &[u8], adjust: &Adjust) -> Result<Imported, String> {
    let img = load_oriented(bytes)?;
    let img = DynamicImage::ImageRgb8(frame(&on_white(&img), adjust));
    let (w, h) = (img.width(), img.height());
    if w < MIN_SIDE || h < MIN_SIDE {
        return Err(errcode::coded("signature_too_small", format!("image is {w} x {h}")));
    }
    let long = w.max(h);
    let (img, work_scale) = if long > MAX_WORK_SIDE {
        let s = MAX_WORK_SIDE as f64 / long as f64;
        let nw = ((w as f64 * s).round() as u32).max(1);
        let nh = ((h as f64 * s).round() as u32).max(1);
        (img.resize_exact(nw, nh, image::imageops::FilterType::Triangle), s)
    } else {
        (img, 1.0)
    };
    let work = img.to_rgb8();
    let mut out = knock_out(&work)?;
    out.work_scale = work_scale;
    Ok(out)
}

/// The upright picture, shrunk to `PREVIEW_SIDE` and encoded as JPEG, for choosing the framing
/// on (the webview can't show HEIC, and a 48 MP photo is a lot to send). Returns the JPEG and
/// the full-size picture's width and height.
pub fn preview_file(path: &str) -> Result<(Vec<u8>, u32, u32), String> {
    let bytes = std::fs::read(path).map_err(|e| errcode::io(&e, format!("{path}: {e}")))?;
    preview_bytes(&bytes)
}

pub fn preview_bytes(bytes: &[u8]) -> Result<(Vec<u8>, u32, u32), String> {
    let img = load_oriented(bytes)?;
    let (w, h) = (img.width(), img.height());
    if w < MIN_SIDE || h < MIN_SIDE {
        return Err(errcode::coded("signature_too_small", format!("image is {w} x {h}")));
    }
    let rgb = on_white(&img);
    let rgb = if w.max(h) > PREVIEW_SIDE {
        let s = PREVIEW_SIDE as f64 / w.max(h) as f64;
        let nw = ((w as f64 * s).round() as u32).max(1);
        let nh = ((h as f64 * s).round() as u32).max(1);
        image::imageops::resize(&rgb, nw, nh, image::imageops::FilterType::Triangle)
    } else {
        rgb
    };
    let mut buf = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut Cursor::new(&mut buf), 88)
        .write_image(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("JPEG encode failed: {e}"))?;
    Ok((buf, w, h))
}

/// Apply the user's framing (see `Adjust`) to an upright image.
pub fn frame(img: &RgbImage, a: &Adjust) -> RgbImage {
    let turned = match a.turns % 4 {
        1 => image::imageops::rotate90(img),
        2 => image::imageops::rotate180(img),
        3 => image::imageops::rotate270(img),
        _ => img.clone(),
    };
    let (fw, fh) = (turned.width() as f64, turned.height() as f64);
    // The crop in whole pixels, inside the frame, at least a pixel each way.
    let (cx, cy, cw, ch) = match a.crop {
        Some(c) if [c.x, c.y, c.w, c.h].iter().all(|v| v.is_finite()) => {
            let x0 = (c.x.clamp(0.0, 1.0) * fw).round().min(fw - 1.0);
            let y0 = (c.y.clamp(0.0, 1.0) * fh).round().min(fh - 1.0);
            let x1 = ((c.x + c.w).clamp(0.0, 1.0) * fw).round();
            let y1 = ((c.y + c.h).clamp(0.0, 1.0) * fh).round();
            (x0, y0, (x1 - x0).max(1.0), (y1 - y0).max(1.0))
        }
        _ => (0.0, 0.0, fw, fh),
    };
    let angle = if a.angle.is_finite() { a.angle } else { 0.0 };
    if angle.abs() < 1e-3 {
        if (cx, cy, cw, ch) == (0.0, 0.0, fw, fh) {
            return turned;
        }
        return image::imageops::crop_imm(&turned, cx as u32, cy as u32, cw as u32, ch as u32).to_image();
    }
    // A turned box: its centre stays in the frame, and its sides (along the box) are the crop's
    // width and height in frame pixels, at most twice the frame's, as a box turned over a
    // corner may stick out.
    let (mx, my, ow, oh) = match a.crop {
        Some(c) if [c.x, c.y, c.w, c.h].iter().all(|v| v.is_finite()) => (
            (c.x + c.w / 2.0).clamp(0.0, 1.0) * fw,
            (c.y + c.h / 2.0).clamp(0.0, 1.0) * fh,
            (c.w.abs().min(2.0) * fw).round().max(1.0) as u32,
            (c.h.abs().min(2.0) * fh).round().max(1.0) as u32,
        ),
        _ => (fw / 2.0, fh / 2.0, fw as u32, fh as u32),
    };
    // Each output pixel's centre, measured from the box's centre along the box's sides, turned
    // by the box's angle, is where it comes from in the turned image (sampled bilinearly, the
    // edges repeated beyond the photo).
    let (sin, cos) = angle.to_radians().sin_cos();
    let (tw, th) = (turned.width() as i64, turned.height() as i64);
    let px = |x: i64, y: i64| turned.get_pixel(x.clamp(0, tw - 1) as u32, y.clamp(0, th - 1) as u32);
    let mut out = RgbImage::new(ow, oh);
    let (hw, hh) = (ow as f64 / 2.0, oh as f64 / 2.0);
    for oy in 0..oh {
        for ox in 0..ow {
            let dx = ox as f64 + 0.5 - hw;
            let dy = oy as f64 + 0.5 - hh;
            let sx = mx + dx * cos - dy * sin - 0.5;
            let sy = my + dx * sin + dy * cos - 0.5;
            let (fx, fy) = (sx.floor(), sy.floor());
            let (tx, ty) = ((sx - fx) as f32, (sy - fy) as f32);
            let (x0, y0) = (fx as i64, fy as i64);
            let (a, b, c, d) = (px(x0, y0), px(x0 + 1, y0), px(x0, y0 + 1), px(x0 + 1, y0 + 1));
            let mut v = [0u8; 3];
            for i in 0..3 {
                let top = a[i] as f32 + (b[i] as f32 - a[i] as f32) * tx;
                let bot = c[i] as f32 + (d[i] as f32 - c[i] as f32) * tx;
                v[i] = (top + (bot - top) * ty).round() as u8;
            }
            out.put_pixel(ox, oy, Rgb(v));
        }
    }
    out
}

/// Decode an image and turn it upright from its EXIF orientation (phone photos are stored
/// sideways with a tag saying so). Formats the `image` crate can't read (HEIC above all) go
/// through Windows' own codecs (`wic.rs`).
pub fn load_oriented(bytes: &[u8]) -> Result<DynamicImage, String> {
    match load_with_image_crate(bytes) {
        Ok(img) => Ok(img),
        Err(first) => load_with_wic(bytes).map_err(|wic| wic.unwrap_or(first)),
    }
}

fn load_with_image_crate(bytes: &[u8]) -> Result<DynamicImage, String> {
    let not_image = |e: &dyn std::fmt::Display| errcode::coded("not_supported", format!("not a readable image: {e}"));
    let reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|e| not_image(&e))?;
    let mut decoder = reader.into_decoder().map_err(|e| not_image(&e))?;
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| not_image(&e))?;
    img.apply_orientation(orientation);
    Ok(img)
}

/// Decode through WIC. `Err(None)` means WIC can't either and the image crate's error stands;
/// `Err(Some(..))` is a better error (a HEIC photo without the codec to read it).
fn load_with_wic(bytes: &[u8]) -> Result<DynamicImage, Option<String>> {
    let heif = super::wic::looks_like_heif(bytes);
    match super::wic::decode(bytes) {
        Ok(d) => {
            let mut img = DynamicImage::ImageRgba8(d.rgba);
            eprintln!(
                "[signature] decoded with WIC: {}x{}, orientation {:?}{}",
                img.width(),
                img.height(),
                d.orientation,
                if heif { " (HEIF)" } else { "" }
            );
            if let Some(o) = d.orientation.and_then(|o| image::metadata::Orientation::from_exif(o as u8)) {
                img.apply_orientation(o);
            }
            Ok(img)
        }
        Err(e) => {
            if let super::wic::WicError::Failed(why) = &e {
                eprintln!("[signature] WIC decode failed: {why}");
            }
            // A HEIF file WIC couldn't read: the HEIF or HEVC extension is missing (HEVC is
            // what fails at the pixels when only HEIF is installed).
            Err(heif.then(|| errcode::coded("heic_codec_missing", "no Windows codec for this HEIF picture")))
        }
    }
}

/// The image as RGB, with any transparency composited onto white (a PNG that's already a
/// cut-out often stores black under its transparent pixels).
fn on_white(img: &DynamicImage) -> RgbImage {
    if !img.color().has_alpha() {
        return img.to_rgb8();
    }
    let rgba = img.to_rgba8();
    let mut out = RgbImage::new(rgba.width(), rgba.height());
    for (o, p) in out.pixels_mut().zip(rgba.pixels()) {
        let a = p[3] as f32 / 255.0;
        *o = Rgb([0, 1, 2].map(|c| (p[c] as f32 * a + 255.0 * (1.0 - a)).round() as u8));
    }
    out
}

/// The paper's colour everywhere, on a grid of small cells (each the average of `block` x
/// `block` pixels), interpolated between cell centres.
///
/// Per channel: a grey-scale closing (the brightest value within a radius, then the darkest
/// within the same radius) wipes out anything darker than the paper and narrower than the
/// radius (pen strokes), but leaves larger shapes where they were: the edge of a phone's
/// shadow stays put, where a plain "brightest nearby" would drag the bright side over it and
/// read the shadow's edge as ink. A light blur after takes out the noise.
struct Paper {
    block: f32,
    gw: usize,
    gh: usize,
    rgb: Vec<[f32; 3]>,
    /// Cells that aren't paper at all (a desk, a dark background beyond the sheet's edge),
    /// grown by the blur's reach so the sheet's edge goes with them.
    off_sheet: Vec<bool>,
}

impl Paper {
    /// `reach`: the closing radius as a fraction of the long side (see `REACH`).
    fn estimate(img: &RgbImage, reach: f32) -> Paper {
        let (w, h) = (img.width() as usize, img.height() as usize);
        let long = w.max(h);
        // Cells: at most ~600 along the long side.
        let block = long.div_ceil(600).max(1);
        let gw = w.div_ceil(block);
        let gh = h.div_ceil(block);
        // The closing radius: strokes up to twice it wide vanish; at least 4 pixels.
        let radius_px = (long as f32 * reach).max(4.0);
        let r = (radius_px / block as f32).ceil() as usize;
        let mut chans = [vec![0f32; gw * gh], vec![0f32; gw * gh], vec![0f32; gw * gh]];
        let mut counts = vec![0u32; gw * gh];
        for y in 0..h {
            for x in 0..w {
                let p = img.get_pixel(x as u32, y as u32);
                let i = (y / block) * gw + x / block;
                for c in 0..3 {
                    chans[c][i] += p[c] as f32;
                }
                counts[i] += 1;
            }
        }
        for ch in chans.iter_mut() {
            for (v, &n) in ch.iter_mut().zip(&counts) {
                *v /= n.max(1) as f32;
            }
            let dilated = window(ch, gw, gh, r, Window::Max);
            let closed = window(&dilated, gw, gh, r, Window::Min);
            *ch = window(&closed, gw, gh, r.div_ceil(2), Window::Mean);
        }
        let rgb: Vec<[f32; 3]> = (0..gw * gh).map(|i| [chans[0][i], chans[1][i], chans[2][i]]).collect();

        // Off the sheet: "paper" under 35% as bright as the typical paper (the median cell;
        // most of the picture is paper). A phone's shadow takes paper to about half.
        let lums: Vec<f32> = rgb.iter().map(|p| 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]).collect();
        let mut sorted = lums.clone();
        sorted.sort_by(|a, b| a.total_cmp(b));
        let typical = sorted[sorted.len() / 2];
        let dark: Vec<f32> = lums.iter().map(|&l| if l < 0.35 * typical { 1.0 } else { 0.0 }).collect();
        let grown = window(&dark, gw, gh, r.div_ceil(2) + 2, Window::Max);
        let off_sheet = grown.iter().map(|&v| v > 0.0).collect();
        Paper { block: block as f32, gw, gh, rgb, off_sheet }
    }

    fn on_sheet(&self, x: usize, y: usize) -> bool {
        let b = self.block as usize;
        !self.off_sheet[(y / b).min(self.gh - 1) * self.gw + (x / b).min(self.gw - 1)]
    }

    /// The paper colour at a pixel, bilinear between block centres.
    fn at(&self, x: usize, y: usize) -> [f32; 3] {
        let fx = ((x as f32 + 0.5) / self.block - 0.5).clamp(0.0, (self.gw - 1) as f32);
        let fy = ((y as f32 + 0.5) / self.block - 0.5).clamp(0.0, (self.gh - 1) as f32);
        let (x0, y0) = (fx.floor() as usize, fy.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(self.gw - 1), (y0 + 1).min(self.gh - 1));
        let (tx, ty) = (fx - x0 as f32, fy - y0 as f32);
        let g = |gx: usize, gy: usize| self.rgb[gy * self.gw + gx];
        let (a, b, c, d) = (g(x0, y0), g(x1, y0), g(x0, y1), g(x1, y1));
        let mut out = [0f32; 3];
        for i in 0..3 {
            let top = a[i] + (b[i] - a[i]) * tx;
            let bot = c[i] + (d[i] - c[i]) * tx;
            out[i] = top + (bot - top) * ty;
        }
        out
    }
}

#[derive(Clone, Copy)]
enum Window {
    Max,
    Min,
    Mean,
}

/// A square window filter (separable: rows, then columns), edges clamped to the image.
fn window(src: &[f32], w: usize, h: usize, r: usize, kind: Window) -> Vec<f32> {
    let pass = |src: &[f32], len: usize, count: usize, at: &dyn Fn(usize, usize) -> usize| -> Vec<f32> {
        let mut out = vec![0f32; src.len()];
        for line in 0..count {
            for i in 0..len {
                let (a, b) = (i.saturating_sub(r), (i + r).min(len - 1));
                let mut acc = match kind {
                    Window::Max => f32::MIN,
                    Window::Min => f32::MAX,
                    Window::Mean => 0.0,
                };
                for j in a..=b {
                    let v = src[at(line, j)];
                    acc = match kind {
                        Window::Max => acc.max(v),
                        Window::Min => acc.min(v),
                        Window::Mean => acc + v,
                    };
                }
                if let Window::Mean = kind {
                    acc /= (b - a + 1) as f32;
                }
                out[at(line, i)] = acc;
            }
        }
        out
    };
    let rows = pass(src, w, h, &|y, x| y * w + x);
    pass(&rows, h, w, &|x, y| y * w + x)
}

/// A value at a fraction through a histogram of `bins` buckets over [lo, hi).
fn hist_quantile(hist: &[u32], lo: f32, hi: f32, q: f64) -> f32 {
    let total: u64 = hist.iter().map(|&c| c as u64).sum();
    if total == 0 {
        return lo;
    }
    let target = (total as f64 * q).ceil().max(1.0) as u64;
    let mut acc = 0u64;
    for (i, &c) in hist.iter().enumerate() {
        acc += c as u64;
        if acc >= target {
            return lo + (i as f32 + 0.5) * (hi - lo) / hist.len() as f32;
        }
    }
    hi
}

const DBINS: usize = 2048;
const DLO: f32 = -1.0;
const DHI: f32 = 1.0;

fn dbin(d: f32) -> usize {
    (((d - DLO) / (DHI - DLO)) * DBINS as f32).clamp(0.0, (DBINS - 1) as f32) as usize
}

/// The paper estimate's closing radius, as a fraction of the picture's long side, tried in
/// turn. 0.8% erases strokes up to ~1.6% of the long side wide (a felt tip on a whole photo)
/// and follows a phone's shadow closely. A picture cropped tight round a signature in marker
/// has strokes wider than that, which the first pass takes for paper and finds no ink; the
/// second, wider pass catches those (a tight crop has little shadow to follow).
const REACH: [f32; 2] = [0.008, 0.03];

/// Knock the paper out of an upright RGB image. See the module comment for the method.
pub fn knock_out(img: &RgbImage) -> Result<Imported, String> {
    let mut first_err = None;
    for reach in REACH {
        match knock_out_with(img, reach) {
            Ok(out) => return Ok(out),
            Err(e) => {
                first_err.get_or_insert(e);
            }
        }
    }
    Err(first_err.unwrap())
}

fn knock_out_with(img: &RgbImage, reach: f32) -> Result<Imported, String> {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let n = w * h;
    let paper = Paper::estimate(img, reach);

    // Darkness against the local paper: the most any one channel has lost (on 3x3-smoothed
    // channels, which takes the edge off sensor noise; a pen stroke is several pixels wide in
    // any usable photo). Not luminance: that gives blue 7% of its weight, so a faded blue ink
    // is nearly as bright as the paper, though it takes out most of the red.
    let mut chans = [vec![0f32; n], vec![0f32; n], vec![0f32; n]];
    for y in 0..h {
        for x in 0..w {
            let p = img.get_pixel(x as u32, y as u32);
            for c in 0..3 {
                chans[c][y * w + x] = p[c] as f32;
            }
        }
    }
    let chans = chans.map(|ch| box3(&ch, w, h));
    let mut dark = vec![0f32; n];
    let mut hist = vec![0u32; DBINS];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let d = if paper.on_sheet(x, y) {
                let p = paper.at(x, y);
                (0..3).map(|c| 1.0 - chans[c][i] / p[c].max(1.0)).fold(f32::MIN, f32::max)
            } else {
                0.0
            };
            dark[i] = d;
            hist[dbin(d)] += 1;
        }
    }

    // Paper noise: median and MAD of darkness (the picture is mostly paper).
    let median = hist_quantile(&hist, DLO, DHI, 0.5);
    let mut dev = vec![0u32; DBINS];
    for &d in &dark {
        dev[dbin(DLO + (d - median).abs())] += 1;
    }
    let mad = hist_quantile(&dev, DLO, DHI, 0.5) - DLO;
    let sigma = 1.4826 * mad;
    let t0 = (median + 5.0 * sigma).max(0.08);

    // The ink's typical darkness: the 90th percentile of what is clearly above the noise.
    let mut ink_hist = vec![0u32; DBINS];
    let mut above = 0usize;
    for &d in &dark {
        if d > t0 {
            ink_hist[dbin(d)] += 1;
            above += 1;
        }
    }
    let min_ink = (n / 20000).max(12);
    if above < min_ink {
        return Err(errcode::coded("signature_no_ink", "no ink found"));
    }
    let ink_level = hist_quantile(&ink_hist, DLO, DHI, 0.9);
    let t1 = (t0 + 0.5 * (ink_level - t0)).max(t0 + 0.05);

    let mut alpha: Vec<f32> = dark.iter().map(|&d| ((d - t0) / (t1 - t0)).clamp(0.0, 1.0)).collect();

    if !filter_marks(&mut alpha, w, h) {
        return Err(errcode::coded("signature_no_ink", "only specks or blobs found"));
    }

    // Bounds of what's left.
    let (mut x0, mut y0, mut x1, mut y1) = (usize::MAX, usize::MAX, 0usize, 0usize);
    for y in 0..h {
        for x in 0..w {
            if alpha[y * w + x] > 0.0 {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
        }
    }
    if x0 == usize::MAX {
        return Err(errcode::coded("signature_no_ink", "only specks or blobs found"));
    }

    let ink = ink_colour(img, &paper, &alpha, w, h);

    // Crop with a margin of 3% of the ink's larger side (at least 4 px). The margin may run
    // past the photo's edge: it's transparent either way.
    let (bw, bh) = (x1 - x0 + 1, y1 - y0 + 1);
    let margin = ((bw.max(bh) as f32 * 0.03).round() as i64).max(4);
    let ox = x0 as i64 - margin;
    let oy = y0 as i64 - margin;
    let cw = bw as u32 + 2 * margin as u32;
    let ch = bh as u32 + 2 * margin as u32;
    let mut out = RgbaImage::from_pixel(cw, ch, Rgba([ink[0], ink[1], ink[2], 0]));
    for y in y0..=y1 {
        for x in x0..=x1 {
            let a = alpha[y * w + x];
            if a > 0.0 {
                let px = (x as i64 - ox) as u32;
                let py = (y as i64 - oy) as u32;
                out.put_pixel(px, py, Rgba([ink[0], ink[1], ink[2], (a * 255.0).round() as u8]));
            }
        }
    }

    // Cap the size. Every pixel has the same colour, so scaling can't fringe.
    let mut scale = 1.0;
    let long = cw.max(ch);
    if long > MAX_OUTPUT_SIDE {
        scale = MAX_OUTPUT_SIDE as f64 / long as f64;
        let nw = ((cw as f64 * scale).round() as u32).max(1);
        let nh = ((ch as f64 * scale).round() as u32).max(1);
        out = image::imageops::resize(&out, nw, nh, image::imageops::FilterType::Lanczos3);
    }

    let (width, height) = out.dimensions();
    let png = encode_png(&out)?;
    Ok(Imported { png, width, height, ink, origin: (ox, oy), scale, work_scale: 1.0 })
}

/// Encode RGBA as PNG.
pub fn encode_png(img: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .map_err(|e| format!("PNG encode failed: {e}"))?;
    Ok(buf)
}

/// 3x3 box blur, edges clamped.
fn box3(src: &[f32], w: usize, h: usize) -> Vec<f32> {
    let mut tmp = vec![0f32; src.len()];
    for y in 0..h {
        for x in 0..w {
            let l = x.saturating_sub(1);
            let r = (x + 1).min(w - 1);
            tmp[y * w + x] = (src[y * w + l] + src[y * w + x] + src[y * w + r]) / 3.0;
        }
    }
    let mut out = vec![0f32; src.len()];
    for y in 0..h {
        let u = y.saturating_sub(1);
        let d = (y + 1).min(h - 1);
        for x in 0..w {
            out[y * w + x] = (tmp[u * w + x] + tmp[y * w + x] + tmp[d * w + x]) / 3.0;
        }
    }
    out
}

/// One connected mark.
struct Mark {
    /// Range into the shared member list.
    first: usize,
    area: usize,
    max_alpha: f32,
    /// Pixels at least half opaque: the mark's solid core. Soft edges (and a JPEG's colour
    /// bleeding past a coloured stroke) don't count, so a dot and a speck of dust are told
    /// apart by what's really there.
    core: usize,
    /// 2 * core / the core's boundary pixels: a line's width, half a solid square's side.
    thick: f32,
}

/// Drop connected marks that aren't ink: blobs (thick: a desk at the photo's edge, the
/// paper's edge, a smudge), faint marks (never fully dark), and specks (smaller than a dot
/// from the pen that wrote the signature). 8-connected. Returns false if what's left is too
/// little to be a signature.
fn filter_marks(alpha: &mut [f32], w: usize, h: usize) -> bool {
    let n = w * h;
    // A pen stroke is well under 3% of the photo's short side (a felt tip is about 1.5%) or 2%
    // of its long side (a picture cropped to a signature is short: a felt tip on one 60 mm
    // wide is about 1.5% of that). Curves and diagonals measure up to ~1.5 times their width.
    let max_thick = (w.min(h) as f32 * 0.03).max(w.max(h) as f32 * 0.02).max(10.0);
    let mut seen = vec![false; n];
    let mut stack = Vec::new();
    let mut members = Vec::new();
    let mut marks = Vec::new();
    for start in 0..n {
        if alpha[start] <= 0.0 || seen[start] {
            continue;
        }
        seen[start] = true;
        stack.push(start);
        let first = members.len();
        let mut max_alpha = 0f32;
        let (mut core, mut boundary) = (0usize, 0usize);
        while let Some(i) = stack.pop() {
            members.push(i);
            max_alpha = max_alpha.max(alpha[i]);
            let solid = alpha[i] >= 0.5;
            core += solid as usize;
            let (x, y) = ((i % w) as i64, (i / w) as i64);
            let mut edge = false;
            for (dx, dy) in [(-1i64, -1i64), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)] {
                let (nx, ny) = (x + dx, y + dy);
                let inside = nx >= 0 && ny >= 0 && nx < w as i64 && ny < h as i64;
                let j = if inside { ny as usize * w + nx as usize } else { 0 };
                if !inside || alpha[j] < 0.5 {
                    edge |= dx == 0 || dy == 0;
                }
                if !inside || alpha[j] <= 0.0 {
                    continue;
                }
                if !seen[j] {
                    seen[j] = true;
                    stack.push(j);
                }
            }
            boundary += (solid && edge) as usize;
        }
        let area = members.len() - first;
        marks.push(Mark { first, area, max_alpha, core, thick: 2.0 * core as f32 / boundary.max(1) as f32 });
    }

    // Which marks to keep, with blobs over `max_thick` dropped.
    let choose = |max_thick: f32| -> (Vec<bool>, usize) {
        let inky = |m: &Mark| m.max_alpha >= 0.6 && m.thick <= max_thick;
        // The pen's width, from the biggest mark that looks like ink (the signature's main
        // stroke), measured on its solid core. A dot from that pen has a core of about half its
        // width squared or more (a round dot is 0.785 times it, and the stroke measures wide on
        // its curves); dust is smaller. Erring towards keeping: a lost dot spoils a signature,
        // a kept speck is cropped out in the framing.
        let pen = marks.iter().filter(|m| inky(m)).max_by_key(|m| m.core).map(|m| m.thick).unwrap_or(0.0);
        let min_core = ((0.4 * pen * pen) as usize).max(12);
        let keep: Vec<bool> = marks.iter().map(|m| inky(m) && m.core >= min_core).collect();
        let kept = marks.iter().zip(&keep).filter(|(_, k)| **k).map(|(m, _)| m.area).sum();
        (keep, kept)
    };
    // A signature is more than a few dots: at least 1/5000 of the picture (a 1200 x 800 photo
    // needs ~190 px of ink; a pen line 6 px wide and 32 px long).
    let enough = (n / 5000).max(100);
    let (mut keep, mut kept) = choose(max_thick);
    if kept < enough {
        // Nothing thin enough: a picture cropped tight round a signature in thick marker, where
        // the pen is large against the picture. What's dark is the signature, however thick.
        (keep, kept) = choose(f32::INFINITY);
    }
    for (m, _) in marks.iter().zip(&keep).filter(|(_, k)| !**k) {
        for &i in &members[m.first..m.first + m.area] {
            alpha[i] = 0.0;
        }
    }
    kept >= enough
}

/// The ink's colour as it is: the per-channel median of the core ink's reflectance (pixel over
/// paper, so lighting and white balance cancel), which is how it would look on white paper. Not
/// darkened: a faded ink stays faded (the pad offers solid Black and Blue for that).
fn ink_colour(img: &RgbImage, paper: &Paper, alpha: &[f32], w: usize, h: usize) -> [u8; 3] {
    let mut hists = [vec![0u32; 256], vec![0u32; 256], vec![0u32; 256]];
    let mut count = 0;
    for pass_min in [0.999f32, 0.5] {
        for y in 0..h {
            for x in 0..w {
                if alpha[y * w + x] >= pass_min {
                    let p = img.get_pixel(x as u32, y as u32);
                    let bg = paper.at(x, y);
                    for c in 0..3 {
                        let r = (p[c] as f32 / bg[c].max(1.0)).clamp(0.0, 1.0);
                        hists[c][(r * 255.0).round() as usize] += 1;
                    }
                    count += 1;
                }
            }
        }
        if count >= 20 {
            break;
        }
    }
    hists.map(|hh| (hist_quantile(&hh, 0.0, 1.0, 0.5) * 255.0).round().clamp(0.0, 255.0) as u8)
}
