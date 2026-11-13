//! The text layer, links and search (text.rs), and the frame that puts PDFium's user-space
//! boxes into Vellum's page coordinates. Fixtures are built with PDFium: black text at known
//! places on pages with /Rotate and an offset crop box; boxes are checked against where the
//! text's ink lands when the page is rendered.

mod print_common;

use pdfium_render::prelude::*;
use print_common::*;
use std::sync::Arc;
use vellum_lib::text::{Link, PageFrame, merge_links};

struct Spec {
    w: f64,
    h: f64,
    rotate: i32,
    crop: Option<(f32, f32, f32, f32)>,
    /// (text, x, y baseline in user space, size)
    text: Vec<(&'static str, f64, f64, f32)>,
    /// (user-space rect, uri)
    links: Vec<((f32, f32, f32, f32), &'static str)>,
}

fn build(spec: Spec) -> Vec<u8> {
    pdfium()
        .run_on_worker(move |ctx| {
            let b = ctx.bindings();
            unsafe {
                let doc = b.FPDF_CreateNewDocument();
                let page = b.FPDFPage_New(doc, 0, spec.w, spec.h);
                for &(s, x, y, size) in &spec.text {
                    let t = b.FPDFPageObj_NewTextObj(doc, "Helvetica", size);
                    let w: Vec<u16> = s.encode_utf16().chain(std::iter::once(0)).collect();
                    b.FPDFText_SetText(t, w.as_ptr());
                    b.FPDFPageObj_Transform(t, 1.0, 0.0, 0.0, 1.0, x, y);
                    b.FPDFPage_InsertObject(page, t);
                }
                for &((l, bo, r, t), uri) in &spec.links {
                    let a = b.FPDFPage_CreateAnnot(page, 2); // FPDF_ANNOT_LINK
                    let rect = FS_RECTF { left: l, top: t, right: r, bottom: bo };
                    b.FPDFAnnot_SetRect(a, &rect);
                    b.FPDFAnnot_SetURI(a, uri);
                    b.FPDFPage_CloseAnnot(a);
                }
                b.FPDFPage_GenerateContent(page);
                if let Some((l, bo, r, t)) = spec.crop {
                    b.FPDFPage_SetCropBox(page, l, bo, r, t);
                }
                if spec.rotate != 0 {
                    b.FPDFPage_SetRotation(page, spec.rotate);
                }
                b.FPDF_ClosePage(page);
                let out = vellum_lib::print::compose::save(b, doc).unwrap();
                b.FPDF_CloseDocument(doc);
                out
            }
        })
        .unwrap()
}

/// The text layer decoded: (code points, boxes, flags, links).
fn decode(bytes: &[u8]) -> (Vec<char>, Vec<[f32; 4]>, Vec<u8>, serde_json::Value) {
    let u32_at = |o: usize| u32::from_le_bytes(bytes[o..o + 4].try_into().unwrap());
    let f32_at = |o: usize| f32::from_le_bytes(bytes[o..o + 4].try_into().unwrap());
    let n = u32_at(0) as usize;
    let codes = (0..n).map(|i| char::from_u32(u32_at(4 + 4 * i)).unwrap_or('?')).collect();
    let bo = 4 + 4 * n;
    let boxes = (0..n).map(|i| [0, 1, 2, 3].map(|k| f32_at(bo + 16 * i + 4 * k))).collect();
    let fo = bo + 16 * n;
    let flags = bytes[fo..fo + n].to_vec();
    let jo = (fo + n).div_ceil(4) * 4;
    let len = u32_at(jo) as usize;
    let links = serde_json::from_slice(&bytes[jo + 4..jo + 4 + len]).unwrap();
    (codes, boxes, flags, links)
}

fn layer(bytes: &[u8], tag: &str) -> (Vec<char>, Vec<[f32; 4]>, Vec<u8>, serde_json::Value) {
    let (id, _) = open_fixture(tag, bytes);
    let raw = docs().text_layer(pdfium(), id, 0).unwrap();
    docs().close(pdfium(), id);
    decode(&raw)
}

/// Union of the boxes of the characters that have one.
fn union(boxes: &[[f32; 4]], flags: &[u8]) -> (f64, f64, f64, f64) {
    let mut u = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for (b, f) in boxes.iter().zip(flags) {
        if f & 2 != 0 {
            u = (u.0.min(b[0] as f64), u.1.min(b[1] as f64), u.2.max(b[2] as f64), u.3.max(b[3] as f64));
        }
    }
    u
}

fn contains(outer: (f64, f64, f64, f64), inner: (f64, f64, f64, f64), slack: f64) -> bool {
    outer.0 <= inner.0 + slack && outer.1 <= inner.1 + slack && outer.2 >= inner.2 - slack && outer.3 >= inner.3 - slack
}

#[test]
fn frame_maps_user_space_for_every_rotation() {
    // A 300 x 200 page whose box starts at (20, 10): user (20, 210) is its top-left corner.
    let f = |r| PageFrame::new(r, 20.0, 10.0, 320.0, 210.0);
    assert_eq!(f(0).to_page(20.0, 210.0), (0.0, 0.0));
    assert_eq!(f(0).to_page(320.0, 10.0), (300.0, 200.0));
    assert_eq!(f(0).size(), (300.0, 200.0));
    // Rotated a quarter turn clockwise: the bottom-left corner comes to the top-left.
    assert_eq!(f(1).size(), (200.0, 300.0));
    assert_eq!(f(1).to_page(20.0, 10.0), (0.0, 0.0));
    assert_eq!(f(1).to_page(20.0, 210.0), (200.0, 0.0));
    assert_eq!(f(2).to_page(20.0, 10.0), (300.0, 0.0));
    assert_eq!(f(3).to_page(20.0, 10.0), (200.0, 300.0));
    assert_eq!(f(-1), f(3));
    assert_eq!(f(0).rect(30.0, 200.0, 40.0, 190.0), [10.0, 10.0, 20.0, 20.0]);
}

#[test]
fn character_boxes_land_on_the_ink_whatever_the_rotation_and_crop() {
    for (rotate, crop) in [(0, None), (1, None), (2, None), (3, None), (0, Some((20.0, 10.0, 280.0, 190.0))), (1, Some((20.0, 10.0, 280.0, 190.0)))] {
        let bytes = build(Spec { w: 300.0, h: 200.0, rotate, crop, text: vec![("Hello Vellum", 60.0, 120.0, 20.0)], links: vec![] });
        let (codes, boxes, flags, _) = layer(&bytes, &format!("frame-{rotate}-{}", crop.is_some()));
        let s: String = codes.iter().collect();
        assert!(s.contains("Hello Vellum"), "text {s:?}");
        let sizes = page_sizes(Arc::new(bytes.clone()));
        let (pw, ph) = sizes[0];
        let ink = ink_bbox_pt(Arc::new(bytes), 0, pw, ph).expect("ink");
        let u = union(&boxes, &flags);
        // Loose boxes run from the font's ascent to its descent: they hold the ink and aren't
        // far off it.
        assert!(contains(u, ink, 0.6), "rotate {rotate} crop {crop:?}: boxes {u:?} don't hold ink {ink:?}");
        assert!(contains((ink.0 - 12.0, ink.1 - 12.0, ink.2 + 12.0, ink.3 + 12.0), u, 0.0), "rotate {rotate} crop {crop:?}: boxes {u:?} far from ink {ink:?}");
    }
}

#[test]
fn links_come_back_in_page_points_with_their_targets() {
    let bytes = build(Spec {
        w: 300.0,
        h: 200.0,
        rotate: 1,
        crop: None,
        text: vec![("Docs at www.example.com today", 20.0, 40.0, 10.0)],
        links: vec![((10.0, 150.0, 110.0, 180.0), "https://vellum.example/help")],
    });
    let (_, _, _, links) = layer(&bytes, "links");
    let links: Vec<Link> = serde_json::from_value::<Vec<serde_json::Value>>(links)
        .unwrap()
        .into_iter()
        .map(|v| Link {
            rects: serde_json::from_value(v["rects"].clone()).unwrap(),
            uri: v["uri"].as_str().map(String::from),
            page: v["page"].as_u64().map(|p| p as usize),
            y: v["y"].as_f64().map(|y| y as f32),
        })
        .collect();
    let annot = links.iter().find(|l| l.uri.as_deref() == Some("https://vellum.example/help")).expect("annotation link");
    // Rotated a quarter turn: user (x, y) -> page (y, x).
    assert_eq!(annot.rects, vec![[150.0, 10.0, 180.0, 110.0]]);
    let web = links.iter().find(|l| l.uri.as_deref().is_some_and(|u| u.contains("www.example.com"))).expect("web link from the text");
    assert!(!web.rects.is_empty() && web.page.is_none());
}

#[test]
fn web_links_under_a_link_annotation_are_not_listed_twice() {
    let a = Link { rects: vec![[0.0, 0.0, 100.0, 20.0]], uri: Some("https://a".into()), page: None, y: None };
    let inside = Link { rects: vec![[5.0, 2.0, 90.0, 18.0]], uri: Some("http://a".into()), page: None, y: None };
    let apart = Link { rects: vec![[0.0, 50.0, 100.0, 70.0]], uri: Some("http://b".into()), page: None, y: None };
    let m = merge_links(vec![a.clone()], vec![inside, apart.clone()]);
    assert_eq!(m, vec![a, apart]);
}

#[test]
fn search_finds_hits_with_options_and_rects_on_the_text() {
    let bytes = build(Spec {
        w: 300.0,
        h: 200.0,
        rotate: 0,
        crop: None,
        text: vec![("Stage left, stage right", 20.0, 150.0, 12.0), ("Backstage", 20.0, 100.0, 12.0)],
        links: vec![],
    });
    let (id, _) = open_fixture("search", &bytes);
    let s = |q: &str, case, word| docs().search_page(pdfium(), id, 0, q.to_string(), case, word).unwrap();
    let all = s("stage", false, false);
    assert_eq!(all.hits.len(), 3, "{:?}", all.hits.iter().map(|h| &h.text).collect::<Vec<_>>());
    assert!(all.chars > 0 && !all.truncated);
    assert_eq!(s("stage", true, false).hits.len(), 2);
    assert_eq!(s("stage", false, true).hits.len(), 2);
    let first = &all.hits[0];
    assert_eq!(first.text.to_lowercase(), "stage");
    assert!(first.after.starts_with(" left, stage right"), "{:?}", first.after);
    assert_eq!(first.before, "");
    // Baseline 150 in user space on a 200 pt page: the text sits about 50 pt from the top.
    let r = first.rects[0];
    assert!(r[1] > 35.0 && r[3] < 56.0 && r[0] >= 19.0 && r[2] < 70.0, "{r:?}");
    assert!(s("nothing like this", false, false).hits.is_empty());
    assert!(s("", false, false).hits.is_empty());
    docs().close(pdfium(), id);
}
