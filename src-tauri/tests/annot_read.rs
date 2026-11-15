//! Phase 7b: reading the annotations a file already holds (annot/read.rs), hiding them in
//! PDFium by position, and the writer finding, replacing, deleting and moving them by their
//! position as read. Fixtures are built here with PDFium and lopdf.

mod print_common;

use lopdf::{Document, Object, dictionary};
use print_common::*;
use vellum_lib::annot::spec::Appearance;
use vellum_lib::annot::{self, AnnotSpec, Change, read};

fn blank() -> Vec<u8> {
    make_pdf(vec![page(300.0, 200.0, &[])])
}

/// A spec with every key the kinds write, so each is seen to come back.
fn full(nm: &str) -> AnnotSpec {
    AnnotSpec {
        page: 0,
        nm: nm.into(),
        subtype: "FreeText".into(),
        rect: [10.0, 20.0, 110.0, 70.0],
        appearance: Appearance { ops: "0 0 1 RG 10 20 100 50 re S".into(), bbox: [10.0, 20.0, 110.0, 70.0], ..Default::default() },
        author: Some("Matt James".into()),
        modified: Some("D:20261115100000Z".into()),
        created: Some("D:20261114090000Z".into()),
        contents: Some("Check £ and ✓".into()),
        flags: Some(4),
        colour: Some([0.1, 0.2, 0.3]),
        interior: Some([1.0, 1.0, 0.0]),
        opacity: Some(0.5),
        border_width: Some(1.5),
        dash: Some(vec![3.0, 2.0]),
        line: Some([10.0, 20.0, 110.0, 70.0]),
        line_ends: Some(vec!["OpenArrow".into()]),
        vertices: Some(vec![10.0, 20.0, 60.0, 70.0, 110.0, 20.0]),
        ink: Some(vec![vec![10.0, 20.0, 30.0, 40.0], vec![50.0, 60.0]]),
        cloud: Some(1.0),
        intent: Some("FreeTextCallout".into()),
        default_appearance: Some("0 0 0 rg /Helv 10 Tf".into()),
        default_style: Some("font: 10pt Helvetica".into()),
        quadding: Some(1),
        inset: Some([1.0, 2.0, 3.0, 4.0]),
        rotate: Some(90),
        callout: Some(vec![200.0, 100.0, 150.0, 80.0, 110.0, 45.0]),
        vellum: Some(r#"{"v":1,"m":"D:20261115100000Z","markup":{"text":"£"}}"#.into()),
        quad_points: Some(vec![10.0, 70.0, 110.0, 70.0, 10.0, 20.0, 110.0, 20.0]),
        icon: Some("Note".into()),
        ..Default::default()
    }
}

#[test]
fn every_key_vellum_writes_reads_back() {
    let out = annot::apply(blank(), "", &[Change::Add { spec: full("vellum-a") }]).unwrap();
    let r = read::read(&out, "").unwrap();
    assert_eq!(r.pages.len(), 1);
    let p = &r.pages[0];
    assert_eq!(p.page, 0);
    assert_eq!(p.frame.quarter_turns, 0);
    assert_eq!(p.frame.bbox, [0.0, 0.0, 300.0, 200.0]);
    let a = &p.annots[0];
    let s = full("vellum-a");
    let near = |a: &[f64], b: &[f64]| a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-3);
    assert_eq!(a.index, 0);
    assert_eq!(a.subtype, "FreeText");
    assert_eq!(a.nm.as_deref(), Some("vellum-a"));
    assert!(near(&a.rect, &s.rect));
    assert_eq!(a.flags, 4);
    assert!(near(a.colour.as_ref().unwrap(), &s.colour.unwrap()));
    assert!(near(a.interior.as_ref().unwrap(), &s.interior.unwrap()));
    assert!((a.opacity.unwrap() - 0.5).abs() < 1e-6);
    assert_eq!(a.border_width, Some(1.5));
    assert!(near(a.dash.as_ref().unwrap(), &[3.0, 2.0]));
    assert_eq!(a.cloud, Some(1.0));
    assert!(near(&a.line.unwrap(), &s.line.unwrap()));
    assert_eq!(a.line_ends.as_deref(), Some(&["OpenArrow".to_string()][..]));
    assert!(near(a.vertices.as_ref().unwrap(), s.vertices.as_ref().unwrap()));
    let ink = a.ink.as_ref().unwrap();
    assert_eq!(ink.len(), 2);
    assert!(near(&ink[1], &[50.0, 60.0]));
    assert!(near(a.quad_points.as_ref().unwrap(), s.quad_points.as_ref().unwrap()));
    assert!(near(a.callout.as_ref().unwrap(), s.callout.as_ref().unwrap()));
    assert!(near(&a.inset.unwrap(), &[1.0, 2.0, 3.0, 4.0]));
    assert_eq!(a.intent.as_deref(), Some("FreeTextCallout"));
    assert_eq!(a.contents.as_deref(), Some("Check £ and ✓"));
    assert_eq!(a.author.as_deref(), Some("Matt James"));
    assert_eq!(a.modified.as_deref(), Some("D:20261115100000Z"));
    assert_eq!(a.created.as_deref(), Some("D:20261114090000Z"));
    assert_eq!(a.default_appearance, s.default_appearance);
    assert_eq!(a.default_style, s.default_style);
    assert_eq!(a.quadding, Some(1));
    assert_eq!(a.rotate, Some(90));
    assert_eq!(a.name.as_deref(), Some("Note"));
    assert_eq!(a.vellum, s.vellum, "the private entry, non-ASCII included");
    assert!(!a.measured);
}

/// A page whose /Annots is awkward on purpose, as phase 0's fixture was: an indirect array
/// holding a square with /NM, its Popup, a null, an inline circle with no /NM, a hidden one, a
/// reply, a link, and a line. Returns the file and the positions of the markups in /Annots.
fn awkward(object_streams: bool) -> Vec<u8> {
    let mut doc = Document::load_mem(&blank()).unwrap();
    let page = *doc.get_pages().values().next().unwrap();
    let ap = |doc: &mut Document, ops: &str, r: [f64; 4]| {
        let st = lopdf::Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Form", "BBox" => r.iter().map(|v| Object::Real(*v as f32)).collect::<Vec<_>>() },
            ops.as_bytes().to_vec(),
        );
        doc.add_object(st)
    };
    let rect = |r: [f64; 4]| Object::Array(r.iter().map(|v| Object::Real(*v as f32)).collect());
    let sq_ap = ap(&mut doc, "1 0 0 rg 10 10 40 30 re f", [10.0, 10.0, 50.0, 40.0]);
    let square = doc.add_object(dictionary! {
        "Type" => "Annot", "Subtype" => "Square", "Rect" => rect([10.0, 10.0, 50.0, 40.0]), "NM" => Object::string_literal("sq"),
        "C" => vec![1.into(), 0.into(), 0.into()], "T" => Object::string_literal("Someone"), "F" => 4,
        "AP" => dictionary! { "N" => sq_ap },
    });
    let popup = doc.add_object(dictionary! { "Type" => "Annot", "Subtype" => "Popup", "Rect" => rect([60.0, 60.0, 160.0, 120.0]), "Parent" => square });
    doc.get_object_mut(square).unwrap().as_dict_mut().unwrap().set("Popup", popup);
    let circle_ap = ap(&mut doc, "0 0 1 rg 100 10 40 30 re f", [100.0, 10.0, 140.0, 40.0]);
    let circle = dictionary! {
        "Type" => "Annot", "Subtype" => "Circle", "Rect" => rect([100.0, 10.0, 140.0, 40.0]), "C" => vec![0.into(), 0.into(), 1.into()],
        "BS" => dictionary! { "W" => 2, "S" => "D", "D" => vec![4.into(), 2.into()] }, "F" => 4, "AP" => dictionary! { "N" => circle_ap },
    };
    let hidden = doc.add_object(dictionary! { "Type" => "Annot", "Subtype" => "Square", "Rect" => rect([0.0, 0.0, 5.0, 5.0]), "F" => 2 });
    let reply = doc.add_object(dictionary! { "Type" => "Annot", "Subtype" => "Text", "Rect" => rect([0.0, 0.0, 5.0, 5.0]), "IRT" => square, "Contents" => Object::string_literal("Agreed") });
    let link = doc.add_object(dictionary! { "Type" => "Annot", "Subtype" => "Link", "Rect" => rect([0.0, 0.0, 5.0, 5.0]) });
    let line_ap = ap(&mut doc, "0 g 1 w 150 150 m 250 180 l S", [150.0, 150.0, 250.0, 180.0]);
    let line = doc.add_object(dictionary! {
        "Type" => "Annot", "Subtype" => "Line", "Rect" => rect([148.0, 148.0, 252.0, 182.0]), "L" => vec![150.into(), 150.into(), 250.into(), 180.into()],
        "LE" => vec![Object::Name(b"None".to_vec()), Object::Name(b"ClosedArrow".to_vec())], "Border" => vec![0.into(), 0.into(), 3.into()], "F" => 4,
        "AP" => dictionary! { "N" => line_ap },
    });
    let arr = doc.add_object(Object::Array(vec![
        square.into(),
        popup.into(),
        Object::Null,
        Object::Dictionary(circle),
        hidden.into(),
        reply.into(),
        link.into(),
        line.into(),
    ]));
    doc.get_object_mut(page).unwrap().as_dict_mut().unwrap().set("Annots", arr);
    let mut out = Vec::new();
    if object_streams {
        doc.save_modern(&mut out).unwrap();
    } else {
        doc.save_to(&mut out).unwrap();
    }
    out
}

#[test]
fn an_awkward_annots_array_reads_each_markup_at_pdfiums_position() {
    for objstm in [false, true] {
        let bytes = awkward(objstm);
        let r = read::read(&bytes, "").unwrap();
        let a = &r.pages[0].annots;
        // Popup, null, hidden, reply and link are left out; positions count every entry.
        assert_eq!(a.iter().map(|x| (x.index, x.subtype.as_str())).collect::<Vec<_>>(), vec![(0, "Square"), (3, "Circle"), (7, "Line")], "object streams: {objstm}");
        assert_eq!(a[0].nm.as_deref(), Some("sq"));
        assert_eq!(a[0].author.as_deref(), Some("Someone"));
        assert_eq!(a[1].nm, None);
        assert_eq!(a[1].border_width, Some(2.0));
        assert_eq!(a[1].dash.as_deref(), Some(&[4.0, 2.0][..]));
        assert_eq!(a[2].border_width, Some(3.0), "the old /Border array");
        assert_eq!(a[2].line_ends.as_deref(), Some(&["None".to_string(), "ClosedArrow".to_string()][..]));
        // PDFium agrees on what is where.
        let subtypes = pdfium()
            .run_on_worker(move |ctx| {
                let b = ctx.bindings();
                unsafe {
                    let doc = b.FPDF_LoadMemDocument64(&bytes, None);
                    let page = b.FPDF_LoadPage(doc, 0);
                    let out: Vec<i32> = (0..b.FPDFPage_GetAnnotCount(page))
                        .map(|i| {
                            let a = b.FPDFPage_GetAnnot(page, i);
                            let s = if a.is_null() { -1 } else { b.FPDFAnnot_GetSubtype(a) };
                            if !a.is_null() {
                                b.FPDFPage_CloseAnnot(a);
                            }
                            s
                        })
                        .collect();
                    b.FPDF_ClosePage(page);
                    b.FPDF_CloseDocument(doc);
                    out
                }
            })
            .unwrap();
        // FPDF_ANNOT_SQUARE 5, CIRCLE 6, LINE 4.
        assert_eq!((subtypes[0], subtypes[3], subtypes[7]), (5, 6, 4), "PDFium's index is the position: {subtypes:?}");
    }
}

#[test]
fn hiding_by_position_works_with_popups_and_nulls() {
    let (id, _) = open_fixture("annot-read-hide", &awkward(false));
    let flags = |id: u64| -> Vec<i32> {
        pdfium()
            .run_on_worker_index(0, move |ctx| {
                let b = ctx.bindings();
                let p = ctx.page(id, 0).unwrap();
                unsafe {
                    (0..b.FPDFPage_GetAnnotCount(p))
                        .map(|i| {
                            let a = b.FPDFPage_GetAnnot(p, i);
                            let f = if a.is_null() { -1 } else { b.FPDFAnnot_GetFlags(a) };
                            if !a.is_null() {
                                b.FPDFPage_CloseAnnot(a);
                            }
                            f
                        })
                        .collect()
                }
            })
            .unwrap()
    };
    // The inline circle (no /NM) at 3 and the line at 7.
    assert_eq!(docs().hide_annots(pdfium(), id, 0, vec![], vec![3, 7], true).unwrap(), 2);
    let f = flags(id);
    assert!(f[3] & 2 != 0 && f[7] & 2 != 0, "{f:?}");
    assert!(f[0] & 2 == 0, "the square isn't touched");
    // By /NM and by position together.
    assert_eq!(docs().hide_annots(pdfium(), id, 0, vec!["sq".into()], vec![3], false).unwrap(), 2);
    let f = flags(id);
    assert!(f[0] & 2 == 0 && f[3] & 2 == 0 && f[7] & 2 != 0, "{f:?}");
    docs().close(pdfium(), id);
}

#[test]
fn changes_find_an_annotation_by_its_position_as_read() {
    let bytes = awkward(true);
    let replace = AnnotSpec { page: 0, nm: "vellum-new".into(), subtype: "Circle".into(), rect: [100.0, 10.0, 140.0, 40.0], at: Some(3), ..full("x") };
    // Delete the square (with its popup) first: the circle and line move up, but are still
    // found by where they were.
    let out = annot::apply(
        bytes,
        "",
        &[
            Change::Delete { page: 0, nm: "sq".into(), at: Some(0) },
            Change::Replace { spec: AnnotSpec { appearance: Appearance { ops: "0 1 0 rg 100 10 40 30 re f".into(), bbox: [100.0, 10.0, 140.0, 40.0], ..Default::default() }, ..replace } },
            Change::Move { page: 0, nm: String::new(), at: Some(7), dx: 10.0, dy: -20.0, modified: Some("D:20261115120000Z".into()) },
        ],
    )
    .unwrap();
    let r = read::read(&out, "").unwrap();
    let a = &r.pages[0].annots;
    assert_eq!(a.iter().map(|x| x.subtype.as_str()).collect::<Vec<_>>(), vec!["Circle", "Line"]);
    // The inline circle is now an object of its own, carrying the new /NM.
    assert_eq!(a[0].nm.as_deref(), Some("vellum-new"));
    assert_eq!(a[0].index, 1, "square and popup gone: null, circle, ...");
    // The line moved with its appearance; nothing else about it changed.
    let l = &a[1];
    assert_eq!(l.line, Some([160.0, 130.0, 260.0, 160.0]));
    assert_eq!(l.rect, [158.0, 128.0, 262.0, 162.0]);
    assert_eq!(l.modified.as_deref(), Some("D:20261115120000Z"));
    assert_eq!(l.border_width, Some(3.0));
    // PDFium draws the moved line where it now is (its appearance followed its /Rect).
    let ink = {
        let r = vellum_lib::print::raster::SheetRenderer::open(pdfium(), std::sync::Arc::new(out.clone())).unwrap();
        let px = r.render_band(0, 1200, 800, 0, 0, 1200, 800, 0x01).unwrap();
        let (a, b, c, d) = ink_bbox(&px, 1200, 800).unwrap();
        (a as f64 / 4.0, b as f64 / 4.0, c as f64 / 4.0, d as f64 / 4.0)
    };
    // y down: user y 130..160 is 40..70 from the top; the circle (green now) sits lower left.
    assert!(ink.2 >= 255.0 && ink.2 <= 263.0, "line's right end at x 260: {ink:?}");
    assert!(ink.1 >= 35.0 && ink.1 <= 45.0, "line's top at 40: {ink:?}");
    // An unknown position is an error, not a silent no-op.
    assert!(annot::apply(out, "", &[Change::Delete { page: 0, nm: String::new(), at: Some(42) }]).is_err());
}

#[test]
fn reading_skips_stream_contents_but_keeps_what_object_streams_hold() {
    // A drawing with a lot of page content: the read finds its annotation (in an object
    // stream) all the same.
    let rects: Vec<(f64, f64, f64, f64)> = (0..2000).map(|i| ((i % 50) as f64 * 5.0, (i / 50) as f64 * 4.0, 3.0, 2.0)).collect();
    let base = make_pdf(vec![page(300.0, 200.0, &rects)]);
    let with = annot::apply(base, "", &[Change::Add { spec: full("dense") }]).unwrap();
    let mut doc = Document::load_mem(&with).unwrap();
    let mut modern = Vec::new();
    doc.save_modern(&mut modern).unwrap();
    for bytes in [with, modern] {
        let r = read::read(&bytes, "").unwrap();
        assert_eq!(r.pages[0].annots.len(), 1);
        assert_eq!(r.pages[0].annots[0].nm.as_deref(), Some("dense"));
    }
}

#[test]
fn a_rotated_cropped_page_reports_the_frame_pdfium_uses() {
    let mut doc = Document::load_mem(&annot::apply(blank(), "", &[Change::Add { spec: full("r") }]).unwrap()).unwrap();
    let page = *doc.get_pages().values().next().unwrap();
    let d = doc.get_object_mut(page).unwrap().as_dict_mut().unwrap();
    d.set("Rotate", 270);
    // A crop box sticking out past the media box is clipped to it, as PDFium does.
    d.set("CropBox", vec![(-10).into(), 20.into(), 280.into(), 400.into()]);
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    let r = read::read(&out, "").unwrap();
    assert_eq!(r.pages[0].frame.quarter_turns, 3);
    assert_eq!(r.pages[0].frame.bbox, [0.0, 20.0, 280.0, 200.0]);
    // And PDFium agrees.
    let (id, _) = open_fixture("annot-read-frame", &out);
    let f = docs().page_frame(pdfium(), id, 0).unwrap();
    docs().close(pdfium(), id);
    assert_eq!((f.quarter_turns, f.bbox), (3, [0.0, 20.0, 280.0, 200.0]));
}

#[test]
fn a_stamps_picture_is_read_back_and_reused_by_hash() {
    use vellum_lib::annot::image::{ImageRes, base64_decode, base64_encode};
    // A 2 x 1 PNG: one red pixel, one half-clear blue one.
    let img = image::RgbaImage::from_raw(2, 1, vec![255, 0, 0, 255, 0, 0, 255, 128]).unwrap();
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
    let hash = "ab".repeat(32);
    let stamp = |nm: &str, png: String| AnnotSpec {
        page: 0,
        nm: nm.into(),
        subtype: "Stamp".into(),
        rect: [10.0, 10.0, 50.0, 30.0],
        appearance: Appearance {
            ops: "q 40 0 0 20 10 10 cm /Imx Do Q".into(),
            bbox: [10.0, 10.0, 50.0, 30.0],
            images: [("Imx".to_string(), ImageRes { hash: hash.clone(), png })].into_iter().collect(),
            ..Default::default()
        },
        ..Default::default()
    };
    let once = annot::apply(blank(), "", &[Change::Add { spec: stamp("s1", base64_encode(&png)) }]).unwrap();
    let back = read::stamp_images(&once, "", &[hash.to_uppercase()]).unwrap();
    let got = image::load_from_memory(&base64_decode(&back[&hash]).unwrap()).unwrap().to_rgba8();
    assert_eq!(got.into_raw(), vec![255, 0, 0, 255, 0, 0, 255, 128]);
    // Replacing it with no picture at all reuses the one in the file.
    let twice = annot::apply(once.clone(), "", &[Change::Replace { spec: AnnotSpec { rect: [20.0, 20.0, 60.0, 40.0], ..stamp("s1", String::new()) } }]).unwrap();
    let added = &twice[once.len()..];
    assert!(!added.windows(6).any(|w| w == b"/Image"), "no second copy of the picture");
    assert_eq!(base64_encode(b"Ma"), "TWE=");
    assert_eq!(base64_decode(&base64_encode(&png)).unwrap(), png);
}
