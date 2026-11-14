//! OCR one page: render it in tiles through PDFium (on this thread only: PDFium is not
//! thread-safe), recognise each tile, keep each word from the tile that owns it, map the boxes
//! to page points, and merge the passes (as displayed, and turned for vertical text).
//!
//! With `jobs > 1` the tiles are recognised on that many threads while this thread renders the
//! next ones, which is how the app would do it: renders through `run_on_worker`, OCR off the
//! PDFium workers entirely.

use crate::geom::{PageWord, merge_passes, owns, plan_tiles, to_page};
use crate::ocr::{Ocr, Recognised};
use crate::pdf::{Gray, Page};
use std::sync::mpsc;
use std::time::Instant;

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
}

impl Default for Options {
    fn default() -> Self {
        Self { dpi: 300.0, max_tile: 1600, overlap: 300, turns: vec![0, 1, 3], jobs: 1, lang: None, auto_invert: true }
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
pub struct PageStats {
    pub passes: Vec<PassStats>,
    /// Summed time spent rendering, and recognising (across threads), ms.
    pub render_ms: f64,
    pub ocr_ms: f64,
    /// Wall-clock time for the page, ms.
    pub wall_ms: f64,
    /// The largest single tile's recognise time, ms (how long one OCR call can hold a thread).
    pub max_tile_ocr_ms: f64,
    /// Tiles inverted before OCR (dark ground).
    pub inverted: usize,
}

pub fn engine(lang: &Option<String>) -> Result<Ocr, String> {
    match lang {
        Some(l) => Ocr::for_language(l),
        None => Ocr::from_user_languages(),
    }
}

struct Job {
    turns: i32,
    tile: crate::geom::Tile,
    img: Gray,
}

fn collect(words: &mut Vec<PageWord>, next_line: &mut u32, job: &Job, r: Recognised, scale: f32, pw: f32, ph: f32) -> usize {
    let base = *next_line;
    *next_line += r.lines;
    let mut n = 0;
    for w in r.words {
        if !owns(&job.tile, &w.rect) {
            continue;
        }
        let px = [w.rect[0] + job.tile.x as f32, w.rect[1] + job.tile.y as f32, w.rect[2] + job.tile.x as f32, w.rect[3] + job.tile.y as f32];
        words.push(PageWord { text: w.text, rect: to_page(&px, scale, job.turns, pw, ph), turns: job.turns, line: base + w.line, alt: false });
        n += 1;
    }
    n
}

/// OCR one page. Returns the merged words (page points, y down) and timings.
pub fn ocr_page(page: &Page, o: &Options) -> Result<(Vec<PageWord>, PageStats), String> {
    let t0 = Instant::now();
    let scale = o.dpi / 72.0;
    let (pw, ph) = page.size();
    let mut stats = PageStats::default();
    let mut words = Vec::new();
    let mut next_line = 0u32;
    let mut plans = Vec::new();
    for &t in &o.turns {
        let (w, h) = page.pixel_size(scale, t);
        let tiles = plan_tiles(w, h, o.max_tile, o.overlap);
        stats.passes.push(PassStats { turns: t, tiles: tiles.len(), pixels: tiles.iter().map(|t| t.w as u64 * t.h as u64).sum(), words: 0 });
        plans.extend(tiles.into_iter().map(|tile| (t, tile)));
    }
    let jobs = o.jobs.max(1);
    let (tx, rx) = mpsc::sync_channel::<Job>(jobs);
    let rx = std::sync::Mutex::new(rx);
    let (rtx, rrx) = mpsc::channel::<(Job, Result<Recognised, String>, f64)>();
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
                    if rtx.send((job, r, ms)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(rtx);
        // Render on this thread (PDFium's), feeding the OCR threads.
        for (t, tile) in plans {
            let tr = Instant::now();
            let mut img = page.render_gray(scale, t, [tile.x, tile.y, tile.w, tile.h])?;
            if o.auto_invert && crate::image::is_dark(&img.px, img.w, img.h, img.stride) {
                crate::image::invert(&mut img.px);
                stats.inverted += 1;
            }
            stats.render_ms += tr.elapsed().as_secs_f64() * 1000.0;
            if tx.send(Job { turns: t, tile, img }).is_err() {
                return Err("OCR threads stopped".into());
            }
        }
        drop(tx);
        Ok(())
    })?;
    for (job, r, ms) in rrx.try_iter() {
        let r = r?;
        if std::env::var_os("OCR_SPIKE_DEBUG").is_some() {
            eprintln!("[ocr] turn {} tile {},{} {}x{}: {} words, {} lines, angle {:?}, {:.0} ms", job.turns, job.tile.x, job.tile.y, job.tile.w, job.tile.h, r.words.len(), r.lines, r.text_angle, ms);
        }
        stats.ocr_ms += ms;
        stats.max_tile_ocr_ms = stats.max_tile_ocr_ms.max(ms);
        let n = collect(&mut words, &mut next_line, &job, r, scale as f32, pw, ph);
        if let Some(p) = stats.passes.iter_mut().find(|p| p.turns == job.turns) {
            p.words += n;
        }
    }
    let words = if o.turns.len() > 1 { merge_passes(words) } else { words };
    stats.wall_ms = t0.elapsed().as_secs_f64() * 1000.0;
    Ok((words, stats))
}
