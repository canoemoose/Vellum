//! Image swaps (src/pdfium_swap.rs, docs/bayou-image-scope.md): the decisions, our decode and
//! colour conversion, and swapped pages rendering right from both sources.

mod print_common;

use image::codecs::jpeg::JpegEncoder;
use image::{ImageBuffer, ImageEncoder, Luma, Rgb};
use print_common::*;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use vellum_lib::pdfium::RegionArgs;
use vellum_lib::pdfium_swap::*;

// ---------- fixtures ----------

fn rgb_info(w: u32, h: u32) -> ImageInfo {
    ImageInfo { w, h, bpp: 24, colorspace: 2, filters: vec!["DCTDecode".into()], ..Default::default() }
}

/// A minimal v2 RGB input profile whose conversion is a lookup table (lut16, 2 x 2 x 2 grid,
/// linear sRGB primaries to XYZ): what makes PDFium slow, small enough to build in a test.
fn lut_profile() -> Vec<u8> {
    fn s15(v: f64) -> [u8; 4] {
        ((v * 65536.0).round() as i32).to_be_bytes()
    }
    fn xyz_tag(x: f64, y: f64, z: f64) -> Vec<u8> {
        let mut t = b"XYZ \0\0\0\0".to_vec();
        for v in [x, y, z] {
            t.extend_from_slice(&s15(v));
        }
        t
    }
    let mut desc = b"desc\0\0\0\0".to_vec();
    desc.extend_from_slice(&5u32.to_be_bytes());
    desc.extend_from_slice(b"test\0");
    desc.extend_from_slice(&[0; 4 + 4 + 2 + 1 + 67]);
    while desc.len() % 4 != 0 {
        desc.push(0);
    }
    let mut lut = b"mft2\0\0\0\0".to_vec();
    lut.extend_from_slice(&[3, 3, 2, 0]);
    for (k, _) in (0..9).zip(0..) {
        lut.extend_from_slice(&s15(if k % 4 == 0 { 1.0 } else { 0.0 }));
    }
    lut.extend_from_slice(&2u16.to_be_bytes());
    lut.extend_from_slice(&2u16.to_be_bytes());
    for _ in 0..3 {
        lut.extend_from_slice(&0u16.to_be_bytes());
        lut.extend_from_slice(&65535u16.to_be_bytes());
    }
    // Corners, first channel slowest: XYZ = r*R + g*G + b*B (D50 sRGB primaries), as
    // lut16 PCS XYZ where 1.0 is 0x8000.
    let prim = [[0.4361, 0.2225, 0.0139], [0.3851, 0.7169, 0.0971], [0.1431, 0.0606, 0.7141]];
    for r in 0..2 {
        for g in 0..2 {
            for b in 0..2 {
                for c in 0..3 {
                    let v = r as f64 * prim[0][c] + g as f64 * prim[1][c] + b as f64 * prim[2][c];
                    lut.extend_from_slice(&((v * 32768.0).round() as u16).to_be_bytes());
                }
            }
        }
    }
    for _ in 0..3 {
        lut.extend_from_slice(&0u16.to_be_bytes());
        lut.extend_from_slice(&65535u16.to_be_bytes());
    }
    while lut.len() % 4 != 0 {
        lut.push(0);
    }
    let tags: Vec<(&[u8; 4], Vec<u8>)> = vec![(b"desc", desc), (b"wtpt", xyz_tag(0.9642, 1.0, 0.8249)), (b"A2B0", lut)];
    let table_len = 4 + tags.len() * 12;
    let mut offset = 128 + table_len;
    let mut table = (tags.len() as u32).to_be_bytes().to_vec();
    let mut data = Vec::new();
    for (sig, t) in &tags {
        table.extend_from_slice(*sig);
        table.extend_from_slice(&(offset as u32).to_be_bytes());
        table.extend_from_slice(&(t.len() as u32).to_be_bytes());
        data.extend_from_slice(t);
        offset += t.len();
    }
    let size = 128 + table_len + data.len();
    let mut h = vec![0u8; 128];
    h[0..4].copy_from_slice(&(size as u32).to_be_bytes());
    h[8..12].copy_from_slice(&[2, 0x10, 0, 0]);
    h[12..16].copy_from_slice(b"scnr");
    h[16..20].copy_from_slice(b"RGB ");
    h[20..24].copy_from_slice(b"XYZ ");
    h[36..40].copy_from_slice(b"acsp");
    h[68..72].copy_from_slice(&s15(0.9642));
    h[72..76].copy_from_slice(&s15(1.0));
    h[76..80].copy_from_slice(&s15(0.8249));
    let mut out = h;
    out.extend_from_slice(&table);
    out.extend_from_slice(&data);
    out
}

// Quadrants: top left red, top right blue, bottom left green, bottom right grey.
const TL: [u8; 3] = [220, 40, 40];
const TR: [u8; 3] = [40, 60, 210];
const BL: [u8; 3] = [50, 190, 60];
const BR: [u8; 3] = [128, 128, 128];

fn quadrants(w: u32, h: u32) -> Vec<u8> {
    ImageBuffer::from_fn(w, h, |x, y| {
        Rgb(match (x < w / 2, y < h / 2) {
            (true, true) => TL,
            (false, true) => TR,
            (true, false) => BL,
            (false, false) => BR,
        })
    })
    .into_raw()
}

fn jpeg(rgb: &[u8], w: u32, h: u32) -> Vec<u8> {
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, 92).write_image(rgb, w, h, image::ExtendedColorType::Rgb8).unwrap();
    out
}

/// One fixture page: a single image filling the page, optionally inside a form XObject.
struct Pg {
    w: u32,
    h: u32,
    data: Vec<u8>,
    /// e.g. "/Filter/DCTDecode", or "" for raw samples.
    filter: &'static str,
    /// e.g. "/DeviceRGB"; ignored when `icc` is given.
    colour: &'static str,
    icc: Option<Vec<u8>>,
    in_form: bool,
}

/// Write the PDF by hand so images keep their own streams (JPEG stays DCTDecode).
fn make(pages: &[Pg], pw: f64, ph: f64) -> Vec<u8> {
    let mut objs: Vec<Vec<u8>> = vec![Vec::new(), Vec::new()]; // catalog, pages: filled below
    let stream = |dict: String, data: &[u8]| {
        let mut o = format!("<<{dict}/Length {}>>\nstream\n", data.len()).into_bytes();
        o.extend_from_slice(data);
        o.extend_from_slice(b"\nendstream");
        o
    };
    let mut kids = Vec::new();
    for p in pages {
        let img_id = objs.len() + 1;
        let cs = match &p.icc {
            Some(_) => format!("[/ICCBased {} 0 R]", img_id + 1),
            None => p.colour.to_string(),
        };
        objs.push(stream(format!("/Type/XObject/Subtype/Image/Width {}/Height {}/ColorSpace {cs}/BitsPerComponent 8{}", p.w, p.h, p.filter), &p.data));
        if let Some(icc) = &p.icc {
            objs.push(stream("/N 3".into(), icc));
        }
        let draw = format!("q {pw} 0 0 {ph} 0 0 cm /Im0 Do Q\n");
        let (res, content) = if p.in_form {
            let form_id = objs.len() + 1;
            objs.push(stream(format!("/Type/XObject/Subtype/Form/BBox[0 0 {pw} {ph}]/Resources<</XObject<</Im0 {img_id} 0 R>>>>"), draw.as_bytes()));
            (format!("/XObject<</Fm0 {form_id} 0 R>>"), "/Fm0 Do\n".to_string())
        } else {
            (format!("/XObject<</Im0 {img_id} 0 R>>"), draw)
        };
        let content_id = objs.len() + 1;
        objs.push(stream(String::new(), content.as_bytes()));
        kids.push(objs.len() + 1);
        objs.push(format!("<</Type/Page/Parent 2 0 R/MediaBox[0 0 {pw} {ph}]/Resources<<{res}>>/Contents {content_id} 0 R>>").into_bytes());
    }
    objs[0] = b"<</Type/Catalog/Pages 2 0 R>>".to_vec();
    let k: Vec<String> = kids.iter().map(|k| format!("{k} 0 R")).collect();
    objs[1] = format!("<</Type/Pages/Kids[{}]/Count {}>>", k.join(" "), kids.len()).into_bytes();
    let mut out = b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offs = Vec::new();
    for (i, o) in objs.iter().enumerate() {
        offs.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        out.extend_from_slice(o);
        out.extend_from_slice(b"\nendobj\n");
    }
    let x = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
    for o in offs {
        out.extend_from_slice(format!("{o:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(format!("trailer\n<</Size {}/Root 1 0 R>>\nstartxref\n{x}\n%%EOF\n", objs.len() + 1).as_bytes());
    out
}

fn rgb_at(buf: &[u8], w: i64, x: i64, y: i64) -> [u8; 3] {
    let i = ((y * w + x) * 4) as usize;
    [buf[i], buf[i + 1], buf[i + 2]]
}

fn assert_close(got: [u8; 3], want: [u8; 3], tol: i32, what: &str) {
    let off = got.iter().zip(want).map(|(&g, w)| (g as i32 - w as i32).abs()).max().unwrap();
    assert!(off <= tol, "{what}: got {got:?}, want {want:?}");
}

/// Check all four quadrants at fit and the centre at 8x.
fn check_quadrants(doc: u64, page: usize, pw: f64, ph: f64, what: &str) {
    let (w, h) = (pw as i64, ph as i64);
    let buf = pdfium().render(doc, RegionArgs { id: 0, page, rs: 1.0, x: 0, y: 0, w: w as i32, h: h as i32 }).unwrap().unwrap();
    assert_close(rgb_at(&buf, w, w / 4, h / 4), TL, 12, &format!("{what} top left"));
    assert_close(rgb_at(&buf, w, 3 * w / 4, h / 4), TR, 12, &format!("{what} top right"));
    assert_close(rgb_at(&buf, w, w / 4, 3 * h / 4), BL, 12, &format!("{what} bottom left"));
    assert_close(rgb_at(&buf, w, 3 * w / 4, 3 * h / 4), BR, 12, &format!("{what} bottom right"));
    let rs = 8.0;
    let (cx, cy) = ((pw * rs / 2.0) as i64, (ph * rs / 2.0) as i64);
    let buf = pdfium().render(doc, RegionArgs { id: 0, page, rs, x: cx - 100, y: cy - 100, w: 200, h: 200 }).unwrap().unwrap();
    assert_close(rgb_at(&buf, 200, 50, 50), TL, 12, &format!("{what} 8x top left"));
    assert_close(rgb_at(&buf, 200, 150, 150), BR, 12, &format!("{what} 8x bottom right"));
}

// ---------- decisions ----------

#[test]
fn swaps_what_pdfium_never_keeps_and_table_profiles() {
    // RGB: 20 MP is 60 MB decoded and kept by PDFium; just over is never kept.
    assert!(!worth_swapping(&rgb_info(5000, 4000)), "20 MP RGB, 60.0 MB: kept");
    assert!(worth_swapping(&rgb_info(5000, 4001)), "just over 60 MB: never kept");
    // Grey: three times the pixels for the same bytes.
    let grey = |w, h| ImageInfo { bpp: 8, colorspace: 1, ..rgb_info(w, h) };
    assert!(!worth_swapping(&grey(10000, 6000)));
    assert!(worth_swapping(&grey(10000, 6001)));
    // 1-bit scans (Bayou's JBIG2 pages) are kept and stay with PDFium, however big.
    assert!(!worth_swapping(&ImageInfo { bpp: 1, colorspace: 1, filters: vec!["JBIG2Decode".into()], ..rgb_info(12000, 15200) }));
    // Transparency is left alone.
    assert!(!worth_swapping(&ImageInfo { transparent: true, ..rgb_info(6000, 6000) }));
    // Table profiles from 0.5 MP; a matrix profile only when too big to keep.
    let icc = |p: Vec<u8>, w, h| ImageInfo { colorspace: 7, icc: Some(Arc::new(p)), ..rgb_info(w, h) };
    assert!(worth_swapping(&icc(lut_profile(), 1000, 500)));
    assert!(!worth_swapping(&icc(lut_profile(), 999, 500)));
    let srgb = moxcms::ColorProfile::new_srgb().encode().unwrap();
    assert!(!worth_swapping(&icc(srgb.clone(), 2000, 2000)));
    assert!(worth_swapping(&icc(srgb, 5000, 4001)));
}

#[test]
fn picks_biggest_first_within_the_page_budget() {
    // Swapped at 4 bytes a pixel: 35 MP is 140 MB, 30 MP 120 MB. 140 + 120 + 120 fits in
    // PAGE_SWAP_BYTES; a fourth doesn't.
    let big = rgb_info(6000, 5000);
    let images = vec![rgb_info(100, 100), big.clone(), rgb_info(7000, 5000), big.clone(), big.clone(), big];
    assert!(PAGE_SWAP_BYTES >= 380_000_000 && PAGE_SWAP_BYTES < 500_000_000);
    let picked = pick_swaps(&images);
    assert_eq!(picked[0], 2, "biggest first");
    assert_eq!(picked.len(), 3, "the 35 MP one and two 30 MP: {picked:?}");
    assert!(!picked.contains(&0), "small images aren't swapped");
}

#[test]
fn one_band_for_pages_with_a_swap_or_a_slow_decode() {
    assert!(!one_band(&[rgb_info(1024, 1024), rgb_info(1024, 1024)]), "aerial-style tiles stay banded");
    assert!(!one_band(&[rgb_info(4000, 2828)]), "an 11 MP image PDFium keeps stays banded");
    assert!(one_band(&[rgb_info(5000, 4001)]), "an image too big to keep is swapped");
    let jbig2 = ImageInfo { bpp: 1, colorspace: 1, filters: vec!["JBIG2Decode".into()], ..rgb_info(12000, 15200) };
    assert!(!worth_swapping(&jbig2) && one_band(&[jbig2]), "Bayou's 182 MP scans: not swapped, one band");
    let one_bit = |filter: &str, w, h| ImageInfo { bpp: 1, colorspace: 1, filters: vec![filter.into()], ..rgb_info(w, h) };
    assert!(one_band(&[one_bit("CCITTFaxDecode", 8409, 5946)]), "50 MP fax-style scan: about 160 ms");
    assert!(!one_band(&[one_bit("CCITTFaxDecode", 7500, 5300)]), "40 MP fax-style scan: about 127 ms");
    assert!(one_band(&[one_bit("JBIG2Decode", 6000, 6000)]), "36 MP JBIG2: about 166 ms");
    let grey_jpeg = |w, h| ImageInfo { bpp: 8, colorspace: 1, ..rgb_info(w, h) };
    assert!(!one_band(&[grey_jpeg(7000, 7000)]), "49 MP grey JPEG: about 113 ms");
    assert!(one_band(&[ImageInfo { filters: vec!["JPXDecode".into()], ..rgb_info(4000, 3000) }]), "JPEG 2000 is assumed slow");
    let small_lut = ImageInfo { colorspace: 7, icc: Some(Arc::new(lut_profile())), ..rgb_info(1000, 600) };
    assert!(one_band(&[small_lut]), "a swapped image, however small");
    assert!(!one_band(&[]));
}

#[test]
fn decodes_ourselves_only_plain_jpegs() {
    assert!(our_decode_possible(&rgb_info(10, 10)));
    assert!(our_decode_possible(&ImageInfo { bpp: 8, colorspace: 1, ..rgb_info(10, 10) }));
    assert!(!our_decode_possible(&ImageInfo { bpp: 32, colorspace: 3, ..rgb_info(10, 10) }), "CMYK goes to PDFium");
    assert!(!our_decode_possible(&ImageInfo { filters: vec!["FlateDecode".into()], ..rgb_info(10, 10) }));
    assert!(!our_decode_possible(&ImageInfo { filters: vec!["FlateDecode".into(), "DCTDecode".into()], ..rgb_info(10, 10) }));
    let icc = |p: Vec<u8>, bpp| ImageInfo { colorspace: 7, bpp, icc: Some(Arc::new(p)), ..rgb_info(10, 10) };
    assert!(our_decode_possible(&icc(lut_profile(), 24)));
    assert!(!our_decode_possible(&icc(moxcms::ColorProfile::new_gray_with_gamma(2.2).encode().unwrap(), 8)), "grey profiles go to PDFium");
    assert!(!our_decode_possible(&ImageInfo { colorspace: 7, icc: None, ..rgb_info(10, 10) }));
}

#[test]
fn finds_lookup_tables_in_profiles() {
    assert!(icc_has_lut(&lut_profile()));
    assert!(!icc_has_lut(&moxcms::ColorProfile::new_srgb().encode().unwrap()), "matrix and curves");
    assert!(!icc_has_lut(b"short"));
    assert!(!icc_has_lut(&[]));
}

#[test]
fn colours_agree_within_a_level_on_average_and_one_percent_far() {
    let a = vec![100u8; 1000];
    assert!(colours_agree(&a, &a));
    assert!(!colours_agree(&a, &vec![102u8; 1000]), "mean 2 levels");
    let mut far = a.clone();
    far[..9].iter_mut().for_each(|v| *v = 120); // 0.9% far, mean 0.18
    assert!(colours_agree(&a, &far));
    far[..11].iter_mut().for_each(|v| *v = 120); // 1.1% far
    assert!(!colours_agree(&a, &far));
    assert!(!colours_agree(&a, &a[..999]));
    assert!(!colours_agree(&[], &[]));
    assert_eq!(test_grid().len(), 17 * 17 * 17 * 3);
}

// ---------- our decode and colour ----------

#[test]
fn decode_keeps_every_pixel_and_refuses_garbage() {
    let j = jpeg(&quadrants(1001, 517), 1001, 517);
    let d = decode_jpeg(&j).unwrap();
    assert_eq!((d.w, d.h, d.channels, d.samples.len()), (1001, 517, 3, 1001 * 517 * 3));
    assert!(d.samples[(100 * 1001 + 10) * 3] > 200, "top left red");
    assert!(decode_jpeg(b"not a jpeg").is_none());
    let grey = ImageBuffer::from_fn(64, 64, |_, _| Luma([77u8]));
    let mut g = Vec::new();
    JpegEncoder::new_with_quality(&mut g, 90).write_image(grey.as_raw(), 64, 64, image::ExtendedColorType::L8).unwrap();
    assert_eq!(decode_jpeg(&g).unwrap().channels, 1);
}

fn rgb_img(w: u32, h: u32, px: [u8; 3]) -> Decoded {
    Decoded { w, h, channels: 3, samples: px.iter().copied().cycle().take((w * h * 3) as usize).collect() }
}

#[test]
fn icc_conversion_srgb_is_a_no_op_wide_gamut_moves_colour_not_grey() {
    let srgb = moxcms::ColorProfile::new_srgb().encode().unwrap();
    let mut img = rgb_img(37, 23, [200, 100, 50]);
    assert!(icc_to_srgb(&mut img, &srgb));
    assert!(img.samples.chunks(3).all(|p| p.iter().zip([200i32, 100, 50]).all(|(&g, w)| (g as i32 - w).abs() <= 2)));
    let p3 = moxcms::ColorProfile::new_display_p3().encode().unwrap();
    let mut orange = rgb_img(64, 64, [230, 120, 20]);
    assert!(icc_to_srgb(&mut orange, &p3));
    let p = orange.samples[0..3].to_vec();
    assert!(p.iter().zip([230i32, 120, 20]).map(|(&g, w)| (g as i32 - w).abs()).sum::<i32>() > 10, "P3 orange moves: {p:?}");
    assert!(orange.samples.chunks(3).all(|q| q == p), "every chunk converted");
    let mut grey = rgb_img(64, 64, [128, 128, 128]);
    assert!(icc_to_srgb(&mut grey, &p3));
    assert!(grey.samples.iter().all(|&v| (v as i32 - 128).abs() <= 2));
}

#[test]
fn icc_conversion_refuses_what_it_cannot_apply() {
    let mut img = rgb_img(8, 8, [1, 2, 3]);
    assert!(!icc_to_srgb(&mut img, b"not a profile"));
    assert_eq!(&img.samples[0..3], &[1, 2, 3]);
    let mut grey = Decoded { w: 4, h: 4, channels: 1, samples: vec![9; 16] };
    assert!(!icc_to_srgb(&mut grey, &moxcms::ColorProfile::new_srgb().encode().unwrap()));
}

// ---------- swapped pages, rendered ----------

#[test]
fn big_jpegs_swap_from_our_decode_including_inside_forms() {
    // 4600 x 4400 RGB is 60.7 MB decoded: PDFium would never keep it.
    let (w, h) = (4600, 4400);
    let j = jpeg(&quadrants(w, h), w, h);
    let srgb = moxcms::ColorProfile::new_srgb().encode().unwrap();
    let (pw, ph) = (460.0, 440.0);
    let pages = [
        Pg { w, h, data: j.clone(), filter: "/Filter/DCTDecode", colour: "", icc: Some(srgb), in_form: false },
        Pg { w, h, data: j, filter: "/Filter/DCTDecode", colour: "/DeviceRGB", icc: None, in_form: true },
    ];
    let (doc, _) = open_fixture("swap-ours", &make(&pages, pw, ph));
    let before = SWAPS_OURS.load(Ordering::Relaxed);
    check_quadrants(doc, 0, pw, ph, "sRGB profile page");
    check_quadrants(doc, 1, pw, ph, "device RGB page, image inside a form");
    assert!(SWAPS_OURS.load(Ordering::Relaxed) >= before + 2, "both swapped from our decode");
    // Bands are only worked out for regions over 0.5 MP.
    pdfium().render(doc, RegionArgs { id: 0, page: 0, rs: 2.0, x: 0, y: 0, w: 920, h: 880 }).unwrap().unwrap();
    assert_eq!(pdfium().known_bands(doc, 0), Some(1), "a swapped page renders as one band");
}

#[test]
fn images_we_cannot_decode_swap_from_pdfiums_decode() {
    // Uncompressed RGB samples over 60 MB: never kept by PDFium, not a JPEG for us.
    let (w, h) = (4600, 4400);
    let (pw, ph) = (460.0, 440.0);
    let pages = [Pg { w, h, data: quadrants(w, h), filter: "", colour: "/DeviceRGB", icc: None, in_form: false }];
    let (doc, _) = open_fixture("swap-pdfium", &make(&pages, pw, ph));
    let before = SWAPS_PDFIUM.load(Ordering::Relaxed);
    check_quadrants(doc, 0, pw, ph, "raw RGB page");
    assert!(SWAPS_PDFIUM.load(Ordering::Relaxed) > before, "swapped from PDFium's decode");
}

#[test]
fn small_images_with_a_table_profile_are_swapped() {
    // 1000 x 600 (0.6 MP) with a lookup-table profile: PDFium would convert it every render.
    let (w, h) = (1000, 600);
    let icc = lut_profile();
    let pages = [Pg { w, h, data: jpeg(&quadrants(w, h), w, h), filter: "/Filter/DCTDecode", colour: "", icc: Some(icc.clone()), in_form: false }];
    let (doc, _) = open_fixture("swap-lut", &make(&pages, 500.0, 300.0));
    let before = SWAPS_OURS.load(Ordering::Relaxed) + SWAPS_PDFIUM.load(Ordering::Relaxed);
    let buf = pdfium().render(doc, RegionArgs { id: 0, page: 0, rs: 1.0, x: 0, y: 0, w: 500, h: 300 }).unwrap().unwrap();
    assert!(SWAPS_OURS.load(Ordering::Relaxed) + SWAPS_PDFIUM.load(Ordering::Relaxed) > before, "swapped");
    // Our table maps through linear-light primaries, so check order, not exact values: the
    // red quadrant stays reddest, the blue bluest.
    let tl = rgb_at(&buf, 500, 125, 75);
    let tr = rgb_at(&buf, 500, 375, 75);
    assert!(tl[0] > tl[2] && tr[2] > tr[0], "red stays red, blue stays blue: {tl:?} {tr:?}");
    // A hand-built v2 profile: our conversion should match PDFium's and be used.
    let agrees = pdfium().run_on_worker(move |ctx| profile_agrees(ctx.bindings(), &icc)).unwrap();
    assert!(agrees, "our conversion of a simple v2 table profile matches PDFium's");
}

#[test]
fn pages_with_a_swap_render_as_one_band_others_stay_banded() {
    let page = |w: u32, h: u32| Pg { w, h, data: jpeg(&quadrants(w, h), w, h), filter: "/Filter/DCTDecode", colour: "/DeviceRGB", icc: None, in_form: false };
    let (doc, _) = open_fixture("swap-bands", &make(&[page(4600, 4400), page(4000, 2828)], 1200.0, 1200.0));
    let workers = pdfium().worker_count().unwrap();
    for p in [0, 1] {
        pdfium().render(doc, RegionArgs { id: 0, page: p, rs: 1.0, x: 0, y: 0, w: 1200, h: 1200 }).unwrap().unwrap();
    }
    assert_eq!(pdfium().known_bands(doc, 0), Some(1), "60.7 MB image, swapped: one band");
    assert_eq!(pdfium().known_bands(doc, 1), Some(workers), "11 MP image PDFium keeps: banded");
}
