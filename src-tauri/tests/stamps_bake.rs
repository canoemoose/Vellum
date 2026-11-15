//! Baking a stamp into a page (annot/bake.rs): the page's content is wrapped and the stamp
//! drawn after it, appended as an incremental update. Checked by rendering through PDFium:
//! the page looks exactly as before except inside the stamp's box, the stamp is drawn there
//! even with annotations off (it is page content now), and nothing the original content leaves
//! behind (an unbalanced `q`, a `cm`, a clip) moves or hides it.
//!
//! Fixtures are built with lopdf here, so each content layout is exactly what's named: one
//! stream, an array, /Contents pointing at an array object, inherited resources, resources
//! shared between pages. The stamp is a synthetic stroke drawn in the test.

mod print_common;

use lopdf::{Dictionary, Document, Object, Stream, dictionary};
use print_common::*;
use std::sync::Arc;
use vellum_lib::annot::spec::Appearance;
use vellum_lib::annot::{self, AnnotSpec, Change};

const W: f64 = 300.0;
const H: f64 = 200.0;
/// Where the stamp goes, in user space.
const BOX: [f64; 4] = [180.0, 120.0, 280.0, 180.0];

/// A blue zigzag filling the box, as a stamp's appearance would draw it.
fn stamp(page: usize, nm: &str, r: [f64; 4]) -> AnnotSpec {
    let ops = format!(
        "0 0 1 RG 4 w 1 J {} {} m {} {} l {} {} l {} {} l S",
        r[0] + 4.0,
        r[1] + 4.0,
        r[0] + (r[2] - r[0]) / 3.0,
        r[3] - 4.0,
        r[0] + 2.0 * (r[2] - r[0]) / 3.0,
        r[1] + 4.0,
        r[2] - 4.0,
        r[3] - 4.0
    );
    AnnotSpec {
        page,
        nm: nm.into(),
        subtype: "Stamp".into(),
        rect: r,
        appearance: Appearance { ops, bbox: r, ..Default::default() },
        ..Default::default()
    }
}

/// One page's worth of fixture: its content streams and where its resources live.
enum Layout {
    /// /Contents is one stream.
    Single,
    /// /Contents is an array of two streams; the first leaves a `q`, a `cm` that halves
    /// everything and a clip to the bottom-left quarter in force.
    ArrayUnbalanced,
    /// /Contents is a reference to an array object.
    ArrayObject,
    /// No /Resources on the page: they're on the /Pages node, and their image is called
    /// VellumStamp0, the name the bake would pick first.
    Inherited,
    /// No /Contents at all.
    Empty,
}

fn black_image(doc: &mut Document) -> lopdf::ObjectId {
    let d = dictionary! {
        "Type" => "XObject", "Subtype" => "Image", "Width" => 1, "Height" => 1,
        "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8,
    };
    doc.add_object(Stream::new(d, vec![0u8]))
}

/// Build a file with `layouts.len()` pages; when `shared` is set, every page refers to the
/// same indirect resources dictionary.
fn fixture(layouts: &[Layout], shared: bool) -> Vec<u8> {
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let img = black_image(&mut doc);
    let shared_res = doc.add_object(dictionary! { "XObject" => dictionary! { "Im0" => Object::Reference(img) } });
    let mut kids = vec![];
    let mut pages_res: Option<Dictionary> = None;
    for l in layouts {
        let mut page = dictionary! { "Type" => "Page", "Parent" => Object::Reference(pages_id) };
        let s = |doc: &mut Document, ops: &str| doc.add_object(Stream::new(Dictionary::new(), ops.as_bytes().to_vec()));
        match l {
            Layout::Single => {
                let c = s(&mut doc, "0 0 0 rg 20 20 100 60 re f 0 0 0 RG 2 w 10 190 m 290 190 l S");
                page.set("Contents", Object::Reference(c));
            }
            Layout::ArrayUnbalanced => {
                let a = s(&mut doc, "q 0.5 0 0 0.5 0 0 cm 0 0 300 200 re W n 0 0 0 rg");
                let b = s(&mut doc, "40 40 200 120 re f");
                page.set("Contents", Object::Array(vec![Object::Reference(a), Object::Reference(b)]));
            }
            Layout::ArrayObject => {
                let a = s(&mut doc, "0 0 0 rg 20 20 100 60 re f");
                let b = s(&mut doc, "q 100 0 0 30 20 100 cm /Im0 Do Q");
                let arr = doc.add_object(Object::Array(vec![Object::Reference(a), Object::Reference(b)]));
                page.set("Contents", Object::Reference(arr));
            }
            Layout::Inherited => {
                let c = s(&mut doc, "q 100 0 0 60 20 20 cm /VellumStamp0 Do Q");
                page.set("Contents", Object::Reference(c));
                pages_res = Some(dictionary! { "XObject" => dictionary! { "VellumStamp0" => Object::Reference(img) } });
            }
            Layout::Empty => {}
        }
        if !matches!(l, Layout::Inherited) {
            if shared {
                page.set("Resources", Object::Reference(shared_res));
            } else {
                page.set("Resources", dictionary! { "XObject" => dictionary! { "Im0" => Object::Reference(img) } });
            }
        }
        kids.push(Object::Reference(doc.add_object(page)));
    }
    let mut pages = dictionary! {
        "Type" => "Pages", "Count" => kids.len() as i64, "Kids" => kids,
        "MediaBox" => vec![0.into(), 0.into(), (W as i64).into(), (H as i64).into()],
    };
    if let Some(r) = pages_res {
        pages.set("Resources", r);
    }
    doc.objects.insert(pages_id, Object::Dictionary(pages));
    let cat = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => Object::Reference(pages_id) });
    doc.trailer.set("Root", Object::Reference(cat));
    let mut out = vec![];
    doc.save_to(&mut out).unwrap();
    out
}

const PPP: f64 = 3.0;

fn render(bytes: &[u8], page: usize, annots: bool) -> (Vec<u8>, i32, i32) {
    let r = vellum_lib::print::raster::SheetRenderer::open(pdfium(), Arc::new(bytes.to_vec())).unwrap();
    let (w, h) = ((W * PPP) as i32, (H * PPP) as i32);
    (r.render_band(page, w, h, 0, 0, w, h, if annots { 0x01 } else { 0 }).unwrap(), w, h)
}

/// Is pixel (x, y) (y down) inside the box, grown by `pad` pixels?
fn in_box(x: i32, y: i32, b: [f64; 4], pad: f64) -> bool {
    let (fx, fy) = (x as f64 / PPP, H - y as f64 / PPP);
    let p = pad / PPP;
    fx >= b[0] - p && fx <= b[2] + p && fy >= b[1] - p && fy <= b[3] + p
}

/// Pixels that differ between two renders, split into outside and inside the box.
fn diff(a: &[u8], b: &[u8], w: i32, h: i32, bx: [f64; 4]) -> (usize, usize) {
    let (mut out, mut inside) = (0, 0);
    for y in 0..h {
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            if a[i..i + 3] != b[i..i + 3] {
                if in_box(x, y, bx, 2.0) { inside += 1 } else { out += 1 }
            }
        }
    }
    (out, inside)
}

/// Blue pixels (the stamp's ink) and where they are.
fn blue(px: &[u8], w: i32, h: i32) -> (usize, Option<(i32, i32, i32, i32)>) {
    let mut n = 0;
    let mut bb: Option<(i32, i32, i32, i32)> = None;
    for y in 0..h {
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            // BGRx: strong blue, little red or green.
            if px[i] > 180 && px[i + 1] < 90 && px[i + 2] < 90 {
                n += 1;
                bb = Some(match bb {
                    None => (x, y, x + 1, y + 1),
                    Some((a, b, c, d)) => (a.min(x), b.min(y), c.max(x + 1), d.max(y + 1)),
                });
            }
        }
    }
    (n, bb)
}

fn annot_count(bytes: &[u8], page: usize) -> i32 {
    let bytes = bytes.to_vec();
    pdfium()
        .run_on_worker(move |ctx| {
            let b = ctx.bindings();
            unsafe {
                let doc = b.FPDF_LoadMemDocument64(&bytes, None);
                assert!(!doc.is_null());
                let p = b.FPDF_LoadPage(doc, page as _);
                let n = b.FPDFPage_GetAnnotCount(p);
                b.FPDF_ClosePage(p);
                b.FPDF_CloseDocument(doc);
                n
            }
        })
        .unwrap()
}

/// Bake the stamp onto `page` of `orig` and check everything a bake promises.
fn check_bake(orig: &[u8], page: usize, what: &str) -> Vec<u8> {
    let out = annot::apply(orig.to_vec(), "", &[Change::Bake { spec: stamp(page, "sig", BOX) }]).unwrap();
    // Appended: the original bytes are untouched, and the result needs no repair to read.
    assert_eq!(&out[..orig.len()], orig, "{what}: original bytes kept");
    assert!(!annot::Writer::open(out.clone(), "").unwrap().info.recovered, "{what}: reads cleanly");
    // No annotation: the stamp is page content.
    assert_eq!(annot_count(&out, page), 0, "{what}: no annotation");

    let (before, w, h) = render(orig, page, true);
    let (after, _, _) = render(&out, page, false);
    let (outside, inside) = diff(&before, &after, w, h, BOX);
    assert_eq!(outside, 0, "{what}: {outside} pixels changed outside the stamp");
    assert!(inside > 200, "{what}: the stamp drew ({inside} pixels changed)");
    // Drawn where the box is, at full size: not halved, moved or clipped by the old content.
    let (n, bb) = blue(&after, w, h);
    assert!(n > 200, "{what}: blue ink");
    let bb = bb.unwrap();
    let pt = |v: i32| v as f64 / PPP;
    assert_near(
        (pt(bb.0), pt(bb.1), pt(bb.2), pt(bb.3)),
        (BOX[0] + 2.0, H - BOX[3] + 2.0, BOX[2] - 2.0, H - BOX[1] - 2.0),
        2.0,
        what,
    );
    out
}

#[test]
fn baking_into_a_single_content_stream() {
    check_bake(&fixture(&[Layout::Single], false), 0, "single stream");
}

#[test]
fn baking_into_an_array_whose_content_leaves_its_state_behind() {
    // Without the wrap, the stamp would come out half size at the bottom left and be clipped.
    check_bake(&fixture(&[Layout::ArrayUnbalanced], false), 0, "unbalanced array");
}

#[test]
fn baking_into_contents_that_point_at_an_array_object() {
    check_bake(&fixture(&[Layout::ArrayObject], false), 0, "array object");
}

#[test]
fn baking_with_inherited_resources_keeps_their_names() {
    // The inherited image is called VellumStamp0, so the stamp must take another name or the
    // page's own image would be replaced by it.
    let out = check_bake(&fixture(&[Layout::Inherited], false), 0, "inherited");
    let doc = Document::load_mem(&out).unwrap();
    let pid = *doc.get_pages().get(&1).unwrap();
    let res = doc.get_dictionary(pid).unwrap().get(b"Resources").unwrap().as_dict().unwrap();
    let xo = res.get(b"XObject").unwrap().as_dict().unwrap();
    assert!(xo.has(b"VellumStamp0") && xo.has(b"VellumStamp1"));
}

#[test]
fn baking_onto_a_page_with_no_content() {
    check_bake(&fixture(&[Layout::Empty], false), 0, "empty page");
}

#[test]
fn baking_leaves_resources_shared_with_other_pages_alone() {
    let orig = fixture(&[Layout::Single, Layout::ArrayObject], true);
    let out = check_bake(&orig, 0, "shared resources");
    // Page 2 renders exactly as before, and the shared dictionary wasn't copied forward.
    let (a, w, h) = render(&orig, 1, true);
    let (b, _, _) = render(&out, 1, true);
    assert_eq!(diff(&a, &b, w, h, [0.0; 4]).0, 0);
    let after = Document::load_mem(&out).unwrap();
    let before = Document::load_mem(&orig).unwrap();
    let p1 = *after.get_pages().get(&2).unwrap();
    let r_after = after.get_dictionary(p1).unwrap().get(b"Resources").unwrap().as_reference().unwrap();
    assert_eq!(after.get_object(r_after).unwrap(), before.get_object(r_after).unwrap());
}

#[test]
fn baking_twice_on_one_page_and_replacing_an_annotation() {
    // Saved movable first, then baked: the annotation goes and the drawing stays.
    let orig = fixture(&[Layout::Single], false);
    let movable = annot::apply(orig.clone(), "", &[Change::Add { spec: stamp(0, "sig", BOX) }]).unwrap();
    assert_eq!(annot_count(&movable, 0), 1);
    let baked = annot::apply(movable.clone(), "", &[Change::Bake { spec: stamp(0, "sig", BOX) }]).unwrap();
    assert_eq!(annot_count(&baked, 0), 0);
    let (a, w, h) = render(&movable, 0, true);
    let (b, _, _) = render(&baked, 0, false);
    // Same pixels: the annotation's appearance and the baked form are the same drawing.
    let (outside, inside) = diff(&a, &b, w, h, BOX);
    assert_eq!(outside, 0);
    assert!(inside < 40, "{inside} pixels differ inside the box");
    // A second stamp elsewhere on the same page, in the same save.
    let second = [20.0, 120.0, 120.0, 180.0];
    let two = annot::apply(orig.clone(), "", &[Change::Bake { spec: stamp(0, "a", BOX) }, Change::Bake { spec: stamp(0, "b", second) }]).unwrap();
    let (px, w, h) = render(&two, 0, false);
    let (_, bb) = blue(&px, w, h);
    let bb = bb.unwrap();
    assert!((bb.0 as f64 / PPP) < 30.0 && (bb.2 as f64 / PPP) > 270.0, "both stamps drawn: {bb:?}");
}

/// The spike on real drawings: bake a stamp onto page 1 of every PDF in `VELLUM_BAKE_DIR` and
/// compare the render outside the stamp's box. Writes each result to `VELLUM_BAKE_OUT` (if set)
/// for qpdf to check. Never run by default: the files are client drawings, kept out of the repo.
///
/// `VELLUM_BAKE_DIR=... VELLUM_BAKE_OUT=... cargo test --test stamps_bake real_files -- --ignored --nocapture`
#[test]
#[ignore]
fn real_files() {
    let dir = std::env::var("VELLUM_BAKE_DIR").expect("VELLUM_BAKE_DIR");
    let out_dir = std::env::var("VELLUM_BAKE_OUT").ok();
    let mut files: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("pdf"))).collect();
    files.sort();
    for f in files {
        let name = f.file_name().unwrap().to_string_lossy().into_owned();
        let orig = std::fs::read(&f).unwrap();
        let w = match annot::Writer::open(orig.clone(), "") {
            Ok(w) => w,
            Err(e) => {
                println!("{name}: skipped, {e}");
                continue;
            }
        };
        if w.info.recovered || w.info.encryption.is_some() {
            println!("{name}: skipped (recovered={}, encrypted={})", w.info.recovered, w.info.encryption.is_some());
            continue;
        }
        let (pb, rot) = w.page_box(0).unwrap();
        // A 150 x 50 pt stamp a third of the way in from the bottom left of the visible box.
        let bx = [pb[0] + (pb[2] - pb[0]) / 3.0, pb[1] + (pb[3] - pb[1]) / 3.0, pb[0] + (pb[2] - pb[0]) / 3.0 + 150.0, pb[1] + (pb[3] - pb[1]) / 3.0 + 50.0];
        let t0 = std::time::Instant::now();
        let out = annot::apply(orig.clone(), "", &[Change::Bake { spec: stamp(0, "sig", bx) }]).unwrap();
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(&out[..orig.len()], &orig[..]);
        // Render both at about 2000 px on the long side, annotations on for the original.
        let (pw, ph) = (pb[2] - pb[0], pb[3] - pb[1]);
        let (vw, vh) = if rot % 180 == 0 { (pw, ph) } else { (ph, pw) };
        let ppp = 2000.0 / vw.max(vh);
        let (iw, ih) = ((vw * ppp).round() as i32, (vh * ppp).round() as i32);
        let ra = vellum_lib::print::raster::SheetRenderer::open(pdfium(), Arc::new(orig.clone())).unwrap();
        let rb = vellum_lib::print::raster::SheetRenderer::open(pdfium(), Arc::new(out.clone())).unwrap();
        let a = ra.render_band(0, iw, ih, 0, 0, iw, ih, 0x01).unwrap();
        let b = rb.render_band(0, iw, ih, 0, 0, iw, ih, 0x01).unwrap();
        // Count differences; the stamp's own box can be anywhere once rotated, so report the
        // bounding box of the differing pixels and check it is about the stamp's size.
        let mut n = 0usize;
        let mut bb: Option<(i32, i32, i32, i32)> = None;
        for y in 0..ih {
            for x in 0..iw {
                let i = ((y * iw + x) * 4) as usize;
                if a[i..i + 3] != b[i..i + 3] {
                    n += 1;
                    bb = Some(match bb {
                        None => (x, y, x + 1, y + 1),
                        Some((p, q, r, s)) => (p.min(x), q.min(y), r.max(x + 1), s.max(y + 1)),
                    });
                }
            }
        }
        let size = bb.map(|(p, q, r, s)| ((r - p) as f64 / ppp, (s - q) as f64 / ppp));
        println!("{name}: {} bytes added in {ms:.0} ms, rotate {rot}, {n} pixels differ, over {size:?} pt", out.len() - orig.len());
        let (sw, sh) = size.expect("the stamp drew");
        let (ew, eh) = if rot % 180 == 0 { (150.0, 50.0) } else { (50.0, 150.0) };
        // Anti-aliasing reaches a few pixels past the ink, and a pixel is over a point on a big sheet.
        let slack = 2.0 + 4.0 / ppp;
        assert!(sw <= ew + slack && sh <= eh + slack, "{name}: differences spread beyond the stamp");
        if let Some(o) = &out_dir {
            std::fs::create_dir_all(o).unwrap();
            std::fs::write(std::path::Path::new(o).join(&name), &out).unwrap();
        }
    }
}
