//! Huge JPEGs are decoded by us and swapped into PDFium (docs/bayou-image-scope.md): the
//! swapped page renders the right colours the right way up, with and without an ICC profile.

mod print_common;

use image::codecs::jpeg::JpegEncoder;
use image::{ImageBuffer, ImageEncoder, Rgb};
use print_common::*;
use std::sync::atomic::Ordering;
use vellum_lib::pdfium::RegionArgs;
use vellum_lib::pdfium_lod::{HUGE_IMAGE_PIXELS, HUGE_SWAPS};

const W: u32 = 4096;
const H: u32 = 4000;
// Quadrants: top left red, top right blue, bottom left green, bottom right grey.
const TL: [u8; 3] = [220, 40, 40];
const TR: [u8; 3] = [40, 60, 210];
const BL: [u8; 3] = [50, 190, 60];
const BR: [u8; 3] = [128, 128, 128];

fn quadrant_jpeg() -> Vec<u8> {
    let img = ImageBuffer::from_fn(W, H, |x, y| {
        Rgb(match (x < W / 2, y < H / 2) {
            (true, true) => TL,
            (false, true) => TR,
            (true, false) => BL,
            (false, false) => BR,
        })
    });
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, 90).write_image(img.as_raw(), W, H, image::ExtendedColorType::Rgb8).unwrap();
    out
}

/// A two-page PDF, each page one full-page JPEG: page 1 ICC-based (an sRGB profile), page 2
/// DeviceRGB. Written by hand so the image stays a DCTDecode stream.
fn make_jpeg_pdf(jpeg: &[u8], icc: &[u8], pw: f64, ph: f64) -> Vec<u8> {
    let content = format!("q {pw} 0 0 {ph} 0 0 cm /Im0 Do Q\n");
    let mut objs: Vec<Vec<u8>> = Vec::new();
    let stream = |dict: String, data: &[u8]| {
        let mut o = format!("<<{dict}/Length {}>>\nstream\n", data.len()).into_bytes();
        o.extend_from_slice(data);
        o.extend_from_slice(b"\nendstream");
        o
    };
    let page = |contents: usize, image: usize| {
        format!("<</Type/Page/Parent 2 0 R/MediaBox[0 0 {pw} {ph}]/Resources<</XObject<</Im0 {image} 0 R>>>>/Contents {contents} 0 R>>").into_bytes()
    };
    let img_dict = |cs: &str| format!("/Type/XObject/Subtype/Image/Width {W}/Height {H}/ColorSpace {cs}/BitsPerComponent 8/Filter/DCTDecode");
    objs.push(b"<</Type/Catalog/Pages 2 0 R>>".to_vec()); // 1
    objs.push(b"<</Type/Pages/Kids[3 0 R 6 0 R]/Count 2>>".to_vec()); // 2
    objs.push(page(4, 5)); // 3
    objs.push(stream(String::new(), content.as_bytes())); // 4
    objs.push(stream(img_dict("[/ICCBased 9 0 R]"), jpeg)); // 5
    objs.push(page(7, 8)); // 6
    objs.push(stream(String::new(), content.as_bytes())); // 7
    objs.push(stream(img_dict("/DeviceRGB"), jpeg)); // 8
    objs.push(stream("/N 3".into(), icc)); // 9
    let mut out = b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::new();
    for (i, o) in objs.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        out.extend_from_slice(o);
        out.extend_from_slice(b"\nendobj\n");
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
    for off in offsets {
        out.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(format!("trailer\n<</Size {}/Root 1 0 R>>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1).as_bytes());
    out
}

/// RGB at (x, y) in an RGBA region buffer w pixels wide.
fn rgb_at(buf: &[u8], w: i32, x: i32, y: i32) -> [u8; 3] {
    let i = ((y * w + x) * 4) as usize;
    [buf[i], buf[i + 1], buf[i + 2]]
}

fn assert_close(got: [u8; 3], want: [u8; 3], what: &str) {
    let off = got.iter().zip(want).map(|(&g, w)| (g as i32 - w as i32).abs()).max().unwrap();
    assert!(off <= 12, "{what}: got {got:?}, want {want:?}");
}

#[test]
fn huge_jpeg_pages_render_from_our_decode_with_and_without_a_profile() {
    assert!((W as u64 * H as u64) >= HUGE_IMAGE_PIXELS, "fixture must count as huge");
    let (pw, ph) = (400.0, 390.625); // keeps the image's aspect ratio
    let icc = moxcms::ColorProfile::new_srgb().encode().unwrap();
    let (doc, _) = open_fixture("huge-jpeg", &make_jpeg_pdf(&quadrant_jpeg(), &icc, pw, ph));
    let before = HUGE_SWAPS.load(Ordering::Relaxed);
    for page in [0usize, 1] {
        // The whole page at 1 px per point, then a zoomed-in region from the middle.
        let (w, h) = (400, 390);
        let buf = pdfium().render(doc, RegionArgs { id: 0, page, rs: 1.0, x: 0, y: 0, w, h }).unwrap().unwrap();
        let what = |q: &str| format!("page {} {q}", page + 1);
        assert_close(rgb_at(&buf, w, 100, 100), TL, &what("top left"));
        assert_close(rgb_at(&buf, w, 300, 100), TR, &what("top right"));
        assert_close(rgb_at(&buf, w, 100, 290), BL, &what("bottom left"));
        assert_close(rgb_at(&buf, w, 300, 290), BR, &what("bottom right"));
        // 8x: a 200 x 200 region straddling the centre shows all four quadrants.
        let rs = 8.0;
        let (cx, cy) = ((pw * rs / 2.0) as i64, (ph * rs / 2.0) as i64);
        let buf = pdfium().render(doc, RegionArgs { id: 0, page, rs, x: cx - 100, y: cy - 100, w: 200, h: 200 }).unwrap().unwrap();
        assert_close(rgb_at(&buf, 200, 50, 50), TL, &what("8x top left"));
        assert_close(rgb_at(&buf, 200, 150, 150), BR, &what("8x bottom right"));
    }
    assert!(HUGE_SWAPS.load(Ordering::Relaxed) >= before + 2, "both pages took the swap");
}
