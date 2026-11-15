//! Tool consistency stage 7: notes can stay open. A note is written with a Popup annotation
//! beside it, /Open when pinned; replacing or deleting the note keeps the pair together; reading
//! the file back gives the pin and never a markup for the Popup; hiding the note in PDFium hides
//! its pop-up too.

mod print_common;

use lopdf::{Dictionary, Document, Object, ObjectId, dictionary};
use print_common::*;
use vellum_lib::annot::spec::{Appearance, PopupSpec};
use vellum_lib::annot::{self, AnnotSpec, Change, read};

fn blank() -> Vec<u8> {
    make_pdf(vec![page(300.0, 200.0, &[])])
}

const POPUP: [f64; 4] = [34.0, 80.0, 234.0, 200.0];

fn note(nm: &str, pinned: Option<bool>) -> AnnotSpec {
    AnnotSpec {
        page: 0,
        nm: nm.into(),
        subtype: "Text".into(),
        rect: [10.0, 180.0, 30.0, 200.0],
        appearance: Appearance { ops: "1 0.8 0 rg 10 180 20 20 re f".into(), bbox: [10.0, 180.0, 30.0, 200.0], ..Default::default() },
        contents: Some("Check the fixing".into()),
        flags: Some(12),
        icon: Some("Note".into()),
        modified: Some("D:20261115100000Z".into()),
        popup: pinned.map(|open| PopupSpec { rect: POPUP, open }),
        ..Default::default()
    }
}

/// The page's /Annots as (object number, dictionary), in order.
fn annots(out: &[u8]) -> Vec<(ObjectId, Dictionary)> {
    let doc = Document::load_mem(out).unwrap();
    let pid = *doc.get_pages().values().next().unwrap();
    let pd = doc.get_dictionary(pid).unwrap();
    let arr = match pd.get(b"Annots") {
        Ok(Object::Reference(r)) => doc.get_object(*r).unwrap().as_array().unwrap().clone(),
        Ok(Object::Array(a)) => a.clone(),
        _ => vec![],
    };
    arr.iter()
        .map(|o| {
            let id = o.as_reference().unwrap();
            (id, doc.get_dictionary(id).unwrap().clone())
        })
        .collect()
}

fn name<'a>(d: &'a Dictionary, k: &[u8]) -> &'a [u8] {
    d.get(k).unwrap().as_name().unwrap()
}

fn num(o: &Object) -> f64 {
    match o {
        Object::Integer(i) => *i as f64,
        Object::Real(r) => *r as f64,
        _ => panic!("not a number: {o:?}"),
    }
}

/// The note and its pop-up, checked to point at each other. Returns the pop-up's dictionary.
fn pair(list: &[(ObjectId, Dictionary)], nm: &str) -> (ObjectId, ObjectId, Dictionary) {
    let (nid, nd) = list.iter().find(|(_, d)| d.get(b"NM").ok().and_then(|o| o.as_str().ok()) == Some(nm.as_bytes())).expect("the note");
    let pid = nd.get(b"Popup").expect("the note's /Popup").as_reference().unwrap();
    let (_, pd) = list.iter().find(|(id, _)| *id == pid).expect("the pop-up is in /Annots");
    assert_eq!(name(pd, b"Subtype"), b"Popup");
    assert_eq!(pd.get(b"Parent").unwrap().as_reference().unwrap(), *nid, "its /Parent is the note");
    (*nid, pid, pd.clone())
}

#[test]
fn a_pinned_note_writes_an_open_popup_beside_it_that_does_not_print() {
    let out = annot::apply(blank(), "", &[Change::Add { spec: note("n1", Some(true)) }]).unwrap();
    let list = annots(&out);
    assert_eq!(list.len(), 2, "the note and its pop-up");
    assert_eq!(name(&list[0].1, b"Subtype"), b"Text");
    let (_, _, pd) = pair(&list, "n1");
    assert_eq!(pd.get(b"Open").unwrap().as_bool().unwrap(), true);
    let f = pd.get(b"F").unwrap().as_i64().unwrap();
    assert_eq!(f & 4, 0, "a pop-up doesn't print");
    let r: Vec<f64> = pd.get(b"Rect").unwrap().as_array().unwrap().iter().map(num).collect();
    for (got, want) in r.iter().zip(POPUP) {
        assert!((got - want).abs() < 0.01, "{r:?}");
    }
    // The note itself still prints.
    assert_eq!(list[0].1.get(b"F").unwrap().as_i64().unwrap() & 4, 4);
}

#[test]
fn an_unpinned_note_writes_a_closed_popup() {
    let out = annot::apply(blank(), "", &[Change::Add { spec: note("n1", Some(false)) }]).unwrap();
    let list = annots(&out);
    assert_eq!(list.len(), 2);
    let (_, _, pd) = pair(&list, "n1");
    assert_eq!(pd.get(b"Open").unwrap().as_bool().unwrap(), false);
}

#[test]
fn replacing_a_note_keeps_its_popup_and_changes_only_what_changed() {
    let once = annot::apply(blank(), "", &[Change::Add { spec: note("n1", Some(false)) }, Change::Add { spec: note("n2", Some(false)) }]).unwrap();
    let (n1, p1, _) = pair(&annots(&once), "n1");
    let (_, p2, _) = pair(&annots(&once), "n2");
    // Pinned, and moved along.
    let moved = AnnotSpec { rect: [50.0, 150.0, 70.0, 170.0], popup: Some(PopupSpec { rect: [74.0, 50.0, 274.0, 170.0], open: true }), ..note("n1", None) };
    let twice = annot::apply(once, "", &[Change::Replace { spec: moved }]).unwrap();
    let list = annots(&twice);
    assert_eq!(list.len(), 4, "still two notes and two pop-ups: {list:?}");
    let (n1b, p1b, pd) = pair(&list, "n1");
    assert_eq!((n1b, p1b), (n1, p1), "the same objects, the pair kept together");
    assert_eq!(pd.get(b"Open").unwrap().as_bool().unwrap(), true);
    assert!((num(&pd.get(b"Rect").unwrap().as_array().unwrap()[0]) - 74.0).abs() < 0.01);
    // The other note's pop-up is untouched.
    let (_, p2b, pd2) = pair(&list, "n2");
    assert_eq!(p2b, p2);
    assert_eq!(pd2.get(b"Open").unwrap().as_bool().unwrap(), false);
    // Unpinned again.
    let thrice = annot::apply(twice, "", &[Change::Replace { spec: AnnotSpec { popup: Some(PopupSpec { rect: POPUP, open: false }), ..note("n1", None) } }]).unwrap();
    let list = annots(&thrice);
    assert_eq!(list.len(), 4);
    let (_, p1c, pd) = pair(&list, "n1");
    assert_eq!(p1c, p1);
    assert_eq!(pd.get(b"Open").unwrap().as_bool().unwrap(), false);
}

#[test]
fn replacing_a_note_that_had_no_popup_gives_it_one() {
    // A note saved before pins (or by an app that writes none).
    let once = annot::apply(blank(), "", &[Change::Add { spec: note("n1", None) }]).unwrap();
    assert_eq!(annots(&once).len(), 1);
    let twice = annot::apply(once, "", &[Change::Replace { spec: note("n1", Some(true)) }]).unwrap();
    let list = annots(&twice);
    assert_eq!(list.len(), 2);
    let (_, _, pd) = pair(&list, "n1");
    assert_eq!(pd.get(b"Open").unwrap().as_bool().unwrap(), true);
}

#[test]
fn deleting_a_note_deletes_its_popup() {
    let once = annot::apply(blank(), "", &[Change::Add { spec: note("n1", Some(true)) }, Change::Add { spec: note("n2", Some(false)) }]).unwrap();
    let out = annot::apply(once, "", &[Change::Delete { page: 0, nm: "n1".into(), at: None }]).unwrap();
    let list = annots(&out);
    assert_eq!(list.len(), 2, "only n2 and its pop-up are left: {list:?}");
    pair(&list, "n2");
    // A note found by its position as read (phase 7b) takes its pop-up with it too.
    let out = annot::apply(out, "", &[Change::Delete { page: 0, nm: String::new(), at: Some(0) }]).unwrap();
    assert!(annots(&out).is_empty());
}

#[test]
fn deleting_a_note_deletes_a_popup_that_names_it_as_parent_even_without_a_link_back() {
    // Another app's file: the pop-up's /Parent is the note, but the note has no /Popup.
    let mut doc = Document::load_mem(&blank()).unwrap();
    let pid = *doc.get_pages().values().next().unwrap();
    let nid = doc.add_object(dictionary! { "Type" => "Annot", "Subtype" => "Text", "NM" => Object::string_literal("n1"), "Rect" => vec![10.into(), 180.into(), 30.into(), 200.into()] });
    let popid = doc.add_object(dictionary! { "Type" => "Annot", "Subtype" => "Popup", "Parent" => Object::Reference(nid), "Rect" => vec![34.into(), 80.into(), 234.into(), 200.into()] });
    doc.get_dictionary_mut(pid).unwrap().set("Annots", vec![Object::Reference(nid), Object::Reference(popid)]);
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    let out = annot::apply(bytes, "", &[Change::Delete { page: 0, nm: "n1".into(), at: None }]).unwrap();
    assert!(annots(&out).is_empty(), "no orphaned pop-up");
}

#[test]
fn reading_back_gives_the_pin_and_never_the_popup_as_a_markup() {
    let out = annot::apply(blank(), "", &[Change::Add { spec: note("open", Some(true)) }, Change::Add { spec: note("shut", Some(false)) }, Change::Add { spec: note("none", None) }]).unwrap();
    assert_eq!(annots(&out).len(), 5);
    let r = read::read(&out, "").unwrap();
    let got: Vec<(Option<String>, &str, Option<bool>)> = r.pages[0].annots.iter().map(|a| (a.nm.clone(), a.subtype.as_str(), a.popup_open)).collect();
    assert_eq!(
        got,
        vec![(Some("open".into()), "Text", Some(true)), (Some("shut".into()), "Text", Some(false)), (Some("none".into()), "Text", None)],
        "three notes, no pop-ups"
    );
    // Positions are /Annots positions (pop-ups counted), as PDFium indexes them.
    let idx: Vec<usize> = r.pages[0].annots.iter().map(|a| a.index).collect();
    assert_eq!(idx, vec![0, 2, 4]);
}

#[test]
fn hiding_a_note_in_pdfium_hides_its_popup_too() {
    let out = annot::apply(blank(), "", &[Change::Add { spec: note("n1", Some(true)) }, Change::Add { spec: note("n2", Some(true)) }]).unwrap();
    let (id, _) = open_fixture("annot-notes-hide", &out);
    let flags = |id: u64| -> Vec<i32> {
        pdfium()
            .run_on_worker_index(0, move |ctx| {
                let b = ctx.bindings();
                let p = ctx.page(id, 0).unwrap();
                unsafe {
                    (0..b.FPDFPage_GetAnnotCount(p))
                        .map(|i| {
                            let a = b.FPDFPage_GetAnnot(p, i);
                            let f = b.FPDFAnnot_GetFlags(a);
                            b.FPDFPage_CloseAnnot(a);
                            f
                        })
                        .collect()
                }
            })
            .unwrap()
    };
    assert_eq!(docs().hide_annots(pdfium(), id, 0, vec!["n1".into()], vec![], true).unwrap(), 1);
    let f = flags(id);
    assert_eq!(f.len(), 4, "{f:?}");
    assert!(f[0] & 2 != 0 && f[1] & 2 != 0, "n1 and its pop-up hidden: {f:?}");
    assert!(f[2] & 2 == 0 && f[3] & 2 == 0, "n2 and its pop-up left alone: {f:?}");
    assert_eq!(docs().hide_annots(pdfium(), id, 0, vec!["n1".into()], vec![], false).unwrap(), 1);
    let f = flags(id);
    assert!(f.iter().all(|f| f & 2 == 0), "{f:?}");
    docs().close(pdfium(), id);
}
