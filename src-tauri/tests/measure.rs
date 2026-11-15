//! Measuring (annot/measure.rs): a saved dimension carries /Measure, its intent and caption,
//! and PDFium still draws it; each page's /UserUnit reads back, and PDFium reports a
//! /UserUnit page's size in its own units (so the front end must scale by it, not PDFium).

mod print_common;

use lopdf::{Document, Object, dictionary};
use print_common::*;
use std::sync::Arc;
use vellum_lib::annot::measure::{MeasureSpec, user_units};
use vellum_lib::annot::spec::Appearance;
use vellum_lib::annot::{self, AnnotSpec, Change};

fn blank() -> Vec<u8> {
    make_pdf(vec![page(300.0, 200.0, &[])])
}

/// A length dimension from (20, 100) to (220, 100), drawn as a 2 pt blue line.
fn length() -> AnnotSpec {
    AnnotSpec {
        page: 0,
        nm: "len".into(),
        subtype: "Line".into(),
        rect: [18.0, 95.0, 222.0, 105.0],
        appearance: Appearance { ops: "0 0 1 RG 2 w 20 100 m 220 100 l S".into(), bbox: [18.0, 95.0, 222.0, 105.0], ..Default::default() },
        colour: Some([0.0, 0.0, 1.0]),
        border_width: Some(0.75),
        line: Some(vec![20.0, 100.0, 220.0, 100.0].try_into().unwrap()),
        line_ends: Some(vec!["Butt".into(), "Butt".into()]),
        intent: Some("LineDimension".into()),
        contents: Some("7.06 m".into()),
        measure: Some(MeasureSpec { ratio: "1:100".into(), unit: "m".into(), factor: 0.0352778, precision: 100, ..Default::default() }),
        caption: Some(true),
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

#[test]
fn a_saved_dimension_carries_its_measure_intent_and_caption() {
    let out = annot::apply(blank(), "", &[Change::Add { spec: length() }]).unwrap();
    let a = first_annot(&out);
    assert_eq!(a.get(b"IT").unwrap().as_name().unwrap(), b"LineDimension");
    assert!(a.get(b"Cap").unwrap().as_bool().unwrap());
    assert_eq!(a.get(b"CP").unwrap().as_name().unwrap(), b"Top");
    let m = a.get(b"Measure").unwrap().as_dict().unwrap();
    assert_eq!(m.get(b"Type").unwrap().as_name().unwrap(), b"Measure");
    assert_eq!(m.get(b"Subtype").unwrap().as_name().unwrap(), b"RL");
    assert_eq!(m.get(b"R").unwrap().as_str().unwrap(), b"1:100");
    let x = m.get(b"X").unwrap().as_array().unwrap()[0].as_dict().unwrap();
    assert_eq!(x.get(b"U").unwrap().as_str().unwrap(), b"m");
    assert!((x.get(b"C").unwrap().as_float().unwrap() - 0.0352778).abs() < 1e-6);
    assert_eq!(x.get(b"D").unwrap().as_i64().unwrap(), 100);
    let area = m.get(b"A").unwrap().as_array().unwrap()[0].as_dict().unwrap();
    assert_eq!(area.get(b"U").unwrap().as_str().unwrap(), b"sq m");

    // PDFium draws the dimension from Vellum's appearance.
    let r = vellum_lib::print::raster::SheetRenderer::open(pdfium(), Arc::new(out)).unwrap();
    let (w, h) = (1200, 800);
    let px = r.render_band(0, w, h, 0, 0, w, h, 0x01).unwrap();
    let bb = ink_bbox(&px, w, h).expect("ink");
    let bb = (bb.0 as f64 / 4.0, bb.1 as f64 / 4.0, bb.2 as f64 / 4.0, bb.3 as f64 / 4.0);
    assert_near(bb, (20.0, 99.0, 220.0, 101.0), 1.0, "dimension line");
}

#[test]
fn a_markup_without_a_measure_gets_none() {
    let mut s = length();
    s.measure = None;
    s.caption = None;
    s.intent = None;
    let a = first_annot(&annot::apply(blank(), "", &[Change::Add { spec: s }]).unwrap());
    assert!(!a.has(b"Measure") && !a.has(b"Cap") && !a.has(b"IT"));
}

/// Two pages, 300 x 200 units; the second has /UserUnit 10 (so 3000 x 2000 points).
fn user_unit_pdf() -> Vec<u8> {
    let mut doc = Document::with_version("1.6");
    let pages_id = doc.new_object_id();
    let content = doc.add_object(lopdf::Stream::new(dictionary! {}, b"0 0 1 rg 10 10 50 50 re f".to_vec()));
    let p1 = doc.add_object(dictionary! { "Type" => "Page", "Parent" => pages_id, "MediaBox" => vec![0.into(), 0.into(), 300.into(), 200.into()], "Contents" => content });
    let p2 = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => pages_id, "MediaBox" => vec![0.into(), 0.into(), 300.into(), 200.into()], "Contents" => content,
        "UserUnit" => Object::Real(10.0),
    });
    doc.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![p1.into(), p2.into()], "Count" => 2 }));
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

#[test]
fn user_units_read_back_per_page() {
    assert_eq!(user_units(&user_unit_pdf(), "").unwrap(), vec![1.0, 10.0]);
    assert_eq!(user_units(&blank(), "").unwrap(), vec![1.0]);
}

#[test]
fn pdfium_reports_a_user_unit_page_in_its_own_units() {
    // If PDFium ever scales by /UserUnit, the front end's own scaling would count it twice.
    let sizes = page_sizes(Arc::new(user_unit_pdf()));
    assert_eq!(sizes.len(), 2);
    assert!((sizes[1].0 - 300.0).abs() < 0.01 && (sizes[1].1 - 200.0).abs() < 0.01, "{:?}", sizes[1]);
}
