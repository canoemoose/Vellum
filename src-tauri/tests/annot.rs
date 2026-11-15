//! Saving markups (annot/): specs become annotations appended to the file, the save is
//! prepared beside the file and moved into place, PDFium sees the result, and annotations can
//! be hidden in PDFium so the overlay draws them instead. Fixtures are built with PDFium.

mod print_common;

use print_common::*;
use std::path::Path;
use std::sync::Arc;
use vellum_lib::annot::spec::Appearance;
use vellum_lib::annot::{self, AnnotSpec, Change, commands};

/// A red square at (x0, y0)-(x1, y1) in user space, drawn by its appearance stream.
fn square(page: usize, nm: &str, r: [f64; 4]) -> AnnotSpec {
    AnnotSpec {
        page,
        nm: nm.into(),
        subtype: "Square".into(),
        rect: r,
        appearance: Appearance {
            ops: format!("1 0 0 RG 1 0 0 rg {} {} {} {} re f", r[0], r[1], r[2] - r[0], r[3] - r[1]),
            bbox: r,
            ..Default::default()
        },
        author: Some("Test".into()),
        modified: Some("D:20261114120000Z".into()),
        created: Some("D:20261114120000Z".into()),
        contents: Some("note".into()),
        colour: Some([1.0, 0.0, 0.0]),
        interior: Some([1.0, 0.0, 0.0]),
        border_width: Some(1.0),
        ..Default::default()
    }
}

/// /NM of every annotation on page 0, as PDFium reads them.
fn nms(bytes: Vec<u8>) -> Vec<String> {
    pdfium()
        .run_on_worker(move |ctx| {
            let b = ctx.bindings();
            unsafe {
                let doc = b.FPDF_LoadMemDocument64(&bytes, None);
                assert!(!doc.is_null());
                let page = b.FPDF_LoadPage(doc, 0);
                let mut out = Vec::new();
                for i in 0..b.FPDFPage_GetAnnotCount(page) {
                    let a = b.FPDFPage_GetAnnot(page, i);
                    let mut buf = vec![0u16; 256];
                    let n = b.FPDFAnnot_GetStringValue(a, "NM", buf.as_mut_ptr(), 512) as usize;
                    out.push(String::from_utf16_lossy(&buf[..(n / 2).saturating_sub(1)]));
                    b.FPDFPage_CloseAnnot(a);
                }
                b.FPDF_ClosePage(page);
                b.FPDF_CloseDocument(doc);
                out
            }
        })
        .unwrap()
}

/// Ink bbox in points (y down), rendered with annotations on (FPDF_ANNOT), as Vellum shows it.
fn ink_with_annots(bytes: Vec<u8>) -> Option<(f64, f64, f64, f64)> {
    let r = vellum_lib::print::raster::SheetRenderer::open(pdfium(), Arc::new(bytes)).unwrap();
    let ppp = 4.0;
    let (w, h) = (1200, 800);
    let px = r.render_band(0, w, h, 0, 0, w, h, 0x01).unwrap();
    ink_bbox(&px, w, h).map(|(a, b, c, d)| (a as f64 / ppp, b as f64 / ppp, c as f64 / ppp, d as f64 / ppp))
}

fn blank() -> Vec<u8> {
    make_pdf(vec![page(300.0, 200.0, &[])])
}

#[test]
fn appended_annotations_keep_the_original_bytes_and_read_back() {
    let orig = blank();
    let out = annot::apply(orig.clone(), "", &[Change::Add { spec: square(0, "a", [10.0, 10.0, 60.0, 40.0]) }, Change::Add { spec: square(0, "b", [100.0, 100.0, 150.0, 140.0]) }]).unwrap();
    assert_eq!(&out[..orig.len()], &orig[..]);
    assert_eq!(nms(out.clone()), vec!["a", "b"]);
    // Drawn where the appearances say: red from the first square (y-down 160..190) to the
    // second (60..100).
    let bb = ink_with_annots(out).expect("ink");
    assert_near(bb, (10.0, 60.0, 150.0, 190.0), 0.6, "squares");
}

#[test]
fn replace_keeps_the_annotation_and_delete_removes_it() {
    let one = annot::apply(blank(), "", &[Change::Add { spec: square(0, "a", [10.0, 10.0, 60.0, 40.0]) }, Change::Add { spec: square(0, "b", [100.0, 100.0, 150.0, 140.0]) }]).unwrap();
    let two = annot::apply(one.clone(), "", &[Change::Replace { spec: square(0, "a", [20.0, 20.0, 80.0, 50.0]) }, Change::Delete { page: 0, nm: "b".into() }]).unwrap();
    assert_eq!(&two[..one.len()], &one[..]);
    assert_eq!(nms(two.clone()), vec!["a"]);
    let bb = ink_with_annots(two).expect("ink");
    assert_near(bb, (20.0, 150.0, 80.0, 180.0), 0.6, "moved square");
    assert!(annot::apply(one, "", &[Change::Delete { page: 0, nm: "missing".into() }]).is_err());
}

#[test]
fn a_save_is_prepared_beside_the_file_and_moved_into_place_once_pdfium_lets_go() {
    let (id, path) = open_fixture("annot-save", &blank());
    let path = Path::new(&path).to_path_buf();
    let before = annot::stamp(&path).unwrap();
    let p = annot::prepare(pdfium(), &path, "", &[Change::Add { spec: square(0, "s", [10.0, 10.0, 60.0, 40.0]) }], None, Some(before)).unwrap();
    assert!(Path::new(&p.temp).exists() && !p.rebuilt && p.added > 0);
    assert_eq!(Path::new(&p.temp).parent(), path.parent());
    // Close the document in PDFium, wait for every worker, then replace the file.
    docs().close(pdfium(), id);
    pdfium().wait_idle().unwrap();
    annot::commit(Path::new(&p.temp), &path).unwrap();
    assert!(!Path::new(&p.temp).exists());
    assert_eq!(nms(std::fs::read(&path).unwrap()), vec!["s"]);
    // The file changed, so a save that expects the old stamp is refused.
    let err = annot::prepare(pdfium(), &path, "", &[], None, Some(before)).unwrap_err();
    assert!(err.starts_with("[changed_on_disk]"), "{err}");
}

#[test]
fn hidden_annotations_stop_drawing_in_pdfium() {
    let bytes = annot::apply(blank(), "", &[Change::Add { spec: square(0, "h", [10.0, 10.0, 60.0, 40.0]) }]).unwrap();
    let (id, _) = open_fixture("annot-hide", &bytes);
    let ink = |id: u64| -> bool {
        pdfium()
            .run_on_worker_index(0, move |ctx| {
                let b = ctx.bindings();
                let p = ctx.page(id, 0).unwrap();
                unsafe {
                    let bmp = b.FPDFBitmap_Create(300, 200, 0);
                    b.FPDFBitmap_FillRect(bmp, 0, 0, 300, 200, 0xFFFFFFFF);
                    b.FPDF_RenderPageBitmap(bmp, p, 0, 0, 300, 200, 0, 1);
                    let buf = std::slice::from_raw_parts(b.FPDFBitmap_GetBuffer(bmp) as *const u8, 300 * 200 * 4);
                    let any = buf.chunks(4).any(|px| px[1] < 128);
                    b.FPDFBitmap_Destroy(bmp);
                    any
                }
            })
            .unwrap()
    };
    assert!(ink(id));
    assert_eq!(docs().hide_annots(pdfium(), id, 0, vec!["h".into()], true).unwrap(), 1);
    assert!(!ink(id), "hidden annotation still drawn");
    docs().hide_annots(pdfium(), id, 0, vec!["h".into()], false).unwrap();
    assert!(ink(id));
    docs().close(pdfium(), id);
}

#[test]
fn a_malformed_file_is_rebuilt_before_the_update_is_appended() {
    // Point startxref at nothing: readers recover by scanning the file, but an update appended
    // to it would chain back to a cross-reference table that isn't there.
    let mut bytes = blank();
    let at = bytes.windows(9).rposition(|w| w == b"startxref").unwrap() + 9;
    let end = at + bytes[at..].iter().position(|&c| c == b'%').unwrap();
    bytes.splice(at..end, b"
12
".iter().copied());
    let dir = temp_dir("annot-broken");
    let path = dir.join("broken.pdf");
    std::fs::write(&path, &bytes).unwrap();
    let p = annot::prepare(pdfium(), &path, "", &[Change::Add { spec: square(0, "r", [10.0, 10.0, 60.0, 40.0]) }], None, None).unwrap();
    assert!(p.rebuilt);
    annot::commit(Path::new(&p.temp), &path).unwrap();
    let out = std::fs::read(&path).unwrap();
    assert_eq!(nms(out.clone()), vec!["r"]);
    // The result reads without repair.
    assert!(!annot::Writer::open(out, "").unwrap().info.recovered);
}

#[test]
fn recovery_keys_are_kept_to_safe_names() {
    let d = Path::new("C:/x");
    assert!(commands::recovery_file(d, "abc-123_DEF").is_ok());
    for bad in ["", "../x", "a b", "a/b", "a.json", &"k".repeat(121)] {
        assert!(commands::recovery_file(d, bad).is_err(), "{bad:?}");
    }
}

#[test]
fn appearances_name_the_standard_fonts_they_use() {
    let mut spec = square(0, "t", [10.0, 10.0, 160.0, 40.0]);
    spec.appearance.ops = "BT 0 0 0 rg /TiBo 12 Tf 1 0 0 1 20 20 Tm (Hello) Tj ET".into();
    spec.appearance.fonts.insert("TiBo".into(), "Times-Bold".into());
    let out = annot::apply(blank(), "", &[Change::Add { spec }]).unwrap();
    let doc = lopdf::Document::load_mem(&out).unwrap();
    let page = *doc.get_pages().get(&1).unwrap();
    let annots = doc.get_dictionary(page).unwrap().get(b"Annots").unwrap();
    let annots = match annots {
        lopdf::Object::Reference(id) => doc.get_object(*id).unwrap().as_array().unwrap().clone(),
        o => o.as_array().unwrap().clone(),
    };
    let annot = doc.get_dictionary(annots[0].as_reference().unwrap()).unwrap();
    let ap = annot.get(b"AP").unwrap().as_dict().unwrap();
    let stream = doc.get_object(ap.get(b"N").unwrap().as_reference().unwrap()).unwrap().as_stream().unwrap();
    let res = stream.dict.get(b"Resources").unwrap().as_dict().unwrap();
    let font = res.get(b"Font").unwrap().as_dict().unwrap().get(b"TiBo").unwrap().as_dict().unwrap();
    assert_eq!(font.get(b"BaseFont").unwrap().as_name().unwrap(), b"Times-Bold");
    assert_eq!(font.get(b"Encoding").unwrap().as_name().unwrap(), b"WinAnsiEncoding");
    // PDFium draws it.
    assert!(ink_with_annots(out).is_some());
}

#[test]
fn the_private_reedit_entry_is_written_and_reads_back() {
    // JSON with what a literal PDF string has to escape, and text outside ASCII.
    let model = r#"{"v":1,"m":"D:20261114120000Z","markup":{"kind":"text","text":"Check (this) \ bolt, 5° off"}}"#;
    let mut spec = square(0, "r", [10.0, 10.0, 60.0, 40.0]);
    spec.vellum = Some(model.into());
    let out = annot::apply(blank(), "", &[Change::Add { spec }, Change::Add { spec: square(0, "plain", [100.0, 100.0, 150.0, 140.0]) }]).unwrap();

    // lopdf: the key sits beside the standard ones, only where it was given.
    let doc = lopdf::Document::load_mem(&out).unwrap();
    let page = *doc.get_pages().get(&1).unwrap();
    let annots = match doc.get_dictionary(page).unwrap().get(b"Annots").unwrap() {
        lopdf::Object::Reference(id) => doc.get_object(*id).unwrap().as_array().unwrap().clone(),
        o => o.as_array().unwrap().clone(),
    };
    let first = doc.get_dictionary(annots[0].as_reference().unwrap()).unwrap();
    assert!(first.has(annot::writer::REEDIT_KEY.as_bytes()));
    assert!(first.has(b"M") && first.has(b"NM") && first.has(b"AP"));
    let second = doc.get_dictionary(annots[1].as_reference().unwrap()).unwrap();
    assert!(!second.has(annot::writer::REEDIT_KEY.as_bytes()));

    // PDFium, as phase 7b will read it: the whole JSON comes back unchanged.
    let read = out.clone();
    let got = pdfium()
        .run_on_worker(move |ctx| {
            let b = ctx.bindings();
            unsafe {
                let doc = b.FPDF_LoadMemDocument64(&read, None);
                let page = b.FPDF_LoadPage(doc, 0);
                let a = b.FPDFPage_GetAnnot(page, 0);
                let n = b.FPDFAnnot_GetStringValue(a, annot::writer::REEDIT_KEY, std::ptr::null_mut(), 0) as usize;
                let mut buf = vec![0u16; n / 2];
                b.FPDFAnnot_GetStringValue(a, annot::writer::REEDIT_KEY, buf.as_mut_ptr(), n as _);
                b.FPDFPage_CloseAnnot(a);
                b.FPDF_ClosePage(page);
                b.FPDF_CloseDocument(doc);
                String::from_utf16_lossy(&buf[..buf.len().saturating_sub(1)])
            }
        })
        .unwrap();
    assert_eq!(got, model);

    // And PDFium still draws both annotations.
    let bb = ink_with_annots(out).expect("ink");
    assert_near(bb, (10.0, 60.0, 150.0, 190.0), 0.6, "squares");
}
