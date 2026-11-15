//! End to end through PDFium and Windows' OCR: the clean fixture built in memory, rendered,
//! recognised and scored. Needs `pdfium.dll` (found as the spike finds it) and an OCR language;
//! without either, each test says so and passes, so the pure tests still run anywhere.
//!
//! The thresholds sit well under what was measured on the development machine (see
//! docs/ocr-search-scope.md), so they catch a broken pipeline (wrong mapping, lost passes,
//! a tile seam eating words), not a few words' drift between Windows builds.
#![cfg(windows)]

use ocr_spike::fixture::{self, Variant};
use ocr_spike::geom::PageWord;
use ocr_spike::ocr::Ocr;
use ocr_spike::pdf::{Pdfium, drawing_pdf, image_only_pdf};
use ocr_spike::pipeline::{Options, Reread, ocr_page, ocr_region};
use ocr_spike::score::{Score, score};

/// PDFium is not thread-safe and the test harness runs tests on parallel threads: every test
/// holds this for its whole run.
static PDFIUM: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn lock() -> std::sync::MutexGuard<'static, ()> {
    PDFIUM.lock().unwrap_or_else(|e| e.into_inner())
}

fn setup() -> Option<Pdfium> {
    if let Err(e) = Ocr::from_user_languages() {
        eprintln!("skipped: {e}");
        return None;
    }
    match Pdfium::load() {
        Ok(p) => Some(p),
        Err(e) => {
            eprintln!("skipped: {e}");
            None
        }
    }
}

fn run(p: &Pdfium, bytes: Vec<u8>, truth_bytes: Option<Vec<u8>>, o: &Options) -> (Vec<PageWord>, Score) {
    let doc = p.open(bytes).unwrap();
    let page = doc.page(0).unwrap();
    let truth = match truth_bytes {
        Some(t) => p.open(t).unwrap().page(0).unwrap().truth_words(),
        None => page.truth_words(),
    };
    let (words, _) = ocr_page(&page, o).unwrap();
    let primary: Vec<_> = words.iter().filter(|w| !w.alt).cloned().collect();
    let s = score(&truth, &primary);
    (words, s)
}

#[test]
fn languages_are_listed_and_a_missing_one_is_refused() {
    let _g = lock();
    if setup().is_none() {
        return;
    }
    assert!(!Ocr::available_languages().unwrap().is_empty());
    assert!(Ocr::max_dimension().unwrap() >= 1600);
    assert!(Ocr::for_language("xx-YY").is_err());
}

#[test]
fn the_clean_fixture_is_read_in_every_direction() {
    let _g = lock();
    let Some(p) = setup() else { return };
    let (items, lines) = fixture::layout(1, Variant::CLEAN);
    let bytes = drawing_pdf(&p, &items, &lines, 0).unwrap();
    let (words, s) = run(&p, bytes, None, &Options::default());
    let r = |a: &str| s.by_angle[a].recall();
    // Measured: 0 deg 65%, 90 deg 48%, 270 deg 50%.
    assert!(r("0") > 0.5, "horizontal {:.2}", r("0"));
    assert!(r("90") > 0.3, "reading up {:.2}", r("90"));
    assert!(r("270") > 0.3, "reading down {:.2}", r("270"));
    // Large text is nearly all found. Measured: 62% of 9 pt and up across all angles
    // (45 degree text, a quarter of it, is never read).
    assert!(s.by_size["e 9+"].recall() > 0.45, "{:?}", s.by_size["e 9+"]);
    // The title block is read as is.
    for t in ["VELLUM", "OCR", "FIXTURE", "SHEET"] {
        assert!(words.iter().any(|w| w.text == t && !w.alt), "{t} not found");
    }
    // Junk stays low on a clean sheet. Measured: 49 of 371.
    assert!((s.junk as f64) < 0.25 * s.ocr_words as f64, "junk {} of {}", s.junk, s.ocr_words);
}

#[test]
fn a_rotated_page_maps_back_to_page_coordinates() {
    // The same sheet with /Rotate 90: words must still land on their own text, so recall
    // stays in the same range (the horizontal text is now vertical, the 270 text upside down).
    let _g = lock();
    let Some(p) = setup() else { return };
    let (items, lines) = fixture::layout(1, Variant::CLEAN);
    let bytes = drawing_pdf(&p, &items, &lines, 1).unwrap();
    let (_, s) = run(&p, bytes, None, &Options::default());
    assert!(s.all.recall() > 0.25, "{:?}", s.all);
}

#[test]
fn a_scan_reads_like_the_drawing_it_came_from() {
    // Rasterise the sheet into an image-only PDF at 200 dpi, OCR it at 200 dpi, and score it
    // against the original's text: within a few points of OCR on the vector page.
    let _g = lock();
    let Some(p) = setup() else { return };
    let (items, lines) = fixture::layout(1, Variant::CLEAN);
    let vector = drawing_pdf(&p, &items, &lines, 0).unwrap();
    let scan = {
        let doc = p.open(vector.clone()).unwrap();
        let page = doc.page(0).unwrap();
        image_only_pdf(&p, &page, 200.0).unwrap()
    };
    {
        let doc = p.open(scan.clone()).unwrap();
        let page = doc.page(0).unwrap();
        assert_eq!(page.char_count(), 0, "the scan has no text layer");
        assert_eq!(page.object_counts(), (1, 0), "the scan is one image");
    }
    let o = Options { dpi: 200.0, ..Options::default() };
    let (_, from_vector) = run(&p, vector.clone(), None, &o);
    let (_, from_scan) = run(&p, scan, Some(vector), &o);
    let (a, b) = (from_vector.all.recall(), from_scan.all.recall());
    assert!(b > 0.15, "scan recall {b:.2}");
    assert!((a - b).abs() < 0.08, "vector {a:.2} vs scan {b:.2}");
}

#[test]
fn light_text_on_dark_is_inverted_first() {
    let _g = lock();
    let Some(p) = setup() else { return };
    let (items, lines) = fixture::layout(1, Variant::CLEAN);
    let bytes = drawing_pdf(&p, &items, &lines, 0).unwrap();
    let doc = p.open(bytes).unwrap();
    let page = doc.page(0).unwrap();
    // The title block, 300 dpi, as a negative.
    let scale = 300.0 / 72.0;
    let (w, h) = page.pixel_size(scale, 0);
    let region = [w - 2600, h - 600, 2400, 500];
    let mut g = page.render_gray(scale, 0, region).unwrap();
    ocr_spike::image::invert(&mut g.px);
    assert!(ocr_spike::image::is_dark(&g.px, g.w, g.h, g.stride));
    let ocr = Ocr::from_user_languages().unwrap();
    let raw = ocr.recognise_gray(&g.px, g.w, g.h, g.stride).unwrap();
    ocr_spike::image::invert(&mut g.px);
    let fixed = ocr.recognise_gray(&g.px, g.w, g.h, g.stride).unwrap();
    let has = |r: &ocr_spike::ocr::Recognised, t: &str| r.words.iter().any(|w| w.text == t);
    assert!(has(&fixed, "FIXTURE") && has(&fixed, "SHEET"), "{:?}", fixed.words);
    eprintln!("negative read {} words as is, {} inverted", raw.words.len(), fixed.words.len());
}

#[test]
fn parallel_ocr_finds_the_same_words() {
    let _g = lock();
    let Some(p) = setup() else { return };
    let (items, lines) = fixture::layout(1, Variant::CLEAN);
    let bytes = drawing_pdf(&p, &items, &lines, 0).unwrap();
    let o1 = Options { dpi: 200.0, ..Options::default() };
    let o4 = Options { jobs: 4, ..o1.clone() };
    let (_, a) = run(&p, bytes.clone(), None, &o1);
    let (_, b) = run(&p, bytes, None, &o4);
    assert_eq!(a.all.found, b.all.found);
}

#[test]
fn a_marquee_reads_only_its_area() {
    let _g = lock();
    let Some(p) = setup() else { return };
    let (items, lines) = fixture::layout(1, Variant::CLEAN);
    let bytes = drawing_pdf(&p, &items, &lines, 0).unwrap();
    let doc = p.open(bytes).unwrap();
    let page = doc.page(0).unwrap();
    // The title block, bottom right.
    let (w, h) = (fixture::PAGE_W as f32, fixture::PAGE_H as f32);
    let r = [w - 640.0, h - 140.0, w - 100.0, h - 20.0];
    let (words, st) = ocr_region(&page, Some(r), &Options::default()).unwrap();
    assert!(words.iter().any(|x| x.text == "FIXTURE" && !x.alt), "{words:?}");
    for x in &words {
        let (cx, cy) = ((x.rect[0] + x.rect[2]) / 2.0, (x.rect[1] + x.rect[3]) / 2.0);
        assert!(cx >= r[0] - 1.0 && cx <= r[2] + 1.0 && cy >= r[1] - 1.0 && cy <= r[3] + 1.0, "{x:?} outside the marquee");
    }
    // 540 x 120 pt at 300 dpi is 2250 x 500 px: two tiles a pass, not the page's 48.
    assert!(st.passes.iter().all(|p| p.tiles <= 2), "{:?}", st.passes);
}

#[test]
fn rereading_does_not_lose_words() {
    // Measured on the clean fixture: 41.2% without, 43.9% with.
    let _g = lock();
    let Some(p) = setup() else { return };
    let (items, lines) = fixture::layout(1, Variant::CLEAN);
    let bytes = drawing_pdf(&p, &items, &lines, 0).unwrap();
    let off = Options { reread: Reread::Off, jobs: 4, ..Options::default() };
    let on = Options { reread: Reread::Suspect, jobs: 4, ..Options::default() };
    let (_, a) = run(&p, bytes.clone(), None, &off);
    let (_, b) = run(&p, bytes, None, &on);
    assert!(b.all.found >= a.all.found, "reread {} vs {}", b.all.found, a.all.found);
}

#[test]
fn removing_line_work_finds_more() {
    // Measured on the line-work fixture: 22.5% normally; 44% merged with a pass that has
    // paths over 8 pt removed.
    let _g = lock();
    let Some(p) = setup() else { return };
    let (items, lines) = fixture::layout(1, Variant::DRAWING);
    let bytes = drawing_pdf(&p, &items, &lines, 0).unwrap();
    let o = Options { jobs: 4, ..Options::default() };
    let doc = p.open(bytes.clone()).unwrap();
    let page = doc.page(0).unwrap();
    let truth = page.truth_words();
    let (base, _) = ocr_page(&page, &o).unwrap();
    let doc2 = p.open(bytes).unwrap();
    let page2 = doc2.page(0).unwrap();
    let (removed, _) = page2.remove_large_paths(8.0);
    assert!(removed > 2000, "removed {removed}");
    let (clean, _) = ocr_page(&page2, &o).unwrap();
    let prim = |ws: &[PageWord]| ws.iter().filter(|x| !x.alt).cloned().collect::<Vec<_>>();
    let before = score(&truth, &prim(&base)).all.recall();
    let merged = ocr_spike::geom::merge_clean(base, clean);
    let after = score(&truth, &prim(&merged)).all.recall();
    assert!(after > before + 0.1, "before {before:.2}, after {after:.2}");
}
