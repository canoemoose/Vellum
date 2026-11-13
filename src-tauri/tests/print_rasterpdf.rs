//! Save as PDF in Greyscale and Black lines: a raster PDF whose sheets match the composed ones
//! in size and where the ink lands.

mod print_common;

use print_common::*;
use serde_json::json;
use std::sync::Arc;
use vellum_lib::print::job::{ColourMode, Job};
use vellum_lib::print::{SaveOptions, jobs};

fn raster(job: serde_json::Value, colour: ColourMode) -> (Arc<Vec<u8>>, Arc<Vec<u8>>) {
    let job: Job = serde_json::from_value(job).expect("job JSON");
    let info = jobs().compose(pdfium(), job).expect("compose");
    let vector = jobs().bytes(info.job_id).unwrap();
    let o = SaveOptions { colour, black_sensitivity: 60, dpi: 150.0 };
    let out = jobs().raster_pdf(pdfium(), info.job_id, &o).expect("raster PDF");
    jobs().release(info.job_id);
    (vector, Arc::new(out))
}

#[test]
fn black_lines_pdf_keeps_sheet_sizes_and_ink_positions() {
    let (id, path) = open_fixture("rasterpdf", &make_pdf(vec![page(200.0, 100.0, &[(50.0, 25.0, 150.0, 75.0)])]));
    let item = json!({ "docId": id, "page": 0, "path": path, "srcW": 200, "srcH": 100, "x": 10, "y": 20, "scale": 2 });
    let (vector, out) = raster(json!({ "sheets": [
        { "w": 500, "h": 300, "items": [item.clone()] },
        { "w": 300, "h": 500, "items": [item] }
    ]}), ColourMode::BlackLines);
    assert_eq!(page_sizes(out.clone()), page_sizes(vector.clone()));
    let want = ink_bbox_pt(vector, 0, 500.0, 300.0).expect("ink in the vector PDF");
    let got = ink_bbox_pt(out.clone(), 0, 500.0, 300.0).expect("ink in the raster PDF");
    // 150 dpi is about half a point a dot; allow a dot and a half.
    assert_near(got, want, 0.8, "black lines placement");
    let text = String::from_utf8_lossy(&out);
    assert!(text.contains("DCTDecode"), "sheets are stored as JPEG strips");
}

#[test]
fn greyscale_pdf_is_raster_too() {
    let (id, path) = open_fixture("rastergrey", &make_pdf(vec![page(100.0, 100.0, &[(10.0, 10.0, 90.0, 90.0)])]));
    let (vector, out) = raster(json!({ "sheets": [{ "w": 100, "h": 100, "items": [
        { "docId": id, "page": 0, "path": path, "srcW": 100, "srcH": 100, "x": 0, "y": 0, "scale": 1 }
    ]}]}), ColourMode::Greyscale);
    assert_eq!(page_sizes(out.clone()), page_sizes(vector));
    assert!(ink_bbox_pt(out, 0, 100.0, 100.0).is_some());
}
