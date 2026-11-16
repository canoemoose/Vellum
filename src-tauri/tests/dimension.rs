//! Stage 5 of docs/editing-tool-consistency-brief.md: a Length pulled off its points and with
//! its value moved is saved with the standard keys (/LL, /LLE, /LLO, /CO; ISO 32000-1 12.5.6.7)
//! so other apps draw the same thing, they read back (annot/read.rs) for a file's existing line
//! dimensions, an in-line one writes none of them, and PDFium still draws Vellum's appearance.

mod print_common;

use lopdf::{Document, Object};
use print_common::*;
use std::sync::Arc;
use vellum_lib::annot::spec::Appearance;
use vellum_lib::annot::{self, AnnotSpec, Change, read};

fn blank() -> Vec<u8> {
    make_pdf(vec![page(300.0, 200.0, &[])])
}

/// A length from (20, 100) to (220, 100) with its dimension line 40 units above, drawn there.
fn pulled_out() -> AnnotSpec {
    AnnotSpec {
        page: 0,
        nm: "len".into(),
        subtype: "Line".into(),
        rect: [18.0, 95.0, 222.0, 150.0],
        appearance: Appearance { ops: "0 0 1 RG 2 w 20 140 m 220 140 l S".into(), bbox: [18.0, 95.0, 222.0, 150.0], ..Default::default() },
        colour: Some([0.0, 0.0, 1.0]),
        border_width: Some(0.75),
        line: Some([20.0, 100.0, 220.0, 100.0]),
        line_ends: Some(vec!["Slash".into(), "Slash".into()]),
        intent: Some("LineDimension".into()),
        contents: Some("7.06 m".into()),
        caption: Some(true),
        leader: Some([40.0, 3.0, 2.0]),
        caption_offset: Some([12.5, -4.0]),
        ..Default::default()
    }
}

fn first_annot(out: &[u8]) -> lopdf::Dictionary {
    let doc = Document::load_mem(out).unwrap();
    let page = *doc.get_pages().get(&1).unwrap();
    let annots = match doc.get_dictionary(page).unwrap().get(b"Annots").unwrap() {
        Object::Reference(id) => doc.get_object(*id).unwrap().as_array().unwrap().clone(),
        o => o.as_array().unwrap().clone(),
    };
    doc.get_dictionary(annots[0].as_reference().unwrap()).unwrap().clone()
}

fn num(d: &lopdf::Dictionary, k: &[u8]) -> f64 {
    d.get(k).unwrap().as_float().map(|v| v as f64).or_else(|_| d.get(k).unwrap().as_i64().map(|v| v as f64)).unwrap()
}

#[test]
fn a_pulled_out_dimension_writes_ll_lle_llo_and_co() {
    let out = annot::apply(blank(), "", &[Change::Add { spec: pulled_out() }]).unwrap();
    let a = first_annot(&out);
    assert_eq!(num(&a, b"LL"), 40.0);
    assert_eq!(num(&a, b"LLE"), 3.0);
    assert_eq!(num(&a, b"LLO"), 2.0);
    let co = a.get(b"CO").unwrap().as_array().unwrap();
    assert_eq!(co.len(), 2);
    assert!((co[0].as_float().unwrap() - 12.5).abs() < 1e-6 && (co[1].as_float().unwrap() + 4.0).abs() < 1e-6);
    let le: Vec<_> = a.get(b"LE").unwrap().as_array().unwrap().iter().map(|n| n.as_name().unwrap().to_vec()).collect();
    assert_eq!(le, vec![b"Slash".to_vec(), b"Slash".to_vec()]);
    // /L stays the measured points.
    let l: Vec<f64> = a.get(b"L").unwrap().as_array().unwrap().iter().map(|v| v.as_float().map(|f| f as f64).unwrap_or_else(|_| v.as_i64().unwrap() as f64)).collect();
    assert_eq!(l, vec![20.0, 100.0, 220.0, 100.0]);

    // PDFium draws Vellum's appearance: the dimension line where it was pulled out to.
    let r = vellum_lib::print::raster::SheetRenderer::open(pdfium(), Arc::new(out)).unwrap();
    let (w, h) = (1200, 800);
    let px = r.render_band(0, w, h, 0, 0, w, h, 0x01).unwrap();
    let bb = ink_bbox(&px, w, h).expect("ink");
    let bb = (bb.0 as f64 / 4.0, bb.1 as f64 / 4.0, bb.2 as f64 / 4.0, bb.3 as f64 / 4.0);
    // 140 up from the bottom of a 200 high page is 60 down from its top.
    assert_near(bb, (20.0, 59.0, 220.0, 61.0), 1.0, "pulled-out dimension line");
}

#[test]
fn the_keys_read_back() {
    let out = annot::apply(blank(), "", &[Change::Add { spec: pulled_out() }]).unwrap();
    let r = read::read(&out, "").unwrap();
    let a = &r.pages[0].annots[0];
    assert_eq!(a.leader, Some([40.0, 3.0, 2.0]));
    assert_eq!(a.caption_offset, Some([12.5, -4.0]));
    assert_eq!(a.intent.as_deref(), Some("LineDimension"));
}

#[test]
fn an_in_line_dimension_writes_none_of_them() {
    let mut s = pulled_out();
    s.leader = Some([0.0, 3.0, 2.0]);
    s.caption_offset = None;
    let out = annot::apply(blank(), "", &[Change::Add { spec: s }]).unwrap();
    let a = first_annot(&out);
    assert!(!a.has(b"LL") && !a.has(b"LLE") && !a.has(b"LLO") && !a.has(b"CO"));
    let r = read::read(&out, "").unwrap();
    assert_eq!((r.pages[0].annots[0].leader, r.pages[0].annots[0].caption_offset), (None, None));
}

#[test]
fn a_short_pull_writes_ll_alone() {
    let mut s = pulled_out();
    s.leader = Some([-1.5, 0.0, 0.0]);
    let a = first_annot(&annot::apply(blank(), "", &[Change::Add { spec: s }]).unwrap());
    assert_eq!(num(&a, b"LL"), -1.5);
    assert!(!a.has(b"LLE") && !a.has(b"LLO"));
}

#[test]
fn replacing_a_dimension_keeps_its_keys_current() {
    let out = annot::apply(blank(), "", &[Change::Add { spec: pulled_out() }]).unwrap();
    let mut s = pulled_out();
    s.leader = Some([-25.0, 3.0, 2.0]);
    s.caption_offset = None;
    let out = annot::apply(out, "", &[Change::Replace { spec: s }]).unwrap();
    let a = first_annot(&out);
    assert_eq!(num(&a, b"LL"), -25.0);
    assert!(!a.has(b"CO"));
}
