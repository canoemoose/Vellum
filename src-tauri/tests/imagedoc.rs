// Image documents: page size from embedded DPI, orientation, level choice, region mapping
// and rendering. Fixture images are generated here; nothing big is committed.

use image::codecs::jpeg::{JpegEncoder, PixelDensity, PixelDensityUnit};
use image::metadata::Orientation;
use image::{ImageBuffer, ImageEncoder, Rgb, Rgba};
use vellum_lib::imagedoc::{dpi, geom, ImageDoc};

// ---------- helpers ----------

fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
        }
    }
    !c
}

fn png_chunk(ty: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut v = (data.len() as u32).to_be_bytes().to_vec();
    v.extend_from_slice(ty);
    v.extend_from_slice(data);
    let mut c = ty.to_vec();
    c.extend_from_slice(data);
    v.extend_from_slice(&crc32(&c).to_be_bytes());
    v
}

fn encode_png_rgba(w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
    let img = ImageBuffer::from_fn(w, h, |x, y| Rgba(f(x, y)));
    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new(&mut out)
        .write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgba8)
        .unwrap();
    out
}

/// Insert a pHYs chunk (pixels per metre) right after IHDR.
fn with_phys(png: &[u8], ppm_x: u32, ppm_y: u32, unit: u8) -> Vec<u8> {
    let ihdr_end = 8 + 8 + 13 + 4;
    let mut d = ppm_x.to_be_bytes().to_vec();
    d.extend_from_slice(&ppm_y.to_be_bytes());
    d.push(unit);
    let mut out = png[..ihdr_end].to_vec();
    out.extend(png_chunk(b"pHYs", &d));
    out.extend_from_slice(&png[ihdr_end..]);
    out
}

fn encode_jpeg(w: u32, h: u32, density: Option<PixelDensity>) -> Vec<u8> {
    let img = ImageBuffer::from_fn(w, h, |x, _| Rgb([if x < w / 2 { 255 } else { 0 }, 0, 0]));
    let mut out = Vec::new();
    let mut enc = JpegEncoder::new_with_quality(&mut out, 95);
    if let Some(d) = density {
        enc.set_pixel_density(d);
    }
    enc.write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgb8).unwrap();
    out
}

/// A little-endian TIFF/EXIF IFD0 with optional orientation, X/Y resolution and unit.
fn tiff_block(orientation: Option<u16>, xres: Option<(u32, u32)>, yres: Option<(u32, u32)>, unit: Option<u16>) -> Vec<u8> {
    let mut entries: Vec<(u16, u16, u32, u32)> = Vec::new();
    let n = [orientation.is_some(), xres.is_some(), yres.is_some(), unit.is_some()].iter().filter(|b| **b).count();
    let data_off = 8 + 2 + n as u32 * 12 + 4;
    let mut data = Vec::new();
    if let Some(o) = orientation {
        entries.push((0x0112, 3, 1, o as u32));
    }
    if let Some((num, den)) = xres {
        entries.push((0x011A, 5, 1, data_off + data.len() as u32));
        data.extend_from_slice(&num.to_le_bytes());
        data.extend_from_slice(&den.to_le_bytes());
    }
    if let Some((num, den)) = yres {
        entries.push((0x011B, 5, 1, data_off + data.len() as u32));
        data.extend_from_slice(&num.to_le_bytes());
        data.extend_from_slice(&den.to_le_bytes());
    }
    if let Some(u) = unit {
        entries.push((0x0128, 3, 1, u as u32));
    }
    let mut v = b"II*\0".to_vec();
    v.extend_from_slice(&8u32.to_le_bytes());
    v.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    for (tag, ty, count, val) in entries {
        v.extend_from_slice(&tag.to_le_bytes());
        v.extend_from_slice(&ty.to_le_bytes());
        v.extend_from_slice(&count.to_le_bytes());
        v.extend_from_slice(&val.to_le_bytes());
    }
    v.extend_from_slice(&0u32.to_le_bytes());
    v.extend(data);
    v
}

/// Insert an EXIF APP1 segment right after SOI.
fn with_exif(jpeg: &[u8], tiff: &[u8]) -> Vec<u8> {
    let mut seg = b"Exif\0\0".to_vec();
    seg.extend_from_slice(tiff);
    let mut out = jpeg[..2].to_vec();
    out.extend_from_slice(&[0xFF, 0xE1]);
    out.extend_from_slice(&((seg.len() + 2) as u16).to_be_bytes());
    out.extend(seg);
    out.extend_from_slice(&jpeg[2..]);
    out
}

fn near(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-6
}

/// Render the whole page at `rs` and return (w, h, pixels).
fn render_all(doc: &ImageDoc, rs: f64) -> (usize, usize, Vec<u8>) {
    let ps = doc.page_size();
    let w = (ps.w as f64 * rs).ceil() as usize;
    let h = (ps.h as f64 * rs).ceil() as usize;
    let mut buf = vec![0xFF; w * h * 4];
    doc.render_region(rs, 0, 0, w as i32, h as i32, &mut buf, w * 4).unwrap();
    (w, h, buf)
}

fn px(buf: &[u8], stride: usize, x: usize, y: usize) -> [u8; 4] {
    let o = y * stride + x * 4;
    buf[o..o + 4].try_into().unwrap()
}

// ---------- geometry ----------

#[test]
fn page_size_converts_pixels_at_dpi_to_points() {
    assert_eq!(geom::page_size_pt(960, 480, (96.0, 96.0)), (720.0, 360.0));
    assert_eq!(geom::page_size_pt(300, 600, (300.0, 150.0)), (72.0, 288.0));
}

#[test]
fn sane_dpi_rejects_junk() {
    assert!(geom::sane_dpi(72.0));
    assert!(geom::sane_dpi(2400.0));
    assert!(!geom::sane_dpi(0.0));
    assert!(!geom::sane_dpi(1.0));
    assert!(!geom::sane_dpi(f64::NAN));
    assert!(!geom::sane_dpi(1e9));
}

#[test]
fn quarter_turns_swap_axes() {
    for o in [Orientation::Rotate90, Orientation::Rotate270, Orientation::Rotate90FlipH, Orientation::Rotate270FlipH] {
        assert!(geom::swaps_axes(o), "{o:?}");
    }
    for o in [Orientation::NoTransforms, Orientation::Rotate180, Orientation::FlipHorizontal, Orientation::FlipVertical] {
        assert!(!geom::swaps_axes(o), "{o:?}");
    }
}

#[test]
fn memory_ceiling_is_120_megapixels() {
    assert!(!geom::should_halve(12_000, 10_000)); // exactly 120 MP
    assert!(geom::should_halve(12_001, 10_000));
    assert!(geom::should_halve(30_000, 30_000));
    assert_eq!(geom::halve_dims(12_001, 10_001), (6_001, 5_001));
    assert_eq!(geom::halve_dims(1, 1), (1, 1));
}

#[test]
fn quarter_level_dims_round_up_and_never_vanish() {
    assert_eq!(geom::quarter_dims(1000, 800), (250, 200));
    assert_eq!(geom::quarter_dims(1001, 3), (251, 1));
    assert_eq!(geom::quarter_dims(1, 1), (1, 1));
}

#[test]
fn quarter_level_used_only_when_it_has_enough_pixels() {
    assert!(geom::use_quarter(250, 200, 250.0, 200.0));
    assert!(geom::use_quarter(250, 200, 100.0, 80.0));
    assert!(!geom::use_quarter(250, 200, 250.5, 200.0));
    assert!(!geom::use_quarter(250, 200, 100.0, 201.0));
}

#[test]
fn fit_long_side_keeps_aspect() {
    assert_eq!(geom::fit_long_side(800.0, 400.0, 200), (200, 100));
    assert_eq!(geom::fit_long_side(400.0, 800.0, 200), (100, 200));
    assert_eq!(geom::fit_long_side(10_000.0, 1.0, 100), (100, 1));
}

#[test]
fn map_region_whole_page_maps_whole_source() {
    let m = geom::map_region(1000, 500, 200.0, 100.0, 0, 0, 200, 100).unwrap();
    assert_eq!((m.dx, m.dy, m.dw, m.dh), (0, 0, 200, 100));
    assert!(near(m.src.0, 0.0) && near(m.src.1, 0.0) && near(m.src.2, 1000.0) && near(m.src.3, 500.0));
}

#[test]
fn map_region_interior_scales_linearly() {
    // 5 source px per device px.
    let m = geom::map_region(1000, 500, 200.0, 100.0, 50, 20, 40, 30).unwrap();
    assert_eq!((m.dx, m.dy, m.dw, m.dh), (0, 0, 40, 30));
    assert!(near(m.src.0, 250.0) && near(m.src.1, 100.0) && near(m.src.2, 200.0) && near(m.src.3, 150.0));
}

#[test]
fn map_region_clips_parts_off_the_page() {
    // Starts left of and above the page.
    let m = geom::map_region(100, 100, 100.0, 100.0, -10, -5, 30, 20).unwrap();
    assert_eq!((m.dx, m.dy, m.dw, m.dh), (10, 5, 20, 15));
    assert!(near(m.src.0, 0.0) && near(m.src.1, 0.0) && near(m.src.2, 20.0) && near(m.src.3, 15.0));
    // Runs past the right and bottom edges.
    let m = geom::map_region(100, 100, 100.0, 100.0, 90, 95, 30, 30).unwrap();
    assert_eq!((m.dx, m.dy, m.dw, m.dh), (0, 0, 10, 5));
    assert!(near(m.src.0, 90.0) && near(m.src.2, 10.0) && near(m.src.3, 5.0));
}

#[test]
fn map_region_entirely_off_page_is_none() {
    assert!(geom::map_region(100, 100, 100.0, 100.0, 100, 0, 10, 10).is_none());
    assert!(geom::map_region(100, 100, 100.0, 100.0, -20, 0, 20, 10).is_none());
    assert!(geom::map_region(100, 100, 100.0, 100.0, 0, 0, 0, 10).is_none());
}

#[test]
fn map_region_partial_last_pixel_stays_inside_source() {
    // Extent 100.5 device px: the bitmap is 101 px and its last pixel is half outside.
    let m = geom::map_region(201, 201, 100.5, 100.5, 100, 100, 1, 1).unwrap();
    assert_eq!((m.dw, m.dh), (1, 1));
    assert!(m.src.0 + m.src.2 <= 201.0 + 1e-9);
    assert!(m.src.1 + m.src.3 <= 201.0 + 1e-9);
    assert!(m.src.2 > 0.0 && m.src.3 > 0.0);
}

#[test]
fn flatten_on_white_composites_alpha() {
    let mut p = vec![0, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 128, 10, 20, 30, 255];
    geom::flatten_on_white(&mut p);
    assert_eq!(&p[0..4], &[255, 255, 255, 255]);
    assert_eq!(&p[4..8], &[0, 0, 0, 255]);
    assert_eq!(&p[8..12], &[255, 127, 127, 255]);
    assert_eq!(&p[12..16], &[10, 20, 30, 255]);
}

// ---------- DPI parsing ----------

#[test]
fn png_phys_in_metres_is_read() {
    let png = with_phys(&encode_png_rgba(4, 4, |_, _| [0, 0, 0, 255]), 11811, 5906, 1);
    let (x, y) = dpi::detect(&png).unwrap();
    assert!((x - 300.0).abs() < 0.01, "{x}");
    assert!((y - 150.0).abs() < 0.02, "{y}");
}

#[test]
fn png_phys_without_unit_is_ignored() {
    let png = with_phys(&encode_png_rgba(4, 4, |_, _| [0, 0, 0, 255]), 2, 1, 0);
    assert!(dpi::detect(&png).is_none());
}

#[test]
fn png_without_phys_has_no_dpi() {
    assert!(dpi::detect(&encode_png_rgba(4, 4, |_, _| [0, 0, 0, 255])).is_none());
}

#[test]
fn jpeg_jfif_density_in_inches_and_cm() {
    let j = encode_jpeg(16, 16, Some(PixelDensity { density: (200, 100), unit: PixelDensityUnit::Inches }));
    assert_eq!(dpi::detect(&j), Some((200.0, 100.0)));
    let j = encode_jpeg(16, 16, Some(PixelDensity { density: (100, 100), unit: PixelDensityUnit::Centimeters }));
    let (x, _) = dpi::detect(&j).unwrap();
    assert!(near(x, 254.0));
}

#[test]
fn jpeg_jfif_aspect_only_is_no_dpi() {
    let j = encode_jpeg(16, 16, Some(PixelDensity { density: (1, 1), unit: PixelDensityUnit::PixelAspectRatio }));
    assert!(dpi::detect(&j).is_none());
}

#[test]
fn jpeg_exif_resolution_wins_over_jfif() {
    let j = encode_jpeg(16, 16, Some(PixelDensity { density: (72, 72), unit: PixelDensityUnit::Inches }));
    let j = with_exif(&j, &tiff_block(None, Some((600, 1)), Some((600, 1)), Some(2)));
    assert_eq!(dpi::detect(&j), Some((600.0, 600.0)));
}

#[test]
fn tiff_resolution_units() {
    assert_eq!(dpi::tiff(&tiff_block(None, Some((300, 1)), Some((150, 1)), Some(2))), Some((300.0, 150.0)));
    let (x, _) = dpi::tiff(&tiff_block(None, Some((100, 1)), None, Some(3))).unwrap();
    assert!(near(x, 254.0));
    // Unit missing means inches.
    assert_eq!(dpi::tiff(&tiff_block(None, Some((400, 1)), Some((400, 1)), None)), Some((400.0, 400.0)));
    // Unit "none" is not an absolute resolution.
    assert_eq!(dpi::tiff(&tiff_block(None, Some((400, 1)), Some((400, 1)), Some(1))), None);
    // Zero denominator.
    assert_eq!(dpi::tiff(&tiff_block(None, Some((400, 0)), None, Some(2))), None);
}

#[test]
fn bmp_pixels_per_metre() {
    let img = ImageBuffer::from_fn(4, 4, |_, _| Rgb([1u8, 2, 3]));
    let mut b = Vec::new();
    image::codecs::bmp::BmpEncoder::new(&mut b)
        .write_image(img.as_raw(), 4, 4, image::ExtendedColorType::Rgb8)
        .unwrap();
    b[38..42].copy_from_slice(&11811i32.to_le_bytes());
    b[42..46].copy_from_slice(&11811i32.to_le_bytes());
    let (x, y) = dpi::detect(&b).unwrap();
    assert!((x - 300.0).abs() < 0.01 && (y - 300.0).abs() < 0.01);
}

#[test]
fn garbage_and_truncated_headers_do_not_panic() {
    for b in [&b""[..], b"\xFF\xD8", b"\xFF\xD8\xFF\xE1\xFF\xFF", b"\x89PNG\r\n\x1a\n\0\0", b"II*\0\xFF\xFF\xFF\xFF", b"BM", b"RIFF\0\0\0\0WEBPEXIF"] {
        let _ = dpi::detect(b);
    }
}

// ---------- decode and render ----------

#[test]
fn png_opens_at_its_dpi() {
    let png = with_phys(&encode_png_rgba(300, 150, |_, _| [0, 0, 255, 255]), 11811, 11811, 1);
    let doc = ImageDoc::from_bytes(&png).unwrap();
    let ps = doc.page_size();
    assert!((ps.w - 72.0).abs() < 0.01 && (ps.h - 36.0).abs() < 0.01, "{} x {}", ps.w, ps.h);
    assert!(doc.note().is_none());
}

#[test]
fn image_without_dpi_is_96() {
    let doc = ImageDoc::from_bytes(&encode_png_rgba(96, 192, |_, _| [0, 0, 0, 255])).unwrap();
    let ps = doc.page_size();
    assert_eq!((ps.w, ps.h), (72.0, 144.0));
}

#[test]
fn exif_orientation_turns_the_image_and_its_dpi() {
    // 200 x 100, left half red; orientation 6 = rotate 90 clockwise. DPI 300 x 150.
    let j = encode_jpeg(200, 100, None);
    let j = with_exif(&j, &tiff_block(Some(6), Some((300, 1)), Some((150, 1)), Some(2)));
    let doc = ImageDoc::from_bytes(&j).unwrap();
    assert_eq!(doc.pixel_size(), (100, 200));
    let ps = doc.page_size();
    // 100 px at 150 dpi wide, 200 px at 300 dpi tall.
    assert!((ps.w - 48.0).abs() < 0.01 && (ps.h - 48.0).abs() < 0.01, "{} x {}", ps.w, ps.h);
    // After a clockwise turn the red half is on top.
    let (w, h, buf) = render_all(&doc, 100.0 / 48.0);
    let top = px(&buf, w * 4, w / 2, h / 8);
    let bottom = px(&buf, w * 4, w / 2, h * 7 / 8);
    assert!(top[0] > 200 && top[1] < 60, "top {top:?}");
    assert!(bottom[0] < 60, "bottom {bottom:?}");
}

#[test]
fn transparency_renders_on_white() {
    let png = encode_png_rgba(10, 10, |x, _| if x < 5 { [0, 0, 0, 0] } else { [0, 0, 0, 255] });
    let doc = ImageDoc::from_bytes(&png).unwrap();
    let (w, _, buf) = render_all(&doc, 1.0 / 0.75); // 96 dpi: 1 px = 0.75 pt
    assert_eq!(px(&buf, w * 4, 1, 5), [255, 255, 255, 255]);
    assert_eq!(px(&buf, w * 4, 8, 5), [0, 0, 0, 255]);
}

#[test]
fn sixteen_bit_png_decodes() {
    let img: ImageBuffer<Rgb<u16>, Vec<u16>> = ImageBuffer::from_fn(8, 8, |_, _| Rgb([65535, 0, 32768]));
    let mut out = Vec::new();
    let bytes: Vec<u8> = img.as_raw().iter().flat_map(|v| v.to_ne_bytes()).collect();
    image::codecs::png::PngEncoder::new(&mut out)
        .write_image(&bytes, 8, 8, image::ExtendedColorType::Rgb16)
        .unwrap();
    let doc = ImageDoc::from_bytes(&out).unwrap();
    let (w, _, buf) = render_all(&doc, 1.0 / 0.75);
    let p = px(&buf, w * 4, 4, 4);
    assert_eq!(p[0], 255);
    assert_eq!(p[1], 0);
    assert!((127..=129).contains(&p[2]), "{p:?}");
}

#[test]
fn gif_and_tiff_and_bmp_and_webp_open() {
    let rgba = ImageBuffer::from_fn(16, 8, |_, _| Rgba([0u8, 128, 0, 255]));
    let rgb = ImageBuffer::from_fn(16, 8, |_, _| Rgb([0u8, 128, 0]));
    let mut outs: Vec<(&str, Vec<u8>)> = Vec::new();
    let mut g = Vec::new();
    image::codecs::gif::GifEncoder::new(&mut g).encode(rgba.as_raw(), 16, 8, image::ExtendedColorType::Rgba8).unwrap();
    outs.push(("gif", g));
    let mut t = std::io::Cursor::new(Vec::new());
    image::codecs::tiff::TiffEncoder::new(&mut t).write_image(rgb.as_raw(), 16, 8, image::ExtendedColorType::Rgb8).unwrap();
    outs.push(("tiff", t.into_inner()));
    let mut b = Vec::new();
    image::codecs::bmp::BmpEncoder::new(&mut b).write_image(rgb.as_raw(), 16, 8, image::ExtendedColorType::Rgb8).unwrap();
    outs.push(("bmp", b));
    let mut w = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut w).write_image(rgba.as_raw(), 16, 8, image::ExtendedColorType::Rgba8).unwrap();
    outs.push(("webp", w));
    for (name, bytes) in outs {
        let doc = ImageDoc::from_bytes(&bytes).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(doc.pixel_size(), (16, 8), "{name}");
        let (w, _, buf) = render_all(&doc, 1.0 / 0.75);
        let p = px(&buf, w * 4, 8, 4);
        assert!(p[0] < 20 && (110..=140).contains(&p[1]) && p[2] < 20, "{name}: {p:?}");
    }
}

#[test]
fn not_an_image_is_refused_clearly() {
    let e = ImageDoc::from_bytes(b"hello, this is not an image at all").err().unwrap();
    assert_eq!(e, "Not a PDF or supported image");
    let mut png = encode_png_rgba(64, 64, |x, y| [x as u8, y as u8, 0, 255]);
    png.truncate(png.len() / 2);
    let e = ImageDoc::from_bytes(&png).err().unwrap();
    assert!(!e.is_empty());
}

#[test]
fn region_render_matches_whole_render() {
    // A gradient so misplacement shows. Render a region and compare it with the same
    // pixels of a whole-page render at the same scale.
    let png = encode_png_rgba(400, 300, |x, y| [(x * 255 / 399) as u8, (y * 255 / 299) as u8, 0, 255]);
    let doc = ImageDoc::from_bytes(&png).unwrap();
    let rs = 2.0 / 0.75; // 2 device px per image px: upscaled, full level
    let (w, _, all) = render_all(&doc, rs);
    let (rx, ry, rw, rh) = (300i64, 250i64, 64i32, 48i32);
    let mut reg = vec![0xFF; rw as usize * rh as usize * 4];
    doc.render_region(rs, rx, ry, rw, rh, &mut reg, rw as usize * 4).unwrap();
    for (x, y) in [(0usize, 0usize), (63, 0), (0, 47), (63, 47), (32, 24)] {
        let a = px(&reg, rw as usize * 4, x, y);
        let b = px(&all, w * 4, rx as usize + x, ry as usize + y);
        for c in 0..3 {
            assert!((a[c] as i32 - b[c] as i32).abs() <= 3, "at {x},{y}: {a:?} vs {b:?}");
        }
    }
}

#[test]
fn region_off_the_page_stays_white_and_strided_rows_are_respected() {
    let doc = ImageDoc::from_bytes(&encode_png_rgba(40, 40, |_, _| [0, 0, 0, 255])).unwrap();
    let rs = 1.0 / 0.75;
    // Region straddles the right edge; stride wider than the region.
    let (w, h, stride) = (20usize, 10usize, 32 * 4);
    let mut buf = vec![0xAB; stride * h];
    for r in 0..h {
        buf[r * stride..r * stride + w * 4].fill(0xFF);
    }
    doc.render_region(rs, 30, 5, w as i32, h as i32, &mut buf, stride).unwrap();
    assert_eq!(px(&buf, stride, 2, 2), [0, 0, 0, 255]); // on the page
    assert_eq!(px(&buf, stride, 15, 2), [255, 255, 255, 255]); // past the edge
    assert_eq!(buf[3 * stride + w * 4], 0xAB); // padding untouched
}

#[test]
fn downscaled_render_uses_quarter_level_and_stays_correct() {
    let png = encode_png_rgba(800, 400, |x, _| if x < 400 { [255, 0, 0, 255] } else { [0, 0, 255, 255] });
    let doc = ImageDoc::from_bytes(&png).unwrap();
    let rs = 100.0 / 600.0; // page 600 pt wide -> 100 px, under the 200 px quarter level
    let (w, h, buf) = render_all(&doc, rs);
    assert_eq!((w, h), (100, 50));
    assert!(px(&buf, w * 4, 10, 25)[0] > 240);
    assert!(px(&buf, w * 4, 90, 25)[2] > 240);
}

#[test]
fn thumbnail_fits_long_side() {
    let doc = ImageDoc::from_bytes(&encode_png_rgba(800, 400, |_, _| [0, 0, 0, 255])).unwrap();
    let (w, h, px) = doc.thumbnail(132).unwrap();
    assert_eq!((w, h), (132, 66));
    assert_eq!(px.len(), 132 * 66 * 4);
}

#[test]
fn image_doc_is_send_and_sync() {
    fn check<T: Send + Sync>() {}
    check::<ImageDoc>();
}

// ---------- manual fixtures ----------

/// Writes a set of test images for running the app by hand:
/// `VELLUM_FIXTURE_DIR=run/images cargo test --test imagedoc -- --ignored write_fixture_images`
#[test]
#[ignore]
fn write_fixture_images() {
    let dir = std::path::PathBuf::from(std::env::var("VELLUM_FIXTURE_DIR").expect("set VELLUM_FIXTURE_DIR"));
    std::fs::create_dir_all(&dir).unwrap();
    let grid = |x: u32, y: u32| -> [u8; 3] {
        if x % 200 < 4 || y % 200 < 4 { [20, 20, 20] } else { [(x / 16 % 256) as u8, (y / 16 % 256) as u8, 160] }
    };

    // A "phone photo": 4000 x 3000, EXIF orientation 6 (rotate 90 clockwise), 300 dpi.
    // Opens 3000 x 4000 px = 10 x 13.33 in = 720 x 960 pt, red bar on the right after turning.
    let img = ImageBuffer::from_fn(4000, 3000, |x, y| if y < 300 { Rgb([220, 30, 30]) } else { Rgb(grid(x, y)) });
    let mut j = Vec::new();
    JpegEncoder::new_with_quality(&mut j, 85).write_image(img.as_raw(), 4000, 3000, image::ExtendedColorType::Rgb8).unwrap();
    let j = with_exif(&j, &tiff_block(Some(6), Some((300, 1)), Some((300, 1)), Some(2)));
    std::fs::write(dir.join("photo-exif-rot6-300dpi.jpg"), j).unwrap();

    // 16-bit PNG, 2000 x 1500, 200 dpi (pHYs).
    let img: ImageBuffer<Rgb<u16>, Vec<u16>> =
        ImageBuffer::from_fn(2000, 1500, |x, y| Rgb([(x * 32) as u16, (y * 43) as u16, 30000]));
    let bytes: Vec<u8> = img.as_raw().iter().flat_map(|v| v.to_ne_bytes()).collect();
    let mut p = Vec::new();
    image::codecs::png::PngEncoder::new(&mut p).write_image(&bytes, 2000, 1500, image::ExtendedColorType::Rgb16).unwrap();
    std::fs::write(dir.join("deep-16bit-200dpi.png"), with_phys(&p, 7874, 7874, 1)).unwrap();

    // Transparent PNG (should sit on white).
    std::fs::write(
        dir.join("transparent.png"),
        encode_png_rgba(800, 600, |x, y| if (x / 100 + y / 100) % 2 == 0 { [0, 90, 200, 255] } else { [0, 0, 0, 0] }),
    )
    .unwrap();

    // Animated GIF: first frame red, second blue. Should open red.
    let mut g = Vec::new();
    {
        let mut enc = image::codecs::gif::GifEncoder::new(&mut g);
        for c in [[220u8, 30, 30, 255], [30, 30, 220, 255]] {
            let f = image::RgbaImage::from_pixel(400, 300, Rgba(c));
            enc.encode_frame(image::Frame::new(f)).unwrap();
        }
    }
    std::fs::write(dir.join("animated-first-red.gif"), g).unwrap();

    // TIFF and BMP and WebP.
    let img = ImageBuffer::from_fn(1200, 900, |x, y| Rgb(grid(x, y)));
    let mut t = std::io::Cursor::new(Vec::new());
    image::codecs::tiff::TiffEncoder::new(&mut t).write_image(img.as_raw(), 1200, 900, image::ExtendedColorType::Rgb8).unwrap();
    std::fs::write(dir.join("scan.tif"), t.into_inner()).unwrap();
    let mut b = Vec::new();
    image::codecs::bmp::BmpEncoder::new(&mut b).write_image(img.as_raw(), 1200, 900, image::ExtendedColorType::Rgb8).unwrap();
    std::fs::write(dir.join("plain.bmp"), b).unwrap();
    let rgba = ImageBuffer::from_fn(1200, 900, |x, y| { let c = grid(x, y); Rgba([c[0], c[1], c[2], 255]) });
    let mut w = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut w).write_image(rgba.as_raw(), 1200, 900, image::ExtendedColorType::Rgba8).unwrap();
    std::fs::write(dir.join("plain.webp"), w).unwrap();

    // Over the memory ceiling: 13000 x 10000 = 130 MP (opens at half resolution with a note).
    let img = ImageBuffer::from_fn(13000, 10000, |x, y| Rgb(grid(x, y)));
    let mut j = Vec::new();
    JpegEncoder::new_with_quality(&mut j, 80).write_image(img.as_raw(), 13000, 10000, image::ExtendedColorType::Rgb8).unwrap();
    std::fs::write(dir.join("huge-130mp.jpg"), j).unwrap();

    // Not an image, with an image extension.
    std::fs::write(dir.join("not-really.png"), b"this is text pretending to be a PNG").unwrap();
}
