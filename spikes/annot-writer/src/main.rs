//! Phase 0 spike runner. Subcommands:
//!
//!   samples            annotate the synthetic files and fixtures, verify, write the samples
//!   real <file> [pw]   load time, memory and an in-memory append on one file (writes nothing)
//!
//! Paths are relative to the repository root. Output strings are ASCII (they go to a terminal).

use std::path::{Path, PathBuf};
use std::time::Instant;

use annot_writer_spike::appearance::{BBox, Style};
use annot_writer_spike::demo::{self, RED};
use annot_writer_spike::memory;
use annot_writer_spike::pdfium_check::{ANNOT_FLAG_HIDDEN, Pdfium};
use annot_writer_spike::writer::{Markup, Writer};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap()
}

/// PDFium's subtype number for each markup.
fn subtype_of(m: &Markup) -> i32 {
    match m {
        Markup::Text { .. } | Markup::Callout { .. } => 3,
        Markup::Arrow { .. } | Markup::Distance { .. } => 4,
        Markup::Rect { .. } => 5,
        Markup::Polygon { .. } | Markup::Cloud { .. } | Markup::Area { .. } => 7,
        Markup::Ink { .. } => 15,
    }
}

struct Added {
    page: usize,
    nm: String,
    subtype: i32,
    rect: [f64; 4],
}

/// Add the demo markups to `pages`, save, and return the output and what was added.
fn annotate(bytes: &[u8], pw: &str, pages: &[usize], tag: &str) -> Result<(Vec<u8>, Vec<Added>, Writer, f64), String> {
    let mut w = Writer::open(bytes.to_vec(), pw)?;
    let mut added = Vec::new();
    for &page in pages {
        let (b, _rot) = w.page_box(page)?;
        for (name, m) in demo::markups(b[0], b[1], b[2] - b[0], b[3] - b[1]) {
            let nm = format!("vellum-{tag}-p{}-{}", page + 1, name.replace(' ', "-"));
            let id = w.add(page, &m, &demo::meta(nm.clone()))?;
            let rect = rect_of(&w, id);
            added.push(Added { page, nm, subtype: subtype_of(&m), rect });
        }
    }
    let t0 = Instant::now();
    let out = w.save()?;
    let save_ms = t0.elapsed().as_secs_f64() * 1000.0;
    Ok((out, added, w, save_ms))
}

fn rect_of(w: &Writer, id: lopdf::ObjectId) -> [f64; 4] {
    let d = w.inc.new_document.get_dictionary(id).unwrap();
    let a = d.get(b"Rect").unwrap().as_array().unwrap();
    let v: Vec<f64> = a.iter().map(|o| o.as_float().unwrap() as f64).collect();
    [v[0], v[1], v[2], v[3]]
}

/// Everything we can check without a person: bytes, PDFium, lopdf, and a second save on top.
/// `removed` is how many annotations the edit took off the page.
fn verify(pdfium: &Pdfium, orig: &[u8], out: &[u8], pw: &str, added: &[Added], render: bool, removed: usize) -> Vec<String> {
    let mut problems = Vec::new();
    if out.len() <= orig.len() || out[..orig.len()] != orig[..] {
        problems.push("original bytes changed".into());
    }
    // In an encrypted file nothing we wrote may appear in the clear.
    let enc = Writer::open(orig.to_vec(), pw).map(|w| w.info.encryption.is_some()).unwrap_or(false);
    if enc && out[orig.len().min(out.len())..].windows(7).any(|w| w == b"vellum-") {
        problems.push("plain text in the encrypted update".into());
    }
    let pdf_pw = (!pw.is_empty()).then_some(pw);
    let (before, after) = match (pdfium.open(orig.to_vec(), pdf_pw), pdfium.open(out.to_vec(), pdf_pw)) {
        (Ok(a), Ok(b)) => (a, b),
        (_, Err(e)) => return vec![format!("PDFium: {e}")],
        (Err(e), _) => return vec![format!("PDFium (original): {e}")],
    };
    if before.pages() != after.pages() {
        problems.push(format!("page count {} -> {}", before.pages(), after.pages()));
    }
    let mut pages: Vec<usize> = added.iter().map(|a| a.page).collect();
    pages.dedup();
    for page in pages {
        let (pb, pa) = (before.page(page).unwrap(), after.page(page).unwrap());
        let ours: Vec<&Added> = added.iter().filter(|a| a.page == page).collect();
        if pa.annot_count() + removed != pb.annot_count() + ours.len() {
            problems.push(format!("p{}: PDFium sees {} annotations, expected {}", page + 1, pa.annot_count(), pb.annot_count() + ours.len() - removed));
        }
        let infos = pa.annots();
        let (ib, ia) = if render {
            let s = (600.0 / pb.size().0.max(pb.size().1)).min(1.0);
            (Some(pb.render(s)), Some(pa.render(s)))
        } else {
            (None, None)
        };
        for a in ours {
            match infos.iter().flatten().find(|i| i.nm == a.nm) {
                None => problems.push(format!("{}: not found by PDFium", a.nm)),
                Some(i) => {
                    if i.subtype != a.subtype {
                        problems.push(format!("{}: subtype {} expected {}", a.nm, i.subtype, a.subtype));
                    }
                    if (0..4).any(|k| (i.rect[k] as f64 - a.rect[k]).abs() > 0.5) {
                        problems.push(format!("{}: rect {:?} expected {:?}", a.nm, i.rect, a.rect));
                    }
                    if let (Some(ib), Some(ia)) = (&ib, &ia) {
                        let r = [a.rect[0] as f32, a.rect[1] as f32, a.rect[2] as f32, a.rect[3] as f32];
                        if ia.diff_in(ib, r) == 0 {
                            problems.push(format!("{}: nothing drawn", a.nm));
                        }
                    }
                }
            }
        }
    }
    // lopdf reads its own output, strings decrypted.
    match Writer::open(out.to_vec(), pw) {
        Err(e) => problems.push(format!("lopdf re-read: {e}")),
        Ok(w) => {
            for a in added {
                let found = w.annots(a.page).map(|e| e.iter().any(|x| x.nm.as_deref() == Some(&a.nm))).unwrap_or(false);
                if !found {
                    problems.push(format!("{}: not found by lopdf on re-read", a.nm));
                }
            }
        }
    }
    problems
}

struct Case {
    name: &'static str,
    input: PathBuf,
    pw: &'static str,
    pages: Vec<usize>,
}

fn samples() -> Result<(), String> {
    let root = root();
    let syn = root.join("bench-output/synthetic");
    let fx = root.join("bench-output/annot-spike/fixtures");
    let out_dir = root.join("bench-output/annot-spike/samples");
    let _ = std::fs::remove_dir_all(&out_dir);
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let c = |name, input: PathBuf, pw, pages: Vec<usize>| Case { name, input, pw, pages };
    let cases = vec![
        c("01-a1-lines", syn.join("1-a1-200k-lines.pdf"), "", vec![0]),
        c("02-a1-text", syn.join("2-a1-50k-text.pdf"), "", vec![0]),
        c("03-a3-set", syn.join("3-a3-40-pages.pdf"), "", vec![0, 39]),
        c("04-a1-raster", syn.join("4-a1-raster.pdf"), "", vec![0]),
        c("05-a4-doc", syn.join("5-a4-300-pages.pdf"), "", vec![0, 299]),
        c("06-a1-objstm", fx.join("a1-objstm.pdf"), "", vec![0]),
        c("07-a3-rc4-40", fx.join("a3-rc4-40.pdf"), "", vec![0]),
        c("08-a3-rc4-128", fx.join("a3-rc4-128.pdf"), "", vec![0]),
        c("09-a3-aes128", fx.join("a3-aes128.pdf"), "", vec![0]),
        c("10-a3-aes256", fx.join("a3-aes256.pdf"), "", vec![0]),
        c("11-a3-aes256-objstm", fx.join("a3-aes256-objstm.pdf"), "", vec![0]),
        c("12-a3-aes256-password-vellum", fx.join("a3-aes256-userpw.pdf"), "vellum", vec![0]),
        c("13-a3-aes256-no-annot-permission", fx.join("a3-aes256-noannot.pdf"), "", vec![0]),
        c("14-a4-signed", fx.join("a4-signed.pdf"), "", vec![0]),
        c("15-a4-certified-annots-allowed", fx.join("a4-certified-annots.pdf"), "", vec![0]),
        c("16-a4-certified-no-annots", fx.join("a4-certified-noannots.pdf"), "", vec![0]),
        c("17-a1-rotated", fx.join("a1-rotated.pdf"), "", vec![0]),
        c("18-a4-broken-xref", fx.join("a4-broken-xref.pdf"), "", vec![0]),
    ];
    let pdfium = Pdfium::load()?;
    let mut failed = 0;
    println!("{:<34} {:>8} {:>6} {:<24} {:>4} {:>4} {:>7} {:>7} {:>8}  result", "sample", "MB", "xref", "encryption", "sigs", "mdp", "load ms", "save ms", "added KB");
    for case in cases {
        let mut orig = std::fs::read(&case.input).map_err(|e| format!("{}: {e}", case.input.display()))?;
        // A file whose cross-reference data had to be rebuilt can't take an incremental update:
        // our /Prev would point at the broken table and stricter readers (qpdf) then give up.
        // So it is saved through PDFium first (the brief's "rebuild" kind of save).
        let mut rebuilt = false;
        if Writer::open(orig.clone(), case.pw).map(|w| w.info.recovered).unwrap_or(false) {
            let d = pdfium.open(orig.clone(), (!case.pw.is_empty()).then_some(case.pw))?;
            orig = d.save(0)?;
            rebuilt = true;
        }
        let res = annotate(&orig, case.pw, &case.pages, case.name);
        let (out, added, w, save_ms) = match res {
            Ok(r) => r,
            Err(e) => {
                println!("{:<34} FAILED: {e}", case.name);
                failed += 1;
                continue;
            }
        };
        let i = &w.info;
        let mut problems = verify(&pdfium, &orig, &out, case.pw, &added, true, 0);
        // A second save on top of the first: Vellum saves the same file again and again.
        let chained = (|| -> Result<Vec<String>, String> {
            let mut w2 = Writer::open(out.clone(), case.pw)?;
            let (b, _) = w2.page_box(0)?;
            let m = Markup::Rect { rect: BBox([b[0] + 20.0, b[1] + 20.0, b[0] + 80.0, b[1] + 60.0]), style: Style::stroke(RED, 2.0) };
            let nm = format!("vellum-{}-second-save", case.name);
            let id = w2.add(0, &m, &demo::meta(nm.clone()))?;
            let rect = rect_of(&w2, id);
            let out2 = w2.save()?;
            let added2 = vec![Added { page: 0, nm, subtype: 5, rect }];
            Ok(verify(&pdfium, &out, &out2, case.pw, &added2, false, 0))
        })();
        match chained {
            Ok(p) => problems.extend(p.into_iter().map(|p| format!("second save: {p}"))),
            Err(e) => problems.push(format!("second save: {e}")),
        }
        if i.recovered {
            problems.push("lopdf rebuilt the xref (malformed file): /Prev points at a broken table".into());
        }
        if rebuilt {
            println!("{:<34} malformed cross-reference data: saved through PDFium first, then appended", case.name);
        }
        println!(
            "{:<34} {:>8.1} {:>6} {:<24} {:>4} {:>4} {:>7.0} {:>7.0} {:>8.1}  {}",
            case.name,
            orig.len() as f64 / 1048576.0,
            if i.xref_stream { "stream" } else { "table" },
            i.encryption.clone().map(|e| format!("{e} P={}", i.permissions.unwrap_or(0))).unwrap_or("-".into()),
            i.signatures,
            i.docmdp.map(|v| v.to_string()).unwrap_or("-".into()),
            i.load_ms,
            save_ms,
            (out.len() - orig.len()) as f64 / 1024.0,
            if problems.is_empty() { "ok".to_string() } else { format!("{} problem(s)", problems.len()) }
        );
        for p in &problems {
            println!("    - {p}");
        }
        if !problems.is_empty() {
            failed += 1;
        }
        std::fs::write(out_dir.join(format!("{}.pdf", case.name)), &out).map_err(|e| e.to_string())?;
    }
    existing(&pdfium, &fx, &out_dir, &mut failed)?;
    pdfium_first(&pdfium, &syn, &out_dir, &mut failed)?;
    println!("samples written to {}", out_dir.display());
    if failed > 0 { Err(format!("{failed} case(s) with problems")) } else { Ok(()) }
}

/// Annotations another app wrote: match PDFium's index to the object, lift one, then replace,
/// restyle and delete through the writer.
fn existing(pdfium: &Pdfium, fx: &Path, out_dir: &Path, failed: &mut usize) -> Result<(), String> {
    for (file, out_name) in [("a1-existing-annots.pdf", "19-a1-existing-edited"), ("a1-existing-annots-objstm.pdf", "20-a1-existing-objstm-edited")] {
        let orig = std::fs::read(fx.join(file)).map_err(|e| e.to_string())?;
        let mut problems = Vec::new();
        let w = Writer::open(orig.clone(), "")?;
        let entries = w.annots(0)?;
        let doc = pdfium.open(orig.clone(), None)?;
        let page = doc.page(0)?;
        let infos = page.annots();
        // 1. Matching: PDFium's index is the position in /Annots.
        if infos.len() != entries.len() {
            problems.push(format!("PDFium counts {} annotations, /Annots has {} entries", infos.len(), entries.len()));
        }
        let mut matched = 0;
        for (e, i) in entries.iter().zip(infos.iter()) {
            match (e.subtype.as_deref(), i) {
                (None, None) => matched += 1,
                (Some(st), Some(i)) => {
                    let same_rect = e.rect.map(|r| (0..4).all(|k| (r[k] - i.rect[k] as f64).abs() < 0.01)).unwrap_or(false);
                    let same_nm = e.nm.clone().unwrap_or_default() == i.nm;
                    if same_rect && same_nm {
                        matched += 1;
                    } else {
                        problems.push(format!("index {}: lopdf {st} {:?} vs PDFium {} {:?}", e.index, e.rect, i.subtype, i.rect));
                    }
                }
                (a, b) => problems.push(format!("index {}: lopdf {:?} vs PDFium {:?}", e.index, a, b.as_ref().map(|i| i.subtype))),
            }
        }
        // 2. Lifting: hide the square on the open page and re-render.
        let sq = entries.iter().position(|e| e.nm.as_deref() == Some("existing-square")).ok_or("no square")?;
        let r = infos[sq].as_ref().unwrap().rect;
        let img0 = page.render(0.25);
        let flags = infos[sq].as_ref().unwrap().flags;
        page.set_flags(sq, flags | ANNOT_FLAG_HIDDEN);
        let img1 = page.render(0.25);
        let hidden_same_page = img1.diff_in(&img0, r) > 0;
        drop(page);
        let page = doc.page(0)?;
        let img2 = page.render(0.25);
        let hidden_after_reload = img2.diff_in(&img0, r) > 0;
        page.set_flags(sq, flags);
        let img3 = page.render(0.25);
        let restored = img3.diff_in(&img0, r) == 0;
        if !(hidden_same_page && hidden_after_reload && restored) {
            problems.push(format!("lift: hidden on open page {hidden_same_page}, after reload {hidden_after_reload}, restored {restored}"));
        }
        drop(page);
        drop(doc);
        // 3. Edit through the writer: move and recolour the square (same object number), turn the
        // line red with an open arrow, delete the sticky note (and its popup), add the demo set.
        let mut w = w;
        let sq_id = entries[sq].id;
        let line = entries.iter().position(|e| e.nm.as_deref() == Some("existing-line")).ok_or("no line")?;
        let note = entries.iter().position(|e| e.nm.as_deref() == Some("existing-note")).ok_or("no note")?;
        w.replace(0, sq, &Markup::Rect { rect: BBox([260.0, 1250.0, 560.0, 1450.0]), style: Style::stroke(RED, 4.0) }, &demo::meta("existing-square".into()))?;
        w.replace(0, line, &Markup::Arrow { from: (610.0, 1300.0), to: (990.0, 1500.0), style: Style::stroke(RED, 3.0) }, &demo::meta("existing-line".into()))?;
        w.delete(0, note)?;
        let (b, _) = w.page_box(0)?;
        let mut added = Vec::new();
        for (name, m) in demo::markups(b[0], b[1], b[2] - b[0], b[3] - b[1]) {
            let nm = format!("vellum-{out_name}-{}", name.replace(' ', "-"));
            let id = w.add(0, &m, &demo::meta(nm.clone()))?;
            added.push(Added { page: 0, nm, subtype: subtype_of(&m), rect: rect_of(&w, id) });
        }
        let out = w.save()?;
        if out[..orig.len()] != orig[..] {
            problems.push("original bytes changed".into());
        }
        let doc = pdfium.open(out.clone(), None)?;
        let page = doc.page(0)?;
        let after = page.annots();
        let n = |s: &str| after.iter().flatten().find(|i| i.nm == s).cloned();
        // 6 entries - note - popup + 9 new.
        if after.len() != entries.len() - 2 + added.len() {
            problems.push(format!("after edit PDFium counts {} annotations, expected {}", after.len(), entries.len() - 2 + added.len()));
        }
        match n("existing-square") {
            Some(i) if (i.rect[0] - 258.0).abs() < 3.0 => {}
            other => problems.push(format!("square not moved: {:?}", other.map(|i| i.rect))),
        }
        if n("existing-line").map(|i| i.subtype) != Some(4) {
            problems.push("line not replaced".into());
        }
        if n("existing-note").is_some() || after.iter().flatten().any(|i| i.subtype == 16) {
            problems.push("note or its popup still there".into());
        }
        let w2 = Writer::open(out.clone(), "")?;
        let e2 = w2.annots(0)?;
        if e2.iter().find(|e| e.nm.as_deref() == Some("existing-square")).and_then(|e| e.id) != sq_id {
            problems.push("square changed object number".into());
        }
        drop(page);
        drop(doc);
        problems.extend(verify(pdfium, &orig, &out, "", &added, true, 2));
        println!(
            "{:<34} matched {}/{} by index, lift ok {}, edit {}",
            out_name,
            matched,
            entries.len(),
            hidden_same_page && hidden_after_reload && restored,
            if problems.is_empty() { "ok" } else { "PROBLEMS" }
        );
        println!("    PDFium hides a lifted annotation on the open page: {hidden_same_page}; after a reload: {hidden_after_reload}");
        for p in &problems {
            println!("    - {p}");
        }
        if !problems.is_empty() {
            *failed += 1;
        }
        std::fs::write(out_dir.join(format!("{out_name}.pdf")), &out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The "rebuild" save: PDFium rewrites the file (as page operations will), then our writer
/// appends. Also PDFium's own incremental save followed by ours.
fn pdfium_first(pdfium: &Pdfium, syn: &Path, out_dir: &Path, failed: &mut usize) -> Result<(), String> {
    let src = std::fs::read(syn.join("1-a1-200k-lines.pdf")).map_err(|e| e.to_string())?;
    for (flags, name) in [(0u32, "21-a1-pdfium-rewrite-then-vellum"), (1u32, "22-a1-pdfium-incremental-then-vellum")] {
        let doc = pdfium.open(src.clone(), None)?;
        {
            let page = doc.page(0)?;
            unsafe {
                let b = &*pdfium.b;
                let a = b.FPDFPage_CreateAnnot(page.h, 5);
                let r = pdfium_render::prelude::FS_RECTF { left: 100.0, top: 1600.0, right: 300.0, bottom: 1500.0 };
                b.FPDFAnnot_SetRect(a, &r);
                b.FPDFAnnot_SetColor(a, 0, 0, 128, 0, 255);
                b.FPDFAnnot_SetBorder(a, 0.0, 0.0, 3.0);
                b.FPDFAnnot_SetStringValue_str(a, "NM", "pdfium-square");
                b.FPDFPage_CloseAnnot(a);
            }
        }
        let rebuilt = doc.save(flags)?;
        drop(doc);
        let (out, added, _w, _) = annotate(&rebuilt, "", &[0], name)?;
        let mut problems = verify(pdfium, &rebuilt, &out, "", &added, true, 0);
        let d = pdfium.open(out.clone(), None)?;
        if !d.page(0)?.annots().iter().flatten().any(|i| i.nm == "pdfium-square") {
            problems.push("PDFium's own square lost".into());
        }
        println!("{:<34} {}", name, if problems.is_empty() { "ok" } else { "PROBLEMS" });
        for p in &problems {
            println!("    - {p}");
        }
        if !problems.is_empty() {
            *failed += 1;
        }
        std::fs::write(out_dir.join(format!("{name}.pdf")), &out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Load cost on a real file, then an append verified through PDFium. Nothing is written.
fn real(path: &Path, pw: &str) -> Result<(), String> {
    let m0 = memory::now();
    let t0 = Instant::now();
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let read_ms = t0.elapsed().as_secs_f64() * 1000.0;
    let m1 = memory::now();
    let (out, added, w, save_ms) = annotate(&bytes, pw, &[0], "real")?;
    let m2 = memory::now();
    let i = w.info.clone();
    drop(w);
    let pdfium = Pdfium::load()?;
    let mut problems = verify(&pdfium, &bytes, &out, pw, &added, false, 0);
    // Page order and existing annotations: lopdf's page n must be PDFium's page n, and each
    // /Annots entry must be PDFium's annotation at the same index.
    let w = Writer::open(bytes.clone(), pw)?;
    let d = pdfium.open(bytes.clone(), (!pw.is_empty()).then_some(pw))?;
    let (mut annots, mut matched, mut rotated) = (0, 0, 0);
    if d.pages() != w.info.pages {
        problems.push(format!("page count lopdf {} PDFium {}", w.info.pages, d.pages()));
    }
    for p in 0..d.pages().min(w.info.pages) {
        let (b, rot) = w.page_box(p)?;
        let page = d.page(p)?;
        let (pw_, ph_) = page.size();
        let (ew, eh) = if rot % 180 == 90 { (b[3] - b[1], b[2] - b[0]) } else { (b[2] - b[0], b[3] - b[1]) };
        if (pw_ as f64 - ew).abs() > 0.5 || (ph_ as f64 - eh).abs() > 0.5 {
            problems.push(format!("page {}: lopdf {ew:.1} x {eh:.1}, PDFium {pw_:.1} x {ph_:.1}", p + 1));
        }
        rotated += (rot != 0) as usize;
        let entries = w.annots(p)?;
        let infos = page.annots();
        annots += entries.len();
        if entries.len() != infos.len() {
            problems.push(format!("page {}: /Annots has {} entries, PDFium counts {}", p + 1, entries.len(), infos.len()));
        }
        for (e, i) in entries.iter().zip(infos.iter()) {
            let ok = match (e.rect, i) {
                (None, None) => true,
                (Some(r), Some(i)) => (0..4).all(|k| (r[k] - i.rect[k] as f64).abs() < 0.01),
                _ => false,
            };
            matched += ok as usize;
        }
    }
    println!("    pages {} (rotated {}), existing annotations {} of which matched by index {}", d.pages(), rotated, annots, matched);
    println!(
        "{} | {:.1} MB | {} objects | xref {} | enc {} | recovered {} | read {:.0} ms | lopdf load {:.0} ms | save {:.0} ms | +{:.1} KB | file in memory {:.0} MB | lopdf model {:.0} MB (after save {:.0} MB) | peak working set {:.0} MB | {}",
        path.file_name().unwrap().to_string_lossy(),
        bytes.len() as f64 / 1048576.0,
        i.objects,
        if i.xref_stream { "stream" } else { "table" },
        i.encryption.unwrap_or("-".into()),
        i.recovered,
        read_ms,
        i.load_ms,
        save_ms,
        (out.len() - bytes.len()) as f64 / 1024.0,
        m1.private_mb - m0.private_mb,
        m2.private_mb - m1.private_mb - 2.0 * bytes.len() as f64 / 1048576.0,
        m2.private_mb - m1.private_mb,
        m2.peak_ws_mb,
        if problems.is_empty() { "verified ok".to_string() } else { problems.join("; ") }
    );
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let res = match args.get(1).map(String::as_str) {
        Some("samples") => samples(),
        Some("real") if args.len() > 2 => real(Path::new(&args[2]), args.get(3).map(String::as_str).unwrap_or("")),
        _ => Err("usage: annot-writer-spike samples | real <file> [password]".into()),
    };
    if let Err(e) = res {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}
