//! Image documents (JPEG, PNG, WebP, TIFF, BMP, GIF) as single-page documents.
//!
//! Owned by WP-Images. `docs.rs` dispatches here. The contract:
//!
//! - `ImageDoc` is `Send + Sync`: it lives in an `Arc` in the document registry and is
//!   rendered from blocking threads, possibly two regions at once. Rendering only reads.
//! - Closing a document drops its `ImageDoc`, which frees the pixels.
//! - Errors are strings the UI shows as they are ("Not a PDF or supported image", ...).
//! - Coordinates match the PDF path exactly: the page is `page_size()` points; a region is
//!   the device-pixel rect (x, y, w, h) of the page bitmap at `rs` device pixels per point
//!   (bitmap size `ceil(w_pt * rs)` x `ceil(h_pt * rs)`). Pixels are RGBA, opaque.
//!
//! How it works: `open` decodes the file once (the `image` crate, off the PDFium workers),
//! applies the EXIF orientation, flattens any alpha onto white and keeps two levels of
//! detail in memory: the full image and a quarter-size copy. A region render picks the
//! smallest level that still has at least one source pixel per device pixel, crops the
//! matching source rectangle and resamples it with `fast_image_resize`. Nothing but the
//! requested region ever crosses IPC.
//!
//! The page size comes from the image's embedded resolution (EXIF / JFIF for JPEG, pHYs for
//! PNG, the TIFF resolution tags, the BMP header, EXIF in WebP), 96 DPI when there is none,
//! so "actual size" and 100% printing come out right. Images over 120 megapixels are kept
//! at half resolution (page size unchanged) with a note for the tab.

use crate::pdfium::{PageSize, ERR_NOT_SUPPORTED};
use fast_image_resize::{images::Image, images::ImageRef, FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageReader};
use std::path::Path;

/// File extensions routed to this module (lower case, no dot).
pub const EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "gif"];

/// True if `path` should open as an image document.
pub fn handles(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// One level of detail: opaque RGBA, tightly packed.
struct Level {
    w: u32,
    h: u32,
    px: Vec<u8>,
}

/// A decoded image held in memory.
pub struct ImageDoc {
    full: Level,
    quarter: Level,
    /// Page size in points (f64; PageSize is f32).
    page: (f64, f64),
    note: Option<String>,
}

impl ImageDoc {
    /// Decode the file once. Blocking; call from a worker thread (never a PDFium worker).
    pub fn open(path: &Path) -> Result<ImageDoc, String> {
        let bytes = std::fs::read(path).map_err(|e| format!("Could not read the file: {e}"))?;
        Self::from_bytes(&bytes)
    }

    /// Decode an image held in memory (the body of `open`; tests use it directly).
    pub fn from_bytes(bytes: &[u8]) -> Result<ImageDoc, String> {
        let mut reader = ImageReader::new(std::io::Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|e| format!("Could not read the file: {e}"))?;
        if reader.format().is_none() {
            return Err(ERR_NOT_SUPPORTED.into());
        }
        // The default limits refuse anything over 512 MB decoded; big scans are the point.
        reader.no_limits();
        let mut decoder = reader.into_decoder().map_err(decode_error)?;
        let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
        let mut img = DynamicImage::from_decoder(decoder).map_err(decode_error)?;
        img.apply_orientation(orientation);

        let has_alpha = img.color().has_alpha();
        let rgba = img.into_rgba8();
        let (w, h) = rgba.dimensions();
        if w == 0 || h == 0 {
            return Err("This image is empty".into());
        }
        let mut px = rgba.into_raw();
        if has_alpha {
            geom::flatten_on_white(&mut px);
        }

        // Page size from the original pixel dimensions, before any memory-ceiling downscale.
        let mut dpi = dpi::detect(bytes).unwrap_or((geom::DEFAULT_DPI, geom::DEFAULT_DPI));
        if geom::swaps_axes(orientation) {
            dpi = (dpi.1, dpi.0);
        }
        let (pw, ph) = geom::page_size_pt(w, h, dpi);
        let page = (pw, ph);

        let mut note = None;
        let mut full = Level { w, h, px };
        if geom::should_halve(w, h) {
            let (hw, hh) = geom::halve_dims(w, h);
            full = resize_level(&full, hw, hh)?;
            note = Some(format!(
                "Opened at half resolution ({} MP is over the 120 MP limit)",
                (w as u64 * h as u64 + 500_000) / 1_000_000
            ));
        }
        let (qw, qh) = geom::quarter_dims(full.w, full.h);
        let quarter = resize_level(&full, qw, qh)?;
        Ok(ImageDoc { full, quarter, page, note })
    }

    /// Page size in points: pixels at the image's embedded DPI, 96 DPI when it has none.
    pub fn page_size(&self) -> PageSize {
        PageSize { w: self.page.0 as f32, h: self.page.1 as f32 }
    }

    /// A note for the tab, e.g. "Opened at half resolution (...)". None normally.
    pub fn note(&self) -> Option<String> {
        self.note.clone()
    }

    /// Pixel dimensions of the full level held in memory (after any halving).
    pub fn pixel_size(&self) -> (u32, u32) {
        (self.full.w, self.full.h)
    }

    /// Render the region into `out`: RGBA rows of `stride` bytes, `h` rows, already filled
    /// opaque white. Writes only the `w * 4` bytes of each row.
    #[allow(clippy::too_many_arguments)]
    pub fn render_region(
        &self,
        rs: f64,
        x: i64,
        y: i64,
        w: i32,
        h: i32,
        out: &mut [u8],
        stride: usize,
    ) -> Result<(), String> {
        if w <= 0 || h <= 0 || !(rs > 0.0) {
            return Err("empty region".into());
        }
        if out.len() < stride * (h as usize - 1) + w as usize * 4 {
            return Err("render buffer too small".into());
        }
        let ext_w = self.page.0 * rs;
        let ext_h = self.page.1 * rs;
        let level = if geom::use_quarter(self.quarter.w, self.quarter.h, ext_w, ext_h) {
            &self.quarter
        } else {
            &self.full
        };
        let Some(m) = geom::map_region(level.w, level.h, ext_w, ext_h, x, y, w, h) else {
            return Ok(()); // entirely off the page: leave it white
        };
        let mut dst = Image::new(m.dw, m.dh, PixelType::U8x4);
        resize_crop(level, &mut dst, m.src)?;
        let row = m.dw as usize * 4;
        let buf = dst.buffer();
        for r in 0..m.dh as usize {
            let o = (m.dy as usize + r) * stride + m.dx as usize * 4;
            out[o..o + row].copy_from_slice(&buf[r * row..(r + 1) * row]);
        }
        Ok(())
    }

    /// The whole image scaled so its longer side is `max_side` pixels: (w, h, RGBA).
    pub fn thumbnail(&self, max_side: u32) -> Result<(u32, u32, Vec<u8>), String> {
        let (tw, th) = geom::fit_long_side(self.page.0, self.page.1, max_side.max(1));
        let level = if self.quarter.w >= tw && self.quarter.h >= th { &self.quarter } else { &self.full };
        let out = resize_level(level, tw, th)?;
        Ok((out.w, out.h, out.px))
    }
}

fn decode_error(e: image::ImageError) -> String {
    match e {
        image::ImageError::Unsupported(u) => {
            format!("This image uses a format Vellum can't read yet ({u})")
        }
        image::ImageError::Limits(_) | image::ImageError::IoError(_) => format!("Could not open this image: {e}"),
        other => format!("This image looks damaged and couldn't be decoded ({other})"),
    }
}

fn resize_options(src: (f64, f64, f64, f64)) -> ResizeOptions {
    ResizeOptions::new()
        .resize_alg(ResizeAlg::Convolution(FilterType::Bilinear))
        .crop(src.0, src.1, src.2, src.3)
        .use_alpha(false)
}

fn resize_crop(level: &Level, dst: &mut Image, src: (f64, f64, f64, f64)) -> Result<(), String> {
    let view = ImageRef::new(level.w, level.h, &level.px, PixelType::U8x4).map_err(|e| format!("image buffer: {e}"))?;
    Resizer::new()
        .resize(&view, dst, &resize_options(src))
        .map_err(|e| format!("image resample failed: {e}"))
}

fn resize_level(src: &Level, w: u32, h: u32) -> Result<Level, String> {
    let mut dst = Image::new(w, h, PixelType::U8x4);
    resize_crop(src, &mut dst, (0.0, 0.0, src.w as f64, src.h as f64))?;
    Ok(Level { w, h, px: dst.into_vec() })
}

/// Pure geometry: page size, level choice and region mapping. Public for the tests.
pub mod geom {
    use image::metadata::Orientation;

    pub const DEFAULT_DPI: f64 = 96.0;
    /// Images with more pixels than this are kept at half resolution.
    pub const MAX_PIXELS: u64 = 120_000_000;

    /// Page size in points for an image of `w` x `h` pixels at `dpi` (x, y).
    pub fn page_size_pt(w: u32, h: u32, dpi: (f64, f64)) -> (f64, f64) {
        (w as f64 * 72.0 / dpi.0, h as f64 * 72.0 / dpi.1)
    }

    /// A resolution worth believing (rejects 0, junk and absurd values).
    pub fn sane_dpi(d: f64) -> bool {
        d.is_finite() && (10.0..=50_000.0).contains(&d)
    }

    /// True when the orientation turns the image a quarter turn (width and height swap).
    pub fn swaps_axes(o: Orientation) -> bool {
        matches!(
            o,
            Orientation::Rotate90 | Orientation::Rotate270 | Orientation::Rotate90FlipH | Orientation::Rotate270FlipH
        )
    }

    pub fn should_halve(w: u32, h: u32) -> bool {
        w as u64 * h as u64 > MAX_PIXELS
    }

    pub fn halve_dims(w: u32, h: u32) -> (u32, u32) {
        (w.div_ceil(2).max(1), h.div_ceil(2).max(1))
    }

    pub fn quarter_dims(w: u32, h: u32) -> (u32, u32) {
        (w.div_ceil(4).max(1), h.div_ceil(4).max(1))
    }

    /// Use the quarter level when it still has at least one pixel per device pixel of the
    /// page bitmap (`ext_w` x `ext_h`, the page's exact extent at the render scale).
    pub fn use_quarter(qw: u32, qh: u32, ext_w: f64, ext_h: f64) -> bool {
        qw as f64 >= ext_w && qh as f64 >= ext_h
    }

    /// `w` x `h` scaled so the longer side is `max_side`, at least 1 x 1.
    pub fn fit_long_side(w: f64, h: f64, max_side: u32) -> (u32, u32) {
        let s = max_side as f64 / w.max(h).max(f64::MIN_POSITIVE);
        (((w * s).round() as u32).max(1), ((h * s).round() as u32).max(1))
    }

    /// Where a region lands: the destination rect inside the region buffer and the matching
    /// source rectangle (left, top, width, height) in level pixels.
    #[derive(Debug, Clone, Copy, PartialEq)]
    pub struct RegionMap {
        pub dx: u32,
        pub dy: u32,
        pub dw: u32,
        pub dh: u32,
        pub src: (f64, f64, f64, f64),
    }

    /// Map the device-pixel region (x, y, w, h) of a page bitmap whose exact extent is
    /// `ext_w` x `ext_h` onto a `sw` x `sh` source. The bitmap is `ceil(ext)` pixels; the
    /// part of the region outside it maps to nothing (stays white). None when nothing of the
    /// page is inside the region.
    #[allow(clippy::too_many_arguments)]
    pub fn map_region(sw: u32, sh: u32, ext_w: f64, ext_h: f64, x: i64, y: i64, w: i32, h: i32) -> Option<RegionMap> {
        if w <= 0 || h <= 0 || !(ext_w > 0.0) || !(ext_h > 0.0) {
            return None;
        }
        let bw = ext_w.ceil() as i64;
        let bh = ext_h.ceil() as i64;
        let x0 = x.max(0);
        let y0 = y.max(0);
        let x1 = (x + w as i64).min(bw);
        let y1 = (y + h as i64).min(bh);
        if x1 <= x0 || y1 <= y0 {
            return None;
        }
        let kx = sw as f64 / ext_w;
        let ky = sh as f64 / ext_h;
        let left = (x0 as f64 * kx).min(sw as f64);
        let top = (y0 as f64 * ky).min(sh as f64);
        // The last bitmap pixel may run past the exact extent; clamp to the source.
        let right = (x1 as f64 * kx).min(sw as f64);
        let bottom = (y1 as f64 * ky).min(sh as f64);
        // A sliver under one source pixel still needs a non-empty crop.
        let width = (right - left).max(f64::EPSILON.max(1e-6));
        let height = (bottom - top).max(f64::EPSILON.max(1e-6));
        let left = left.min(sw as f64 - width).max(0.0);
        let top = top.min(sh as f64 - height).max(0.0);
        Some(RegionMap {
            dx: (x0 - x) as u32,
            dy: (y0 - y) as u32,
            dw: (x1 - x0) as u32,
            dh: (y1 - y0) as u32,
            src: (left, top, width, height),
        })
    }

    /// Composite RGBA pixels over white in place, leaving them opaque.
    pub fn flatten_on_white(px: &mut [u8]) {
        for p in px.chunks_exact_mut(4) {
            let a = p[3] as u32;
            if a == 255 {
                continue;
            }
            for c in &mut p[..3] {
                *c = ((*c as u32 * a + 255 * (255 - a) + 127) / 255) as u8;
            }
            p[3] = 255;
        }
    }
}

/// Embedded resolution, read straight from the file bytes. Public for the tests.
pub mod dpi {
    use super::geom::sane_dpi;

    /// (x, y) DPI from whatever the format carries, or None.
    pub fn detect(b: &[u8]) -> Option<(f64, f64)> {
        let raw = if b.starts_with(b"\xFF\xD8") {
            jpeg(b)
        } else if b.starts_with(b"\x89PNG\r\n\x1a\n") {
            png(b)
        } else if b.starts_with(b"II*\0") || b.starts_with(b"MM\0*") {
            tiff(b)
        } else if b.starts_with(b"BM") {
            bmp(b)
        } else if b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
            webp(b)
        } else {
            None
        }?;
        normalise(raw)
    }

    /// Accept a pair when both are sane, or one sane value for both axes.
    fn normalise((x, y): (f64, f64)) -> Option<(f64, f64)> {
        match (sane_dpi(x), sane_dpi(y)) {
            (true, true) => Some((x, y)),
            (true, false) => Some((x, x)),
            (false, true) => Some((y, y)),
            _ => None,
        }
    }

    fn be16(b: &[u8], o: usize) -> Option<u16> {
        Some(u16::from_be_bytes(b.get(o..o + 2)?.try_into().ok()?))
    }
    fn be32(b: &[u8], o: usize) -> Option<u32> {
        Some(u32::from_be_bytes(b.get(o..o + 4)?.try_into().ok()?))
    }
    fn le32(b: &[u8], o: usize) -> Option<u32> {
        Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
    }

    /// JPEG: EXIF (APP1) resolution when present and sane, else JFIF (APP0) density.
    pub fn jpeg(b: &[u8]) -> Option<(f64, f64)> {
        let mut jfif = None;
        let mut exif = None;
        let mut i = 2;
        while i + 4 <= b.len() && b[i] == 0xFF {
            let marker = b[i + 1];
            if marker == 0xFF {
                i += 1; // fill byte
                continue;
            }
            if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
                i += 2;
                continue;
            }
            if marker == 0xDA || marker == 0xD9 {
                break; // start of scan: no more metadata
            }
            let len = be16(b, i + 2)? as usize;
            let seg = b.get(i + 4..(i + 2 + len).min(b.len()))?;
            if marker == 0xE0 && seg.starts_with(b"JFIF\0") && seg.len() >= 12 {
                let unit = seg[7];
                let (xd, yd) = (be16(seg, 8)? as f64, be16(seg, 10)? as f64);
                jfif = match unit {
                    1 => Some((xd, yd)),
                    2 => Some((xd * 2.54, yd * 2.54)),
                    _ => None, // aspect ratio only
                };
            } else if marker == 0xE1 && seg.starts_with(b"Exif\0\0") {
                exif = tiff(&seg[6..]);
            }
            i += 2 + len;
        }
        exif.and_then(normalise).or(jfif)
    }

    /// PNG: the pHYs chunk, when its unit is the metre.
    pub fn png(b: &[u8]) -> Option<(f64, f64)> {
        let mut i = 8;
        while i + 8 <= b.len() {
            let len = be32(b, i)? as usize;
            let ty = b.get(i + 4..i + 8)?;
            if ty == b"pHYs" {
                let d = b.get(i + 8..i + 8 + 9)?;
                if d[8] != 1 {
                    return None;
                }
                return Some((be32(d, 0)? as f64 * 0.0254, be32(d, 4)? as f64 * 0.0254));
            }
            if ty == b"IDAT" || ty == b"IEND" {
                return None;
            }
            i = i.checked_add(12 + len)?;
        }
        None
    }

    /// TIFF structure (a .tif file or an EXIF block): XResolution / YResolution with
    /// ResolutionUnit from IFD0. A missing unit means inches (the TIFF default).
    pub fn tiff(b: &[u8]) -> Option<(f64, f64)> {
        let le = match b.get(0..2)? {
            b"II" => true,
            b"MM" => false,
            _ => return None,
        };
        let u16_at = |o: usize| -> Option<u16> {
            let s: [u8; 2] = b.get(o..o + 2)?.try_into().ok()?;
            Some(if le { u16::from_le_bytes(s) } else { u16::from_be_bytes(s) })
        };
        let u32_at = |o: usize| -> Option<u32> {
            let s: [u8; 4] = b.get(o..o + 4)?.try_into().ok()?;
            Some(if le { u32::from_le_bytes(s) } else { u32::from_be_bytes(s) })
        };
        let rational = |o: usize| -> Option<f64> {
            let (n, d) = (u32_at(o)?, u32_at(o + 4)?);
            (d != 0).then(|| n as f64 / d as f64)
        };
        let ifd = u32_at(4)? as usize;
        let n = u16_at(ifd)? as usize;
        let (mut xr, mut yr, mut unit) = (None, None, 2u16);
        for k in 0..n {
            let e = ifd + 2 + k * 12;
            let tag = u16_at(e)?;
            let ty = u16_at(e + 2)?;
            match (tag, ty) {
                (0x011A, 5) => xr = rational(u32_at(e + 8)? as usize),
                (0x011B, 5) => yr = rational(u32_at(e + 8)? as usize),
                (0x0128, 3) => unit = u16_at(e + 8)?,
                _ => {}
            }
        }
        let f = match unit {
            2 => 1.0,
            3 => 2.54,
            _ => return None, // no absolute unit
        };
        match (xr, yr) {
            (Some(x), Some(y)) => Some((x * f, y * f)),
            (Some(x), None) => Some((x * f, x * f)),
            (None, Some(y)) => Some((y * f, y * f)),
            (None, None) => None,
        }
    }

    /// BMP: pixels per metre from a BITMAPINFOHEADER or later.
    pub fn bmp(b: &[u8]) -> Option<(f64, f64)> {
        if le32(b, 14)? < 40 {
            return None;
        }
        let x = le32(b, 38)? as i32;
        let y = le32(b, 42)? as i32;
        if x <= 0 && y <= 0 {
            return None;
        }
        Some((x as f64 * 0.0254, y as f64 * 0.0254))
    }

    /// WebP: an EXIF chunk, if any.
    pub fn webp(b: &[u8]) -> Option<(f64, f64)> {
        let mut i = 12;
        while i + 8 <= b.len() {
            let len = le32(b, i + 4)? as usize;
            let data = b.get(i + 8..(i + 8 + len).min(b.len()))?;
            if &b[i..i + 4] == b"EXIF" {
                let t = data.strip_prefix(b"Exif\0\0").unwrap_or(data);
                return tiff(t);
            }
            i = i.checked_add(8 + len + (len & 1))?;
        }
        None
    }
}
