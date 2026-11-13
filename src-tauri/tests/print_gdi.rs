//! End to end through a real Windows printer driver: compose, print to "Microsoft Print to
//! PDF" (on every Windows 10/11 machine), open the PDF it writes with PDFium and check the
//! page count, page sizes and where the content landed.
//!
//! Skips (passes, printing "SKIP") when that printer isn't installed. `npm test` runs this
//! file through `src/lib/print/printToPdf.test.ts`.

#![cfg(windows)]

mod print_common;

use print_common::*;
use serde_json::json;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use vellum_lib::print::gdi::{self, Quality, SendOptions};
use vellum_lib::print::job::{ColourMode, Job};
use vellum_lib::print::jobs;

const PRINTER: &str = "Microsoft Print to PDF";
const A4: (f64, f64) = (595.28, 841.89);
const A3L: (f64, f64) = (1190.55, 841.89);

fn printer_present() -> bool {
    match gdi::printers() {
        Ok(v) => v.iter().any(|p| p.name == PRINTER),
        Err(e) => {
            eprintln!("could not list printers: {e}");
            false
        }
    }
}

/// The spooler writes the file after EndDoc returns; wait for it to appear and settle.
fn wait_for_file(p: &Path) -> Vec<u8> {
    let start = Instant::now();
    let mut last = 0u64;
    let mut stable = 0;
    while start.elapsed() < Duration::from_secs(60) {
        if let Ok(m) = std::fs::metadata(p) {
            if m.len() > 0 && m.len() == last {
                stable += 1;
                if stable >= 3 {
                    if let Ok(b) = std::fs::read(p) {
                        if b.ends_with(b"%%EOF\n") || b.ends_with(b"%%EOF\r\n") || b.ends_with(b"%%EOF") {
                            return b;
                        }
                    }
                }
            } else {
                stable = 0;
            }
            last = m.len();
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    panic!("{} never appeared", p.display());
}

fn fixture_job() -> serde_json::Value {
    // An A4 page with a 100 x 50 pt mark at user (100, 100): y-down (100, 691.89)-(200, 741.89).
    let (id, path) = open_fixture("gdi", &make_pdf(vec![page(A4.0, A4.1, &[(100.0, 100.0, 200.0, 150.0)])]));
    json!({ "sheets": [
        { "w": A4.0, "h": A4.1, "items": [
            { "docId": id, "page": 0, "path": path, "srcW": A4.0, "srcH": A4.1, "x": 0, "y": 0, "scale": 1 }]},
        { "w": A3L.0, "h": A3L.1, "items": [
            { "docId": id, "page": 0, "path": path, "srcW": A4.0, "srcH": A4.1, "x": 300, "y": -600, "scale": 1, "rotation": 0 }]}
    ]})
}

fn print_to_pdf(quality: Quality, colour: ColourMode, tag: &str) -> Option<Arc<Vec<u8>>> {
    if !printer_present() {
        println!("SKIP: {PRINTER} is not installed");
        return None;
    }
    let job: Job = serde_json::from_value(fixture_job()).unwrap();
    let info = jobs().compose(pdfium(), job).unwrap();
    let out = temp_dir("gdi").join(format!("out-{tag}.pdf"));
    let _ = std::fs::remove_file(&out);
    let o = SendOptions {
        printer: PRINTER.into(),
        copies: 1,
        collate: true,
        duplex: Default::default(),
        colour,
        black_sensitivity: vellum_lib::print::job::BLACK_LINES_SENSITIVITY,
        quality,
        paper: None,
        tray_by_size: false,
        bin: None,
        reverse: false,
        title: format!("Vellum print test {tag}"),
        output_file: Some(out.to_string_lossy().into_owned()),
    };
    let mut seen = Vec::new();
    jobs().send(pdfium(), info.job_id, &o, |d, t| seen.push((d, t))).unwrap();
    jobs().release(info.job_id);
    assert_eq!(seen, vec![(1, 2), (2, 2)]);
    Some(Arc::new(wait_for_file(&out)))
}

fn check_output(bytes: Arc<Vec<u8>>, what: &str) {
    let sizes = page_sizes(bytes.clone());
    assert_eq!(sizes.len(), 2, "{what}: page count");
    let close = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).abs() < 2.0 && (a.1 - b.1).abs() < 2.0;
    assert!(close(sizes[0], A4), "{what}: sheet 1 is A4 portrait, got {:?}", sizes[0]);
    assert!(close(sizes[1], A3L), "{what}: sheet 2 is A3 landscape, got {:?}", sizes[1]);
    let bb = ink_bbox_pt(bytes.clone(), 0, sizes[0].0, sizes[0].1).expect("ink on sheet 1");
    assert_near(bb, (100.0, A4.1 - 150.0, 200.0, A4.1 - 100.0), 1.0, &format!("{what}: sheet 1 mark"));
    let bb = ink_bbox_pt(bytes, 1, sizes[1].0, sizes[1].1).expect("ink on sheet 2");
    assert_near(bb, (400.0, A4.1 - 150.0 - 600.0, 500.0, A4.1 - 100.0 - 600.0), 1.0, &format!("{what}: sheet 2 mark"));
}

#[test]
fn image_600_dpi_to_microsoft_print_to_pdf() {
    let Some(b) = print_to_pdf(Quality::Image600, ColourMode::Colour, "600") else { return };
    check_output(b, "Image 600 dpi");
}

#[test]
fn image_300_dpi_black_lines_to_microsoft_print_to_pdf() {
    let Some(b) = print_to_pdf(Quality::Image300, ColourMode::BlackLines, "300bl") else { return };
    check_output(b, "Image 300 dpi, black lines");
}

#[test]
fn vector_to_microsoft_print_to_pdf() {
    let Some(b) = print_to_pdf(Quality::Vector, ColourMode::Colour, "vector") else { return };
    check_output(b.clone(), "Vector");
    // Vector output is small: no page-sized raster.
    assert!(b.len() < 200_000, "vector output is {} bytes", b.len());
}

#[test]
fn reports_capabilities_and_margins() {
    if !printer_present() {
        println!("SKIP: {PRINTER} is not installed");
        return;
    }
    let caps = gdi::capabilities(PRINTER).unwrap();
    assert!(caps.papers.iter().any(|p| p.name.contains("A4") && (p.w - 210.0).abs() < 1.0), "papers: {:?}", caps.papers);
    assert!(caps.papers.iter().any(|p| p.name.contains("A3")));
    let a4 = caps.papers.iter().find(|p| p.name.contains("A4")).unwrap().id;
    let m = gdi::margins(PRINTER, Some(a4), false).unwrap();
    assert!(m.left < 1.0 && m.top < 1.0 && m.right < 1.0 && m.bottom < 1.0, "{m:?}");
}
