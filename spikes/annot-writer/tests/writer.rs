//! The writer's guarantees, on PDFs built here (no external files) plus the encrypted fixture
//! when it exists. The full matrix (synthetic files, every fixture, qpdf and pyHanko) is the
//! `samples` command and `verify.py`; these are the fast checks.

use std::sync::Mutex;

use annot_writer_spike::appearance::{BBox, Style};
use annot_writer_spike::demo;
use annot_writer_spike::pdfium_check::Pdfium;
use annot_writer_spike::writer::{Markup, Writer};
use lopdf::{Document, Object, Stream, dictionary};

// PDFium keeps its state in globals: one test at a time may use it.
static PDFIUM: Mutex<()> = Mutex::new(());

/// A two-page A4 document with a line on each page, saved with a classic cross-reference
/// table or with object streams and a cross-reference stream.
fn tiny_pdf(modern: bool) -> Vec<u8> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut kids = vec![];
    for i in 0..2 {
        let content = doc.add_object(Stream::new(dictionary! {}, format!("{} w 50 50 m 545 792 l S", i + 1).into_bytes()));
        let page = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "Contents" => content,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        });
        kids.push(Object::Reference(page));
    }
    doc.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => 2 }));
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    let mut out = Vec::new();
    if modern {
        doc.save_modern(&mut out).unwrap();
    } else {
        doc.reference_table.cross_reference_type = lopdf::xref::XrefType::CrossReferenceTable;
        doc.save_to(&mut out).unwrap();
    }
    out
}

fn add_demo(w: &mut Writer, page: usize, tag: &str) -> Vec<String> {
    let (b, _) = w.page_box(page).unwrap();
    demo::markups(b[0], b[1], b[2] - b[0], b[3] - b[1])
        .into_iter()
        .map(|(name, m)| {
            let nm = format!("{tag}-{name}");
            w.add(page, &m, &demo::meta(nm.clone())).unwrap();
            nm
        })
        .collect()
}

fn pdfium_nms(bytes: &[u8], pw: Option<&str>, page: usize) -> Vec<String> {
    let _g = PDFIUM.lock().unwrap();
    let p = Pdfium::load().expect("pdfium.dll: run node tools/fetch-pdfium.mjs");
    let d = p.open(bytes.to_vec(), pw).unwrap();
    let pg = d.page(page).unwrap();
    pg.annots().into_iter().flatten().map(|a| a.nm).collect()
}

#[test]
fn append_leaves_the_original_bytes_untouched_and_reads_back() {
    for modern in [false, true] {
        let orig = tiny_pdf(modern);
        let mut w = Writer::open(orig.clone(), "").unwrap();
        assert_eq!(w.info.xref_stream, modern);
        let nms = add_demo(&mut w, 1, "t");
        let out = w.save().unwrap();
        assert_eq!(&out[..orig.len()], &orig[..], "original bytes changed (modern={modern})");
        assert!(out.len() - orig.len() < 64 * 1024, "update unexpectedly large");
        // lopdf reads its own output.
        let w2 = Writer::open(out.clone(), "").unwrap();
        let read: Vec<String> = w2.annots(1).unwrap().into_iter().filter_map(|e| e.nm).collect();
        assert_eq!(read, nms);
        assert!(w2.annots(0).unwrap().is_empty(), "page 1 should be untouched");
        // PDFium, the renderer, sees the same annotations in the same order.
        assert_eq!(pdfium_nms(&out, None, 1), nms);
    }
}

#[test]
fn saves_chain_and_each_keeps_the_previous_bytes() {
    let orig = tiny_pdf(true);
    let mut w = Writer::open(orig.clone(), "").unwrap();
    let first = add_demo(&mut w, 0, "first");
    let out1 = w.save().unwrap();
    let mut w = Writer::open(out1.clone(), "").unwrap();
    let second = add_demo(&mut w, 0, "second");
    let out2 = w.save().unwrap();
    assert_eq!(&out2[..out1.len()], &out1[..]);
    let all: Vec<String> = first.into_iter().chain(second).collect();
    assert_eq!(pdfium_nms(&out2, None, 0), all);
}

#[test]
fn replace_keeps_the_object_number_and_delete_removes_the_entry() {
    let orig = tiny_pdf(false);
    let mut w = Writer::open(orig, "").unwrap();
    add_demo(&mut w, 0, "a");
    let out = w.save().unwrap();
    let mut w = Writer::open(out, "").unwrap();
    let before = w.annots(0).unwrap();
    let moved = Markup::Rect { rect: BBox([10.0, 10.0, 60.0, 40.0]), style: Style::stroke(demo::RED, 1.0) };
    let id = w.replace(0, 1, &moved, &demo::meta("a-rectangle".into())).unwrap();
    assert_eq!(Some(id), before[1].id);
    w.delete(0, 0).unwrap();
    let out = w.save().unwrap();
    let w = Writer::open(out.clone(), "").unwrap();
    let after = w.annots(0).unwrap();
    assert_eq!(after.len(), before.len() - 1);
    assert_eq!(after[0].id, before[1].id);
    let r = after[0].rect.unwrap();
    assert!(r[0] < 10.0 && r[2] > 60.0 && r[2] < 70.0, "{r:?}");
    assert_eq!(pdfium_nms(&out, None, 0).len(), before.len() - 1);
}

#[test]
fn encrypted_update_is_encrypted() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../bench-output/annot-spike/fixtures/a3-aes256-userpw.pdf");
    let Ok(orig) = std::fs::read(&fixture) else {
        eprintln!("skipped: {} not found (run fixtures.py)", fixture.display());
        return;
    };
    assert!(Writer::open(orig.clone(), "wrong").is_err(), "a wrong password must not open it");
    let mut w = Writer::open(orig.clone(), "vellum").unwrap();
    assert!(w.info.encryption.is_some());
    let nms = add_demo(&mut w, 0, "secret");
    let out = w.save().unwrap();
    let tail = &out[orig.len()..];
    assert!(!tail.windows(6).any(|x| x == b"secret"), "annotation text written in the clear");
    // Names such as /Helv are never encrypted (ISO 32000-1, 7.6.2); stream content is.
    assert!(!tail.windows(4).any(|x| x == b" Tf
" || x == b" re
"), "appearance stream written in the clear");
    assert_eq!(pdfium_nms(&out, Some("vellum"), 0), nms);
}
