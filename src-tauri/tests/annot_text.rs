//! Phase 7a's annotations (docs/editing-phase7-scope.md): the multiply blend mode (highlighter
//! and text highlights), /QuadPoints, a note's /Name, and a callout's /CL and single /LE, written
//! as specified and drawn by PDFium. Fixtures are built with PDFium.

mod print_common;

use print_common::*;
use std::sync::Arc;
use vellum_lib::annot::spec::Appearance;
use vellum_lib::annot::{self, AnnotSpec, Change};

/// A 300 x 200 page whose left half is black.
fn half_black() -> Vec<u8> {
    make_pdf(vec![page(300.0, 200.0, &[(0.0, 0.0, 150.0, 200.0)])])
}

/// A yellow box over (50, 50)-(250, 150), opaque, with the given blend mode.
fn yellow(nm: &str, blend: Option<&str>) -> AnnotSpec {
    let r = [50.0, 50.0, 250.0, 150.0];
    AnnotSpec {
        page: 0,
        nm: nm.into(),
        subtype: "Highlight".into(),
        rect: r,
        appearance: Appearance { ops: "q 1 1 0 rg /GS0 gs 50 50 200 100 re f Q".into(), bbox: r, ..Default::default() },
        colour: Some([1.0, 1.0, 0.0]),
        blend: blend.map(|b| b.to_string()),
        quad_points: Some(vec![50.0, 150.0, 250.0, 150.0, 50.0, 50.0, 250.0, 50.0]),
        ..Default::default()
    }
}

/// Pixel (B, G, R) at page point (x, y), y down, rendered with annotations at 2 px per point.
fn pixel(bytes: Vec<u8>, x: f64, y: f64) -> (u8, u8, u8) {
    let r = vellum_lib::print::raster::SheetRenderer::open(pdfium(), Arc::new(bytes)).unwrap();
    let (w, h) = (600, 400);
    let px = r.render_band(0, w, h, 0, 0, w, h, 0x01).unwrap();
    let i = (((y * 2.0) as i32 * w + (x * 2.0) as i32) * 4) as usize;
    (px[i], px[i + 1], px[i + 2])
}

fn dict_of(out: &[u8], index: usize) -> lopdf::Dictionary {
    let doc = lopdf::Document::load_mem(out).unwrap();
    let page = *doc.get_pages().get(&1).unwrap();
    let annots = match doc.get_dictionary(page).unwrap().get(b"Annots").unwrap() {
        lopdf::Object::Reference(id) => doc.get_object(*id).unwrap().as_array().unwrap().clone(),
        o => o.as_array().unwrap().clone(),
    };
    doc.get_dictionary(annots[index].as_reference().unwrap()).unwrap().clone()
}

/// The /GS0 of annotation `index`'s normal appearance.
fn gs0(out: &[u8], index: usize) -> lopdf::Dictionary {
    let doc = lopdf::Document::load_mem(out).unwrap();
    let d = dict_of(out, index);
    let ap = d.get(b"AP").unwrap().as_dict().unwrap().get(b"N").unwrap().as_reference().unwrap();
    let st = doc.get_object(ap).unwrap().as_stream().unwrap();
    let res = st.dict.get(b"Resources").unwrap().as_dict().unwrap();
    res.get(b"ExtGState").unwrap().as_dict().unwrap().get(b"GS0").unwrap().as_dict().unwrap().clone()
}

#[test]
fn multiply_darkens_what_is_under_it_and_normal_covers_it() {
    let out = annot::apply(half_black(), "", &[Change::Add { spec: yellow("hl", Some("Multiply")) }]).unwrap();
    // Written: /GS0 made for the blend alone (the appearance had no opacity), with /BM.
    assert_eq!(gs0(&out, 0).get(b"BM").unwrap().as_name().unwrap(), b"Multiply");
    // Over black it stays black; over white it's yellow.
    let (b, g, r) = pixel(out.clone(), 100.0, 100.0);
    assert!(r < 40 && g < 40 && b < 40, "multiply over black: {r} {g} {b}");
    let (b, g, r) = pixel(out, 200.0, 100.0);
    assert!(r > 200 && g > 200 && b < 60, "multiply over white: {r} {g} {b}");

    // Without a blend mode the same yellow covers the black.
    let mut plain = yellow("plain", None);
    plain.appearance.opacity = Some(1.0);
    let out = annot::apply(half_black(), "", &[Change::Add { spec: plain }]).unwrap();
    assert!(gs0(&out, 0).get(b"BM").is_err());
    let (b, g, r) = pixel(out, 100.0, 100.0);
    assert!(r > 200 && g > 200 && b < 60, "normal over black: {r} {g} {b}");
}

#[test]
fn the_blend_joins_an_existing_opacity() {
    let mut s = yellow("hl", Some("Multiply"));
    s.appearance.opacity = Some(0.4);
    s.appearance.fill_opacity = Some(0.4);
    let out = annot::apply(half_black(), "", &[Change::Add { spec: s }]).unwrap();
    let g = gs0(&out, 0);
    assert_eq!(g.get(b"BM").unwrap().as_name().unwrap(), b"Multiply");
    assert!((g.get(b"ca").unwrap().as_float().unwrap() - 0.4).abs() < 1e-4);
}

#[test]
fn quad_points_a_note_icon_and_a_callout_line_are_written() {
    let mut note = yellow("note", None);
    note.subtype = "Text".into();
    note.quad_points = None;
    note.icon = Some("Comment".into());
    note.contents = Some("Check this".into());
    note.flags = Some(28);
    let mut callout = yellow("callout", None);
    callout.subtype = "FreeText".into();
    callout.quad_points = None;
    callout.intent = Some("FreeTextCallout".into());
    callout.callout = Some(vec![10.0, 10.0, 40.0, 60.0, 50.0, 60.0]);
    callout.line_ends = Some(vec!["OpenArrow".into()]);
    callout.inset = Some([40.0, 40.0, 0.0, 0.0]);
    let out = annot::apply(half_black(), "", &[Change::Add { spec: yellow("hl", Some("Multiply")) }, Change::Add { spec: note }, Change::Add { spec: callout }]).unwrap();

    let hl = dict_of(&out, 0);
    let q: Vec<f32> = hl.get(b"QuadPoints").unwrap().as_array().unwrap().iter().map(|o| o.as_float().unwrap()).collect();
    assert_eq!(q, vec![50.0, 150.0, 250.0, 150.0, 50.0, 50.0, 250.0, 50.0]);
    assert_eq!(hl.get(b"Subtype").unwrap().as_name().unwrap(), b"Highlight");

    let n = dict_of(&out, 1);
    assert_eq!(n.get(b"Name").unwrap().as_name().unwrap(), b"Comment");
    assert_eq!(n.get(b"F").unwrap().as_i64().unwrap(), 28);
    assert!(n.get(b"QuadPoints").is_err());

    let c = dict_of(&out, 2);
    assert_eq!(c.get(b"IT").unwrap().as_name().unwrap(), b"FreeTextCallout");
    assert_eq!(c.get(b"CL").unwrap().as_array().unwrap().len(), 6);
    // A callout's /LE is one name, not a pair.
    assert_eq!(c.get(b"LE").unwrap().as_name().unwrap(), b"OpenArrow");
    assert_eq!(c.get(b"RD").unwrap().as_array().unwrap().len(), 4);

    // PDFium reads all three back as their types, and the note's text.
    let read = out.clone();
    let got = pdfium()
        .run_on_worker(move |ctx| {
            let b = ctx.bindings();
            unsafe {
                let doc = b.FPDF_LoadMemDocument64(&read, None);
                let page = b.FPDF_LoadPage(doc, 0);
                let mut out = Vec::new();
                for i in 0..b.FPDFPage_GetAnnotCount(page) {
                    let a = b.FPDFPage_GetAnnot(page, i);
                    let st = b.FPDFAnnot_GetSubtype(a);
                    let mut buf = vec![0u16; 64];
                    let n = b.FPDFAnnot_GetStringValue(a, "Contents", buf.as_mut_ptr(), 128) as usize;
                    out.push((st, String::from_utf16_lossy(&buf[..(n / 2).saturating_sub(1)]), b.FPDFAnnot_CountAttachmentPoints(a)));
                    b.FPDFPage_CloseAnnot(a);
                }
                b.FPDF_ClosePage(page);
                b.FPDF_CloseDocument(doc);
                out
            }
        })
        .unwrap();
    // FPDF_ANNOT_HIGHLIGHT 9, FPDF_ANNOT_TEXT 1, FPDF_ANNOT_FREETEXT 3.
    assert_eq!(got.iter().map(|g| g.0).collect::<Vec<_>>(), vec![9, 1, 3]);
    assert_eq!(got[0].2, 1, "one quad");
    assert_eq!(got[1].1, "Check this");
}

#[test]
fn pdfium_draws_a_note_and_a_callout_from_their_own_appearance() {
    // Each alone on a white page: the note at (20, 160)-(40, 180), the callout's box at
    // (150, 20)-(270, 60) with its leader down to (100, 100), y up.
    let blank = make_pdf(vec![page(300.0, 200.0, &[])]);
    let note = AnnotSpec {
        page: 0,
        nm: "note".into(),
        subtype: "Text".into(),
        rect: [20.0, 160.0, 40.0, 180.0],
        appearance: Appearance { ops: "0 0 1 rg 20 160 20 20 re f".into(), bbox: [20.0, 160.0, 40.0, 180.0], ..Default::default() },
        contents: Some("Check".into()),
        icon: Some("Note".into()),
        flags: Some(12),
        ..Default::default()
    };
    let callout = AnnotSpec {
        page: 0,
        nm: "callout".into(),
        subtype: "FreeText".into(),
        rect: [99.0, 19.0, 271.0, 101.0],
        appearance: Appearance { ops: "0 0 1 RG 2 w 100 100 m 150 40 l S 0 0 1 rg 150 20 120 40 re f".into(), bbox: [99.0, 19.0, 271.0, 101.0], ..Default::default() },
        intent: Some("FreeTextCallout".into()),
        callout: Some(vec![100.0, 100.0, 150.0, 40.0]),
        line_ends: Some(vec!["OpenArrow".into()]),
        inset: Some([51.0, 1.0, 1.0, 41.0]),
        ..Default::default()
    };
    let (b, g, r) = pixel(annot::apply(blank.clone(), "", &[Change::Add { spec: note }]).unwrap(), 30.0, 30.0);
    assert!(b > 200 && r < 60 && g < 60, "note drawn: {r} {g} {b}");
    let out = annot::apply(blank, "", &[Change::Add { spec: callout }]).unwrap();
    let (b, g, r) = pixel(out.clone(), 200.0, 160.0);
    assert!(b > 200 && r < 60 && g < 60, "callout box drawn: {r} {g} {b}");
    // The leader, halfway along: (125, 70) y up is (125, 130) y down.
    let (b, _, r) = pixel(out, 125.0, 130.0);
    assert!(b > 150 && r < 120, "callout leader drawn: {r} {b}");
}
