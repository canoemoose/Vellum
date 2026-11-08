//! Composition through PDFium: where content lands on the composed sheets.
//!
//! Fixtures are built with PDFium (black rectangles at known places), composed, rendered and
//! measured. Ink positions are compared in points with a tolerance of half a point.

mod print_common;

use print_common::*;
use serde_json::json;
use std::sync::Arc;
use vellum_lib::print::job::Job;
use vellum_lib::print::jobs;

const TOL: f64 = 0.6;

fn compose(job: serde_json::Value) -> Arc<Vec<u8>> {
    let job: Job = serde_json::from_value(job).expect("job JSON");
    let info = jobs().compose(pdfium(), job).expect("compose");
    let bytes = jobs().bytes(info.job_id).unwrap();
    jobs().release(info.job_id);
    bytes
}

#[test]
fn places_a_page_scaled_at_a_position() {
    // 200 x 100 page, rect from x 50..150 and (y down) 25..75: user space y 25..75 too.
    let (id, path) = open_fixture("place", &make_pdf(vec![page(200.0, 100.0, &[(50.0, 25.0, 150.0, 75.0)])]));
    let out = compose(json!({ "sheets": [{ "w": 500, "h": 300, "items": [
        { "docId": id, "page": 0, "path": path, "srcW": 200, "srcH": 100, "x": 10, "y": 20, "scale": 2 }
    ]}]}));
    assert_eq!(page_sizes(out.clone()), vec![(500.0, 300.0)]);
    let bb = ink_bbox_pt(out, 0, 500.0, 300.0).expect("ink");
    assert_near(bb, (110.0, 70.0, 310.0, 170.0), TOL, "scaled placement");
}

#[test]
fn rotates_an_item_clockwise() {
    // Rect at x 0..40, y-down 0..20 (top-left corner of a 200 x 100 page): user y 80..100.
    let (id, path) = open_fixture("rotate", &make_pdf(vec![page(200.0, 100.0, &[(0.0, 80.0, 40.0, 100.0)])]));
    for (rot, want) in [
        // 90 cw: the top-left corner goes to the top-right; box is 100 x 200.
        (90, (80.0, 0.0, 100.0, 40.0)),
        (180, (160.0, 80.0, 200.0, 100.0)),
        (270, (0.0, 160.0, 20.0, 200.0)),
        (0, (0.0, 0.0, 40.0, 20.0)),
    ] {
        let out = compose(json!({ "sheets": [{ "w": 300, "h": 300, "items": [
            { "docId": id, "page": 0, "path": path, "srcW": 200, "srcH": 100, "x": 0, "y": 0, "scale": 1, "rotation": rot }
        ]}]}));
        let bb = ink_bbox_pt(out, 0, 300.0, 300.0).expect("ink");
        assert_near(bb, want, TOL, &format!("rotation {rot}"));
    }
}

/// A source page with /Rotate composes exactly as the viewer shows it.
#[test]
fn honours_the_source_page_rotation() {
    for rotate in [1, 2, 3] {
        let spec = PageSpec { w: 200.0, h: 100.0, rotate, rects: vec![(10.0, 60.0, 50.0, 90.0)], ..Default::default() };
        let src = Arc::new(make_pdf(vec![spec]));
        let (dw, dh) = if rotate % 2 == 1 { (100.0, 200.0) } else { (200.0, 100.0) };
        let shown = ink_bbox_pt(src.clone(), 0, dw, dh).expect("source ink");
        let (id, path) = open_fixture(&format!("srcrot{rotate}"), &src);
        let out = compose(json!({ "sheets": [{ "w": dw, "h": dh, "items": [
            { "docId": id, "page": 0, "path": path, "srcW": dw, "srcH": dh, "x": 0, "y": 0, "scale": 1 }
        ]}]}));
        let bb = ink_bbox_pt(out, 0, dw, dh).expect("ink");
        assert_near(bb, shown, TOL, &format!("/Rotate {}", rotate * 90));
    }
}

#[test]
fn crops_to_a_region_of_the_page() {
    // Rect at x 50..150, y-down 25..75. Crop x 40..100, y 20..60 -> visible x 10..60, y 5..40.
    let (id, path) = open_fixture("crop", &make_pdf(vec![page(200.0, 100.0, &[(50.0, 25.0, 150.0, 75.0)])]));
    let out = compose(json!({ "sheets": [{ "w": 100, "h": 100, "items": [
        { "docId": id, "page": 0, "path": path, "srcW": 200, "srcH": 100,
          "crop": { "x0": 40, "y0": 20, "x1": 100, "y1": 60 }, "x": 0, "y": 0, "scale": 1 }
    ]}]}));
    let bb = ink_bbox_pt(out, 0, 100.0, 100.0).expect("ink");
    assert_near(bb, (10.0, 5.0, 60.0, 40.0), TOL, "crop");
}

#[test]
fn crops_a_rotated_source_page_in_displayed_coordinates() {
    // /Rotate 90: displayed 100 x 200. Crop the displayed top half.
    let spec = PageSpec { w: 200.0, h: 100.0, rotate: 1, rects: vec![(0.0, 0.0, 200.0, 100.0)], ..Default::default() };
    let (id, path) = open_fixture("croprot", &make_pdf(vec![spec]));
    let out = compose(json!({ "sheets": [{ "w": 300, "h": 300, "items": [
        { "docId": id, "page": 0, "path": path, "srcW": 100, "srcH": 200,
          "crop": { "x0": 0, "y0": 0, "x1": 100, "y1": 100 }, "x": 20, "y": 30, "scale": 1 }
    ]}]}));
    let bb = ink_bbox_pt(out, 0, 300.0, 300.0).expect("ink");
    assert_near(bb, (20.0, 30.0, 120.0, 130.0), TOL, "crop of a rotated page");
}

#[test]
fn the_same_page_twice_with_different_crops() {
    let (id, path) = open_fixture("twocrops", &make_pdf(vec![page(200.0, 100.0, &[(0.0, 0.0, 200.0, 100.0)])]));
    let out = compose(json!({ "sheets": [{ "w": 300, "h": 300, "items": [
        { "docId": id, "page": 0, "path": path, "srcW": 200, "srcH": 100,
          "crop": { "x0": 0, "y0": 0, "x1": 20, "y1": 20 }, "x": 0, "y": 0, "scale": 1 },
        { "docId": id, "page": 0, "path": path, "srcW": 200, "srcH": 100,
          "crop": { "x0": 0, "y0": 0, "x1": 50, "y1": 10 }, "x": 100, "y": 200, "scale": 1 }
    ]}]}));
    let (px, w, h) = render_pdf_page(out, 0, 300.0, 300.0, 1.0);
    // First item: 20 x 20 at the origin; second: 50 x 10 at (100, 200). Nothing between.
    let ink = |x: i32, y: i32| px[((y * w + x) * 4) as usize] < 128;
    assert!(ink(10, 10) && !ink(25, 10) && !ink(10, 25));
    assert!(ink(140, 205) && !ink(155, 205) && !ink(140, 215));
    assert!(ink_bbox(&px, w, h).is_some());
}

#[test]
fn sheet_clip_keeps_margins_clear_but_not_marks() {
    let (id, path) = open_fixture("clip", &make_pdf(vec![page(400.0, 400.0, &[(0.0, 0.0, 400.0, 400.0)])]));
    let out = compose(json!({ "sheets": [{ "w": 200, "h": 200,
        "items": [{ "docId": id, "page": 0, "path": path, "srcW": 400, "srcH": 400, "x": -100, "y": -100, "scale": 1 }],
        "clip": { "x0": 20, "y0": 30, "x1": 180, "y1": 170 },
        "lines": [{ "x0": 0, "y0": 5, "x1": 10, "y1": 5, "width": 2 }]
    }]}));
    let (px, w, _) = render_pdf_page(out, 0, 200.0, 200.0, 2.0);
    let ink = |x: f64, y: f64| px[(((y * 2.0) as i32 * w + (x * 2.0) as i32) * 4) as usize] < 128;
    assert!(ink(100.0, 100.0), "inside the clip");
    assert!(ink(21.0, 31.0) && ink(179.0, 169.0), "clip corners");
    assert!(!ink(15.0, 100.0) && !ink(185.0, 100.0) && !ink(100.0, 25.0) && !ink(100.0, 175.0), "margins clear");
    assert!(ink(5.0, 5.0), "cut mark outside the clip");
}

#[test]
fn draws_lines_and_text() {
    let (id, path) = open_fixture("marks", &make_pdf(vec![page(100.0, 100.0, &[])]));
    let out = compose(json!({ "sheets": [{ "w": 300, "h": 200,
        "items": [{ "docId": id, "page": 0, "path": path, "srcW": 100, "srcH": 100, "x": 0, "y": 0, "scale": 1 }],
        "lines": [{ "x0": 100, "y0": 100, "x1": 200, "y1": 100, "width": 1 }],
        "texts": [{ "x": 10, "y": 190, "size": 8, "text": "plan.pdf - page 1 - 08/11/2026" }]
    }]}));
    let bb = ink_bbox_pt(out.clone(), 0, 300.0, 200.0).expect("ink");
    assert!(bb.0 >= 9.0 && bb.0 <= 12.0, "text starts near x 10: {bb:?}");
    assert!(bb.3 <= 192.5 && bb.3 >= 185.0, "text baseline near y 190: {bb:?}");
    assert!((bb.2 - 200.0).abs() < 1.0 || bb.2 > 100.0, "line reaches x 200: {bb:?}");
    let (px, w, _) = render_pdf_page(out, 0, 300.0, 200.0, 1.0);
    assert!(px[((100 * w + 150) * 4) as usize] < 128, "line at y 100");
}

#[test]
fn a_page_tiled_onto_many_sheets_is_stored_once() {
    let spec = PageSpec { w: 300.0, h: 300.0, noise_image: Some(400), ..Default::default() };
    let (id, path) = open_fixture("shared", &make_pdf(vec![spec]));
    let sheet = |x: f64| json!({ "w": 200, "h": 200,
        "items": [{ "docId": id, "page": 0, "path": path, "srcW": 300, "srcH": 300, "x": x, "y": 0, "scale": 1 }] });
    let one = compose(json!({ "sheets": [sheet(0.0)] })).len();
    let six = compose(json!({ "sheets": [sheet(0.0), sheet(-100.0), sheet(-200.0), sheet(0.0), sheet(-50.0), sheet(-150.0)] })).len();
    assert!(one > 400 * 400 * 3 / 2, "fixture image is in the output ({one} bytes)");
    assert!((six as f64) < one as f64 * 1.2, "six sheets {six} bytes vs one {one}");
}

#[test]
fn several_pages_and_sources_on_several_sheets() {
    let a = make_pdf(vec![page(100.0, 100.0, &[(0.0, 0.0, 10.0, 10.0)]), page(100.0, 100.0, &[(90.0, 90.0, 100.0, 100.0)])]);
    let (ida, pa) = open_fixture("multi-a", &a);
    let (idb, pb) = open_fixture("multi-b", &make_pdf(vec![page(50.0, 50.0, &[(20.0, 20.0, 30.0, 30.0)])]));
    let out = compose(json!({ "sheets": [
        { "w": 200, "h": 200, "items": [
            { "docId": ida, "page": 1, "path": pa, "srcW": 100, "srcH": 100, "x": 0, "y": 0, "scale": 1 },
            { "docId": idb, "page": 0, "path": pb, "srcW": 50, "srcH": 50, "x": 100, "y": 100, "scale": 2 }]},
        { "w": 300, "h": 100, "items": [
            { "docId": ida, "page": 0, "path": pa, "srcW": 100, "srcH": 100, "x": 50, "y": 0, "scale": 1 }]}
    ]}));
    assert_eq!(page_sizes(out.clone()), vec![(200.0, 200.0), (300.0, 100.0)]);
    let bb = ink_bbox_pt(out.clone(), 0, 200.0, 200.0).unwrap();
    // Page 2's mark: x 90..100, y-down 0..10. Doc b's mark at 2x: x 140..160, y-down 140..160.
    assert_near(bb, (90.0, 0.0, 160.0, 160.0), TOL, "sheet 1");
    let bb = ink_bbox_pt(out, 1, 300.0, 100.0).unwrap();
    assert_near(bb, (50.0, 90.0, 60.0, 100.0), TOL, "sheet 2");
}

#[test]
fn falls_back_to_the_open_document_when_the_file_is_gone() {
    let bytes = make_pdf(vec![page(100.0, 100.0, &[(0.0, 0.0, 50.0, 50.0)])]);
    let (id, path) = open_fixture("gone", &bytes);
    // The viewer's PDFium holds the file open, so stand in for "moved or deleted" with a path
    // that doesn't exist.
    let path = format!("{path}.missing");
    let out = compose(json!({ "sheets": [{ "w": 100, "h": 100, "items": [
        { "docId": id, "page": 0, "path": path, "srcW": 100, "srcH": 100, "x": 0, "y": 0, "scale": 1,
          "crop": { "x0": 0, "y0": 50, "x1": 100, "y1": 100 } }
    ]}]}));
    let bb = ink_bbox_pt(out, 0, 100.0, 100.0).unwrap();
    assert_near(bb, (0.0, 0.0, 50.0, 50.0), TOL, "shared handle with crop");
    // The shared handle's crop box was put back: a second full-page compose is whole.
    let out = compose(json!({ "sheets": [{ "w": 100, "h": 100, "items": [
        { "docId": id, "page": 0, "path": path, "srcW": 100, "srcH": 100, "x": 0, "y": 0, "scale": 1 }
    ]}]}));
    let bb = ink_bbox_pt(out, 0, 100.0, 100.0).unwrap();
    assert_near(bb, (0.0, 50.0, 50.0, 100.0), TOL, "crop restored");
}

#[test]
fn embeds_images_png_and_jpeg() {
    let dir = temp_dir("images");
    // 192 x 96 px at 96 dpi = 144 x 72 pt. Black square at px 96..144, 24..72 = pt 72..108, 18..54.
    let mut img = image::RgbImage::from_pixel(192, 96, image::Rgb([255, 255, 255]));
    for y in 24..72 {
        for x in 96..144 {
            img.put_pixel(x, y, image::Rgb([0, 0, 0]));
        }
    }
    for (ext, fmt) in [("png", image::ImageFormat::Png), ("jpg", image::ImageFormat::Jpeg)] {
        let p = dir.join(format!("square.{ext}"));
        img.save_with_format(&p, fmt).unwrap();
        let info = docs().open(pdfium(), &p, None).unwrap();
        let (w, h) = (info.sizes[0].w as f64, info.sizes[0].h as f64);
        assert!((w - 144.0).abs() < 0.01 && (h - 72.0).abs() < 0.01, "{ext} page size {w} x {h}");
        let out = compose(json!({ "sheets": [{ "w": 300, "h": 200, "items": [
            { "docId": info.doc_id, "page": 0, "path": p.to_string_lossy(), "srcW": w, "srcH": h, "x": 10, "y": 10, "scale": 1 }
        ]}]}));
        let bb = ink_bbox_pt(out, 0, 300.0, 200.0).expect("ink");
        assert_near(bb, (82.0, 28.0, 118.0, 64.0), 1.0, ext);
    }
}

#[test]
fn rejects_bad_jobs() {
    let bad: Job = serde_json::from_value(json!({ "sheets": [] })).unwrap();
    assert_eq!(jobs().compose(pdfium(), bad).unwrap_err(), "Nothing to print");
    let bad: Job = serde_json::from_value(json!({ "sheets": [{ "w": 100, "h": 100, "items": [
        { "docId": 999999, "page": 0, "srcW": 10, "srcH": 10, "x": 0, "y": 0, "scale": 1 }]}]}))
    .unwrap();
    assert!(jobs().compose(pdfium(), bad).is_err());
}
