//! Images in appearance streams (annot/image.rs): a PNG with transparency becomes an image
//! XObject with a soft mask, checked by rendering through PDFium and sampling pixels (ink
//! opaque, clear parts showing the page beneath); one image placed three times is written once.
//! The PNGs are synthetic, made here.

mod print_common;

use print_common::*;
use std::sync::Arc;
use vellum_lib::annot::image::{IMAGE_HASH_KEY, ImageRes, base64_decode};
use vellum_lib::annot::spec::Appearance;
use vellum_lib::annot::{self, AnnotSpec, Change};

fn base64(b: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::new();
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() {
                s.push(T[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                s.push('=');
            }
        }
    }
    s
}

/// 60 x 20 pixels: clear, with an opaque blue bar across the middle (rows 7..13) and a
/// half-clear blue square at the right end of the top rows (`opaque`: white paper, no square).
fn signature_png(opaque: bool) -> Vec<u8> {
    let mut img = image::RgbaImage::new(60, 20);
    for (x, y, p) in img.enumerate_pixels_mut() {
        *p = if (7..13).contains(&y) {
            image::Rgba([0, 0, 255, 255])
        } else if x >= 50 && y < 5 && !opaque {
            image::Rgba([0, 0, 255, 128])
        } else if opaque {
            image::Rgba([255, 255, 255, 255])
        } else {
            image::Rgba([255, 255, 255, 0])
        };
    }
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

/// A Stamp annotation drawing the image over `r` (user space).
fn image_stamp(nm: &str, r: [f64; 4], png: &[u8], hash: &str) -> AnnotSpec {
    let mut images = std::collections::BTreeMap::new();
    images.insert("Im0".to_string(), ImageRes { hash: hash.into(), png: base64(png) });
    AnnotSpec {
        page: 0,
        nm: nm.into(),
        subtype: "Stamp".into(),
        rect: r,
        appearance: Appearance {
            ops: format!("q {} 0 0 {} {} {} cm /Im0 Do Q", r[2] - r[0], r[3] - r[1], r[0], r[1]),
            bbox: r,
            images,
            ..Default::default()
        },
        ..Default::default()
    }
}

const PPP: f64 = 4.0;

/// Pixel (BGR) at user-space point (x, y) on a 300 x 200 page.
fn sample(px: &[u8], x: f64, y: f64) -> [u8; 3] {
    let w = (300.0 * PPP) as usize;
    let (cx, cy) = ((x * PPP) as usize, ((200.0 - y) * PPP) as usize);
    let i = (cy * w + cx) * 4;
    [px[i], px[i + 1], px[i + 2]]
}

#[test]
fn base64_reads_back() {
    for s in [&b""[..], b"a", b"ab", b"abc", b"abcd", &[0u8, 255, 128, 7, 9]] {
        assert_eq!(base64_decode(&base64(s)).unwrap(), s);
    }
    assert!(base64_decode("not*base64").is_none());
}

#[test]
fn a_clear_png_becomes_an_image_with_a_soft_mask() {
    // A black block under the stamp's left half (user space x 100..130, y 50..90).
    let orig = make_pdf(vec![page(300.0, 200.0, &[(100.0, 50.0, 130.0, 90.0)])]);
    let png = signature_png(false);
    // 60 x 20 px over 60 x 20 pt at (100, 60): 1 pt per pixel. Image row y is 80 - y in user space.
    let out = annot::apply(orig, "", &[Change::Add { spec: image_stamp("s", [100.0, 60.0, 160.0, 80.0], &png, "ab12") }]).unwrap();
    // Rendered with annotations on, as Vellum shows a saved file.
    let r = vellum_lib::print::raster::SheetRenderer::open(pdfium(), Arc::new(out.clone())).unwrap();
    let px_a = r.render_band(0, 1200, 800, 0, 0, 1200, 800, 0x01).unwrap();
    // The bar (image rows 7..13 = user y 67..73) is opaque blue over both black and white.
    assert_eq!(sample(&px_a, 115.0, 70.0), [255, 0, 0], "bar over the black block");
    assert_eq!(sample(&px_a, 145.0, 70.0), [255, 0, 0], "bar over white paper");
    // The clear parts show the page: black where the block is, white beyond it.
    assert_eq!(sample(&px_a, 115.0, 62.0), [0, 0, 0], "clear over the block");
    assert_eq!(sample(&px_a, 145.0, 62.0), [255, 255, 255], "clear over paper");
    // Half clear: blue blended with white (rows 0..5 = user y 75..80, columns 50.. = x 150..).
    let half = sample(&px_a, 155.0, 78.0);
    assert!(half[0] > 240 && (100..160).contains(&half[2]), "half-clear pixel {half:?}");

    // In the file: the image has an /SMask and the private hash.
    let doc = lopdf::Document::load_mem(&out).unwrap();
    let imgs: Vec<_> = doc.objects.values().filter_map(|o| o.as_stream().ok()).filter(|s| s.dict.has(IMAGE_HASH_KEY.as_bytes())).collect();
    assert_eq!(imgs.len(), 1);
    let smask = imgs[0].dict.get(b"SMask").unwrap().as_reference().unwrap();
    let m = doc.get_object(smask).unwrap().as_stream().unwrap();
    assert_eq!(m.dict.get(b"ColorSpace").unwrap().as_name().unwrap(), b"DeviceGray");
    assert_eq!(imgs[0].dict.get(b"Width").unwrap().as_i64().unwrap(), 60);
}

#[test]
fn an_opaque_png_has_no_mask() {
    let out = annot::apply(make_pdf(vec![page(300.0, 200.0, &[])]), "", &[Change::Add { spec: image_stamp("s", [100.0, 60.0, 160.0, 80.0], &signature_png(true), "cd34") }]).unwrap();
    let doc = lopdf::Document::load_mem(&out).unwrap();
    let img = doc.objects.values().filter_map(|o| o.as_stream().ok()).find(|s| s.dict.has(IMAGE_HASH_KEY.as_bytes())).unwrap();
    assert!(!img.dict.has(b"SMask"));
}

#[test]
fn one_image_placed_three_times_is_written_once() {
    let png = signature_png(false);
    let orig = make_pdf(vec![page(300.0, 200.0, &[])]);
    let changes: Vec<Change> = (0..3).map(|i| Change::Add { spec: image_stamp(&format!("s{i}"), [20.0 + 90.0 * i as f64, 60.0, 80.0 + 90.0 * i as f64, 80.0], &png, "ABCDEF01") }).collect();
    let out = annot::apply(orig.clone(), "", &changes).unwrap();
    let doc = lopdf::Document::load_mem(&out).unwrap();
    let imgs = doc.objects.values().filter_map(|o| o.as_stream().ok()).filter(|s| s.dict.has(IMAGE_HASH_KEY.as_bytes())).count();
    let masks = doc.objects.values().filter_map(|o| o.as_stream().ok()).filter(|s| s.dict.get(b"ColorSpace").ok().and_then(|c| c.as_name().ok()) == Some(b"DeviceGray")).count();
    assert_eq!((imgs, masks), (1, 1));
    // And the update grew by about one image, not three.
    let one = annot::apply(orig.clone(), "", &changes[..1]).unwrap();
    assert!(out.len() - orig.len() < (one.len() - orig.len()) * 2, "{} vs {}", out.len() - orig.len(), one.len() - orig.len());
    // All three drawn.
    let r = vellum_lib::print::raster::SheetRenderer::open(pdfium(), Arc::new(out)).unwrap();
    let px = r.render_band(0, 1200, 800, 0, 0, 1200, 800, 0x01).unwrap();
    for i in 0..3 {
        assert_eq!(sample(&px, 50.0 + 90.0 * i as f64, 70.0), [255, 0, 0], "stamp {i}");
    }
}

#[test]
fn a_baked_image_draws_the_same_as_the_annotation() {
    let png = signature_png(false);
    let orig = make_pdf(vec![page(300.0, 200.0, &[(100.0, 50.0, 130.0, 90.0)])]);
    let spec = image_stamp("s", [100.0, 60.0, 160.0, 80.0], &png, "ab12");
    let movable = annot::apply(orig.clone(), "", &[Change::Add { spec: spec.clone() }]).unwrap();
    let baked = annot::apply(orig, "", &[Change::Bake { spec }]).unwrap();
    let ra = vellum_lib::print::raster::SheetRenderer::open(pdfium(), Arc::new(movable)).unwrap();
    let rb = vellum_lib::print::raster::SheetRenderer::open(pdfium(), Arc::new(baked)).unwrap();
    let a = ra.render_band(0, 1200, 800, 0, 0, 1200, 800, 0x01).unwrap();
    let b = rb.render_band(0, 1200, 800, 0, 0, 1200, 800, 0).unwrap();
    let differ = a.chunks(4).zip(b.chunks(4)).filter(|(p, q)| p[..3].iter().zip(&q[..3]).any(|(x, y)| x.abs_diff(*y) > 2)).count();
    assert!(differ < 20, "{differ} pixels differ");
}

#[test]
fn bad_images_say_so() {
    let orig = make_pdf(vec![page(300.0, 200.0, &[])]);
    let mut spec = image_stamp("s", [100.0, 60.0, 160.0, 80.0], b"not a png", "ab12");
    let e = annot::apply(orig.clone(), "", &[Change::Add { spec: spec.clone() }]).unwrap_err();
    assert!(e.starts_with("[stamp_image]"), "{e}");
    spec.appearance.images.get_mut("Im0").unwrap().hash = "../x".into();
    assert!(annot::apply(orig, "", &[Change::Add { spec }]).unwrap_err().starts_with("[stamp_image]"));
}
