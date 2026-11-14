//! The spike's runner. Output goes to bench-output/ocr/ (git-ignored). Log strings are ASCII.
//!
//!   ocr-spike langs
//!   ocr-spike fixture
//!   ocr-spike bench <file.pdf> [--truth file.pdf] [--pages 1,2] [--dpi 150,200,300]
//!       [--turns 0,1,3] [--tile 4096] [--overlap 400] [--jobs 1] [--lang en-GB] [--tag name]
//!       [--no-words]
//!   ocr-spike dump <file.pdf> [--page 1] [--dpi 200] [--turns 0,1,3]

#[cfg(not(windows))]
fn main() {
    eprintln!("Windows only");
}

#[cfg(windows)]
fn main() {
    if let Err(e) = win::run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

#[cfg(windows)]
mod win {
    use ocr_spike::geom::TruthWord;
    use ocr_spike::memory;
    use ocr_spike::ocr::Ocr;
    use ocr_spike::pdf::{Pdfium, drawing_pdf, image_only_pdf};
    use ocr_spike::pipeline::{Options, ocr_page};
    use ocr_spike::score::score;
    use ocr_spike::fixture;
    use std::io::Write;
    use std::path::{Path, PathBuf};

    fn out_dir() -> PathBuf {
        let d = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../bench-output/ocr");
        std::fs::create_dir_all(&d).ok();
        d
    }

    struct Args {
        pos: Vec<String>,
        flags: std::collections::HashMap<String, String>,
    }

    fn parse() -> Args {
        let mut pos = Vec::new();
        let mut flags = std::collections::HashMap::new();
        let mut it = std::env::args().skip(1).peekable();
        while let Some(a) = it.next() {
            if let Some(k) = a.strip_prefix("--") {
                let v = if it.peek().is_some_and(|n| !n.starts_with("--")) { it.next().unwrap() } else { String::new() };
                flags.insert(k.to_string(), v);
            } else {
                pos.push(a);
            }
        }
        Args { pos, flags }
    }

    fn list<T: std::str::FromStr>(s: Option<&String>, default: &str) -> Vec<T> {
        s.map(|s| s.as_str()).unwrap_or(default).split(',').filter_map(|v| v.trim().parse().ok()).collect()
    }

    pub fn run() -> Result<(), String> {
        let a = parse();
        match a.pos.first().map(|s| s.as_str()) {
            Some("langs") => langs(),
            Some("fixture") => make_fixture(),
            Some("bench") => bench(&a),
            Some("dump") => dump(&a),
            Some("info") => info(&a),
            _ => Err("usage: ocr-spike langs | fixture | bench <pdf> [...] | dump <pdf> [...]".into()),
        }
    }

    fn langs() -> Result<(), String> {
        println!("installed OCR languages: {:?}", Ocr::available_languages()?);
        println!("max image dimension: {} px", Ocr::max_dimension()?);
        match Ocr::from_user_languages() {
            Ok(o) => println!("engine for the user's profile languages: {}", o.language()),
            Err(e) => println!("engine for the user's profile languages: none ({e})"),
        }
        for tag in ["en", "en-GB", "en-US", "fr-FR", "de-DE", "ja-JP", "xx-YY"] {
            match Ocr::for_language(tag) {
                Ok(o) => println!("  {tag}: yes ({})", o.language()),
                Err(e) => println!("  {tag}: no ({e})"),
            }
        }
        Ok(())
    }

    fn make_fixture() -> Result<(), String> {
        let p = Pdfium::load()?;
        let dir = out_dir();
        use fixture::Variant;
        for v in [Variant::DRAWING, Variant::CLEAN, Variant::LINE_WORK, Variant::UNDERLINED] {
            let (items, lines) = fixture::layout(1, v);
            for rot in [0, 1] {
                if rot == 1 && v != Variant::DRAWING {
                    continue;
                }
                let bytes = drawing_pdf(&p, &items, &lines, rot)?;
                let name = format!("fixture-{}{}.pdf", v.name(), if rot == 1 { "-rot90" } else { "" });
                std::fs::write(dir.join(&name), &bytes).map_err(|e| e.to_string())?;
                println!("wrote {name} ({} KB, {} text items)", bytes.len() / 1024, items.len());
            }
        }
        // Image-only "scans" of the fixture and of a page of two synthetic files.
        let synth = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../bench-output/synthetic");
        let mut sources: Vec<(String, PathBuf, usize)> = vec![("fixture-drawing".into(), dir.join("fixture-drawing.pdf"), 0)];
        for (n, f) in [("a3-sheet", "3-a3-40-pages.pdf"), ("a4-text", "5-a4-300-pages.pdf")] {
            if synth.join(f).exists() {
                sources.push((n.into(), synth.join(f), 0));
            } else {
                println!("skipped {f}: run npm run gen:synthetic first");
            }
        }
        for (name, path, page) in sources {
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            let doc = p.open(bytes)?;
            let pg = doc.page(page)?;
            for dpi in [150.0, 200.0, 300.0] {
                let scan = image_only_pdf(&p, &pg, dpi)?;
                let out = format!("scan-{name}-{dpi}.pdf");
                std::fs::write(dir.join(&out), &scan).map_err(|e| e.to_string())?;
                println!("wrote {out} ({} KB)", scan.len() / 1024);
            }
        }
        Ok(())
    }

    fn options(a: &Args) -> Options {
        let d = Options::default();
        Options {
            dpi: d.dpi,
            max_tile: a.flags.get("tile").and_then(|v| v.parse().ok()).unwrap_or(d.max_tile),
            overlap: a.flags.get("overlap").and_then(|v| v.parse().ok()).unwrap_or(d.overlap),
            turns: list(a.flags.get("turns"), "0,1,3"),
            jobs: a.flags.get("jobs").and_then(|v| v.parse().ok()).unwrap_or(1),
            lang: a.flags.get("lang").cloned(),
            auto_invert: !a.flags.contains_key("no-invert"),
        }
    }

    fn bench(a: &Args) -> Result<(), String> {
        let path = a.pos.get(1).ok_or("bench needs a PDF")?;
        let p = Pdfium::load()?;
        let doc = p.open(std::fs::read(path).map_err(|e| format!("{path}: {e}"))?)?;
        let truth_doc = match a.flags.get("truth") {
            Some(t) => Some(p.open(std::fs::read(t).map_err(|e| format!("{t}: {e}"))?)?),
            None => None,
        };
        let pages: Vec<usize> = list(a.flags.get("pages"), "1");
        let dpis: Vec<f64> = list(a.flags.get("dpi"), "200");
        let base = options(a);
        let name = Path::new(path).file_name().unwrap().to_string_lossy().to_string();
        let tag = a.flags.get("tag").cloned().unwrap_or_default();
        let mut log = std::fs::OpenOptions::new().create(true).append(true).open(out_dir().join("results.jsonl")).map_err(|e| e.to_string())?;
        println!("{name}: {} pages; turns {:?}, tile {}, overlap {}, jobs {}", doc.page_count(), base.turns, base.max_tile, base.overlap, base.jobs);
        for &pn in &pages {
            let page = doc.page(pn - 1)?;
            let (imgs, others) = page.object_counts();
            let truth: Vec<TruthWord> = match &truth_doc {
                Some(td) => td.page(pn - 1)?.truth_words(),
                None => page.truth_words(),
            };
            let (w, h) = page.size();
            println!(
                "page {pn}: {:.0} x {:.0} pt, {} chars in its own text layer, {imgs} images + {others} other objects, {} truth words",
                w, h, page.char_count(), truth.len()
            );
            for &dpi in &dpis {
                let o = Options { dpi, ..base.clone() };
                let m0 = memory::now();
                let c0 = memory::cpu_ms();
                let (words, st) = ocr_page(&page, &o)?;
                let cpu = memory::cpu_ms() - c0;
                let m1 = memory::now();
                let primary: Vec<_> = words.iter().filter(|w| !w.alt).cloned().collect();
                let sc = score(&truth, &primary);
                let sc_search = score(&truth, &words);
                let (px_w, px_h) = page.pixel_size(dpi / 72.0, 0);
                println!(
                    "  {dpi:>3} dpi {px_w}x{px_h}: tiles {:?} ({} inverted); render {:.0} ms, ocr {:.0} ms (largest tile {:.0}), wall {:.0} ms, cpu {:.0} ms; ws {:.0} MB (peak {:.0}), private {:+.0} MB",
                    st.passes.iter().map(|p| p.tiles).collect::<Vec<_>>(), st.inverted, st.render_ms, st.ocr_ms, st.max_tile_ocr_ms, st.wall_ms, cpu, m1.ws_mb, m1.peak_ws_mb, m1.private_mb - m0.private_mb
                );
                if sc.all.truth > 0 {
                    println!(
                        "    found {}/{} ({:.1}%), near {}, ocr words {}, junk {}",
                        sc.all.found, sc.all.truth, 100.0 * sc.all.recall(), sc.all.near, sc.ocr_words, sc.junk
                    );
                    if sc_search.ocr_words != sc.ocr_words {
                        println!(
                            "    with alternates (search): found {}/{} ({:.1}%), ocr words {}, junk {}",
                            sc_search.all.found, sc_search.all.truth, 100.0 * sc_search.all.recall(), sc_search.ocr_words, sc_search.junk
                        );
                    }
                    let fmt = |m: &std::collections::BTreeMap<String, ocr_spike::score::Tally>| {
                        m.iter().map(|(k, t)| format!("{k}: {:.0}% ({}/{}, near {})", 100.0 * t.recall(), t.found, t.truth, t.near)).collect::<Vec<_>>().join("; ")
                    };
                    println!("    by size  {}", fmt(&sc.by_size));
                    println!("    by angle {}", fmt(&sc.by_angle));
                } else {
                    println!("    ocr words {} (no truth to score against)", sc.ocr_words);
                }
                let rec = serde_json::json!({
                    "file": name, "tag": tag, "page": pn, "dpi": dpi, "turns": o.turns, "tile": o.max_tile,
                    "overlap": o.overlap, "jobs": o.jobs, "stats": st, "cpu_ms": cpu, "score": sc, "score_search": sc_search,
                    "ws_mb": m1.ws_mb, "peak_ws_mb": m1.peak_ws_mb,
                });
                writeln!(log, "{rec}").ok();
                if a.flags.contains_key("missed") {
                    for t in &truth {
                        if ocr_spike::score::judge(t, &words) == 2 || ocr_spike::score::angle_bucket(t.angle) != "0" {
                            continue;
                        }
                        let near: Vec<String> = words
                            .iter()
                            .filter(|w| ocr_spike::geom::intersection(&w.rect, &[t.rect[0] - 4.0, t.rect[1] - 4.0, t.rect[2] + 4.0, t.rect[3] + 4.0]) > 0.0)
                            .map(|w| format!("{:?}{:?}", w.text, w.rect.map(|v| v.round())))
                            .collect();
                        println!("      missed {:?} {:.1}pt {:?} near: {}", t.text, t.size, t.rect.map(|v| v.round()), near.join(" "));
                    }
                }
                if !a.flags.contains_key("no-words") && a.flags.contains_key("words") {
                    for w in &words {
                        println!("      {:?} {:?} t{}", w.text, w.rect.map(|v| v.round()), w.turns);
                    }
                }
            }
        }
        Ok(())
    }

    fn info(a: &Args) -> Result<(), String> {
        let path = a.pos.get(1).ok_or("info needs a PDF")?;
        let p = Pdfium::load()?;
        let doc = p.open(std::fs::read(path).map_err(|e| e.to_string())?)?;
        for i in 0..doc.page_count() {
            let pg = doc.page(i)?;
            let (w, h) = pg.size();
            let (im, other) = pg.object_counts();
            println!("page {}: {:.0} x {:.0} pt, {} chars, {im} images, {other} other objects", i + 1, w, h, pg.char_count());
        }
        Ok(())
    }

    fn dump(a: &Args) -> Result<(), String> {
        let path = a.pos.get(1).ok_or("dump needs a PDF")?;
        let p = Pdfium::load()?;
        let doc = p.open(std::fs::read(path).map_err(|e| e.to_string())?)?;
        let pn: usize = a.flags.get("page").and_then(|v| v.parse().ok()).unwrap_or(1);
        let mut o = options(a);
        o.dpi = a.flags.get("dpi").and_then(|v| v.parse().ok()).unwrap_or(200.0);
        let page = doc.page(pn - 1)?;
        if let Some(region) = a.flags.get("save") {
            // --save x,y,w,h: write that pixel region of the render (turn 0) as PNG.
            let r: Vec<u32> = list(Some(region), "");
            let g = page.render_gray(o.dpi / 72.0, o.turns[0], [r[0], r[1], r[2], r[3]])?;
            let out = out_dir().join("region.png");
            ocr_spike::pdf::save_png(&g, &out)?;
            println!("wrote {}", out.display());
        }
        let (words, st) = ocr_page(&page, &o)?;
        println!("{} words, {:.0} ms", words.len(), st.wall_ms);
        for w in &words {
            println!("{:?} {:?} t{} l{}{}", w.text, w.rect.map(|v| v.round()), w.turns, w.line, if w.alt { " alt" } else { "" });
        }
        if a.flags.contains_key("truth") {
            for t in page.truth_words() {
                println!("truth {:?} {:?} {:.1}pt {:.0}deg", t.text, t.rect.map(|v| v.round()), t.size, t.angle);
            }
        }
        Ok(())
    }
}
