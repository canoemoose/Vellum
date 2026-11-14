//! OCR one page, or one region of it (a marquee): render it in tiles through PDFium (on this
//! thread only: PDFium is not thread-safe), recognise each tile, keep each word from the tile
//! that owns it, map the boxes to page points, merge the passes (as displayed, and turned for
//! vertical text), then read misread clusters again on their own.
//!
//! With `jobs > 1` the tiles are recognised on that many threads while this thread renders the
//! next ones, which is how the app would do it: renders through `run_on_worker`, OCR off the
//! PDFium workers entirely.

use crate::geom::{PageWord, Tile, along_across, better_reading, clusters, merge_passes, owns, plan_tiles, suspect, to_page, turn_point, union};
use crate::ocr::{Ocr, Recognised};
use crate::pdf::{Gray, Page};
use std::sync::mpsc;
use std::time::Instant;

/// Re-reading clusters on their own (see `reread`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub enum Reread {
    Off,
    /// Only clusters that look misread (`geom::suspect`).
    Suspect,
    /// Every cluster (to find the ceiling).
    All,
}

#[derive(Clone, Debug)]
pub struct Options {
    pub dpi: f64,
    /// Largest tile side, px (the engine's own limit is `Ocr::max_dimension()`).
    pub max_tile: u32,
    pub overlap: u32,
    /// Passes: quarter turns clockwise of the render (0 as displayed; 1 reads text running
    /// bottom to top; 3 reads text running top to bottom).
    pub turns: Vec<i32>,
    /// Threads recognising tiles.
    pub jobs: usize,
    /// OCR language (BCP-47), or None for the user's profile languages.
    pub lang: Option<String>,
    /// Invert tiles that are mostly dark (light text on a dark ground) before OCR.
    pub auto_invert: bool,
    /// Read misread clusters again on their own.
    pub reread: Reread,
}

impl Default for Options {
    fn default() -> Self {
        Self { dpi: 300.0, max_tile: 1600, overlap: 300, turns: vec![0, 1, 3], jobs: 1, lang: None, auto_invert: true, reread: Reread::Suspect }
    }
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct PassStats {
    pub turns: i32,
    pub tiles: usize,
    pub pixels: u64,
    /// Words this pass kept from its tiles (before merging passes).
    pub words: usize,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct RereadStats {
    pub clusters: usize,
    pub tried: usize,
    pub replaced: usize,
    /// OCR time summed across threads, and wall-clock time of the whole stage, ms.
    pub ocr_ms: f64,
    pub wall_ms: f64,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct PageStats {
    pub passes: Vec<PassStats>,
    /// Summed time spent rendering, and recognising (across threads), ms. Includes re-reads.
    pub render_ms: f64,
    pub ocr_ms: f64,
    /// Wall-clock time for the page, ms.
    pub wall_ms: f64,
    /// The largest single tile's recognise time, ms (how long one OCR call can hold a thread).
    pub max_tile_ocr_ms: f64,
    /// Tiles inverted before OCR (dark ground).
    pub inverted: usize,
    pub reread: Option<RereadStats>,
}

pub fn engine(lang: &Option<String>) -> Result<Ocr, String> {
    match lang {
        Some(l) => Ocr::for_language(l),
        None => Ocr::from_user_languages(),
    }
}

/// What to recognise: a pixel region of the page rendered at `scale`, turned `turns`.
#[derive(Clone, Copy, Debug)]
struct Plan {
    turns: i32,
    scale: f64,
    tile: Tile,
}

struct Job {
    id: usize,
    img: Gray,
}

struct Done {
    plan: Plan,
    result: Recognised,
}

/// Render every plan on this thread (PDFium's) and recognise them on `o.jobs` threads.
/// Results come back in plan order.
fn run_plans(page: &Page, plans: &[Plan], o: &Options, stats: &mut PageStats) -> Result<Vec<Done>, String> {
    let jobs = o.jobs.max(1);
    let (tx, rx) = mpsc::sync_channel::<Job>(jobs);
    let rx = std::sync::Mutex::new(rx);
    let (rtx, rrx) = mpsc::channel::<(usize, Result<Recognised, String>, f64)>();
    std::thread::scope(|s| -> Result<(), String> {
        for _ in 0..jobs {
            let rx = &rx;
            let rtx = rtx.clone();
            let lang = o.lang.clone();
            s.spawn(move || {
                let ocr = match engine(&lang) {
                    Ok(e) => e,
                    Err(e) => {
                        eprintln!("[ocr] no engine: {e}");
                        return;
                    }
                };
                loop {
                    let job = match rx.lock().unwrap().recv() {
                        Ok(j) => j,
                        Err(_) => break,
                    };
                    let t = Instant::now();
                    let r = ocr.recognise_gray(&job.img.px, job.img.w, job.img.h, job.img.stride);
                    let ms = t.elapsed().as_secs_f64() * 1000.0;
                    if rtx.send((job.id, r, ms)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(rtx);
        for (id, p) in plans.iter().enumerate() {
            let tr = Instant::now();
            let mut img = page.render_gray(p.scale, p.turns, [p.tile.x, p.tile.y, p.tile.w, p.tile.h])?;
            if o.auto_invert && crate::image::is_dark(&img.px, img.w, img.h, img.stride) {
                crate::image::invert(&mut img.px);
                stats.inverted += 1;
            }
            stats.render_ms += tr.elapsed().as_secs_f64() * 1000.0;
            if tx.send(Job { id, img }).is_err() {
                return Err("OCR threads stopped".into());
            }
        }
        drop(tx);
        Ok(())
    })?;
    let mut out = Vec::new();
    for (id, r, ms) in rrx.try_iter() {
        let result = r?;
        let p = plans[id];
        if std::env::var_os("OCR_SPIKE_DEBUG").is_some() {
            eprintln!(
                "[ocr] turn {} tile {},{} {}x{}: {} words, {} lines, angle {:?}, {:.0} ms",
                p.turns, p.tile.x, p.tile.y, p.tile.w, p.tile.h, result.words.len(), result.lines, result.text_angle, ms
            );
        }
        stats.ocr_ms += ms;
        stats.max_tile_ocr_ms = stats.max_tile_ocr_ms.max(ms);
        out.push((id, Done { plan: p, result }));
    }
    if out.len() != plans.len() {
        return Err("an OCR thread failed".into());
    }
    out.sort_by_key(|(id, _)| *id);
    Ok(out.into_iter().map(|(_, d)| d).collect())
}

/// The words of one recognised plan that its tile owns, in page points.
fn collect(d: Done, next_line: &mut u32, pw: f32, ph: f32) -> Vec<PageWord> {
    let base = *next_line;
    *next_line += d.result.lines;
    let (t, s) = (d.plan.tile, d.plan.scale as f32);
    let mut out = Vec::new();
    for w in d.result.words {
        if !owns(&t, &w.rect) {
            continue;
        }
        let px = [w.rect[0] + t.x as f32, w.rect[1] + t.y as f32, w.rect[2] + t.x as f32, w.rect[3] + t.y as f32];
        out.push(PageWord { text: w.text, rect: to_page(&px, s, d.plan.turns, pw, ph), turns: d.plan.turns, line: base + w.line, alt: false });
    }
    out
}

/// A page-point rectangle as a pixel rectangle [x, y, w, h] of the page rendered at `scale`,
/// turned `turns`, clamped to the render.
pub fn region_px(r: &[f32; 4], turns: i32, scale: f64, page: &Page) -> [u32; 4] {
    let (pw, ph) = page.size();
    let (fw, fh) = page.pixel_size(scale, turns);
    let (ax, ay) = turn_point(r[0], r[1], turns, pw, ph);
    let (bx, by) = turn_point(r[2], r[3], turns, pw, ph);
    let s = scale as f32;
    let x0 = ((ax.min(bx) * s).floor().max(0.0) as u32).min(fw);
    let y0 = ((ay.min(by) * s).floor().max(0.0) as u32).min(fh);
    let x1 = ((ax.max(bx) * s).ceil().max(0.0) as u32).min(fw);
    let y1 = ((ay.max(by) * s).ceil().max(0.0) as u32).min(fh);
    [x0, y0, x1.saturating_sub(x0), y1.saturating_sub(y0)]
}

/// OCR one page. Returns the merged words (page points, y down) and timings.
pub fn ocr_page(page: &Page, o: &Options) -> Result<(Vec<PageWord>, PageStats), String> {
    ocr_region(page, None, o)
}

/// OCR part of a page (a marquee, page points), or all of it. A word belongs to the region
/// when its centre lies inside it.
pub fn ocr_region(page: &Page, region: Option<[f32; 4]>, o: &Options) -> Result<(Vec<PageWord>, PageStats), String> {
    let t0 = Instant::now();
    let scale = o.dpi / 72.0;
    let (pw, ph) = page.size();
    let mut stats = PageStats::default();
    let mut plans = Vec::new();
    for &t in &o.turns {
        let (fw, fh) = page.pixel_size(scale, t);
        let [rx, ry, rw, rh] = match region {
            Some(r) => region_px(&r, t, scale, page),
            None => [0, 0, fw, fh],
        };
        if rw == 0 || rh == 0 {
            continue;
        }
        let tiles: Vec<Tile> = plan_tiles(rw, rh, o.max_tile, o.overlap)
            .into_iter()
            .map(|mut tl| {
                tl.x += rx;
                tl.y += ry;
                tl.core = [tl.core[0] + rx as f32, tl.core[1] + ry as f32, tl.core[2] + rx as f32, tl.core[3] + ry as f32];
                tl
            })
            .collect();
        stats.passes.push(PassStats { turns: t, tiles: tiles.len(), pixels: tiles.iter().map(|t| t.w as u64 * t.h as u64).sum(), words: 0 });
        plans.extend(tiles.into_iter().map(|tile| Plan { turns: t, scale, tile }));
    }
    let done = run_plans(page, &plans, o, &mut stats)?;
    let mut words = Vec::new();
    let mut next_line = 0u32;
    for d in done {
        let t = d.plan.turns;
        let got = collect(d, &mut next_line, pw, ph);
        if let Some(p) = stats.passes.iter_mut().find(|p| p.turns == t) {
            p.words += got.len();
        }
        words.extend(got);
    }
    let mut words = if o.turns.len() > 1 { merge_passes(words) } else { words };
    if o.reread != Reread::Off {
        stats.reread = Some(reread(page, &mut words, o, &mut stats)?);
    }
    stats.wall_ms = t0.elapsed().as_secs_f64() * 1000.0;
    Ok((words, stats))
}

/// Text height a cluster is enlarged to before it is read again, px.
const REREAD_TEXT_PX: f32 = 40.0;

/// Read clusters again, each cropped on its own with a margin of white and enlarged so its
/// text is about 40 px high: away from the symbols and line work around it, the engine reads
/// codes it broke into pieces on the whole page. A better reading (`geom::better_reading`)
/// replaces the cluster; the original words stay as search-only alternates.
fn reread(page: &Page, words: &mut Vec<PageWord>, o: &Options, stats: &mut PageStats) -> Result<RereadStats, String> {
    let t0 = Instant::now();
    let (pw, ph) = page.size();
    let cl = clusters(words);
    let mut rs = RereadStats { clusters: cl.len(), ..Default::default() };
    let mut chosen = Vec::new();
    let mut plans = Vec::new();
    for c in cl {
        if o.reread == Reread::Suspect && !suspect(words, &c) {
            continue;
        }
        let t = words[c[0]].turns;
        let b = union(words, &c);
        let (_, across) = along_across(&b, t);
        let h = (across.1 - across.0).max(1.0);
        let scale = ((REREAD_TEXT_PX / h) as f64).clamp(o.dpi / 72.0, 1200.0 / 72.0);
        // A margin all round, and a text height more along the line in case an end was lost.
        let pad = 0.6 * h;
        let crop = if t % 2 == 1 {
            [b[0] - pad, b[1] - pad - h, b[2] + pad, b[3] + pad + h]
        } else {
            [b[0] - pad - h, b[1] - pad, b[2] + pad + h, b[3] + pad]
        };
        let [x, y, w, hh] = region_px(&crop, t, scale, page);
        if w < 8 || hh < 8 || w > o.max_tile.max(4096) || hh > o.max_tile.max(4096) {
            continue;
        }
        let tile = Tile { x, y, w, h: hh, core: [x as f32, y as f32, (x + w) as f32, (y + hh) as f32] };
        plans.push(Plan { turns: t, scale, tile });
        chosen.push((c, b, h));
    }
    rs.tried = plans.len();
    let mut sub = PageStats::default();
    let done = run_plans(page, &plans, o, &mut sub)?;
    rs.ocr_ms = sub.ocr_ms;
    stats.render_ms += sub.render_ms;
    stats.ocr_ms += sub.ocr_ms;
    stats.inverted += sub.inverted;
    let mut next_line = words.iter().map(|w| w.line).max().map_or(0, |l| l + 1);
    let mut additions = Vec::new();
    for ((c, b, h), d) in chosen.into_iter().zip(done) {
        // Keep what lies on the cluster itself, not neighbours caught in the margin.
        let slack = 0.3 * h;
        let inside = [b[0] - slack, b[1] - slack, b[2] + slack, b[3] + slack];
        let line = next_line;
        let new: Vec<PageWord> = collect(d, &mut next_line, pw, ph)
            .into_iter()
            .filter(|w| {
                let (cx, cy) = ((w.rect[0] + w.rect[2]) / 2.0, (w.rect[1] + w.rect[3]) / 2.0);
                cx >= inside[0] && cx <= inside[2] && cy >= inside[1] && cy <= inside[3]
            })
            .map(|mut w| {
                w.line = line;
                w
            })
            .collect();
        let old: Vec<&PageWord> = c.iter().map(|&i| &words[i]).collect();
        if better_reading(&old, &new.iter().collect::<Vec<_>>()) {
            for &i in &c {
                words[i].alt = true;
            }
            additions.extend(new);
            rs.replaced += 1;
        }
    }
    words.extend(additions);
    rs.wall_ms = t0.elapsed().as_secs_f64() * 1000.0;
    Ok(rs)
}
