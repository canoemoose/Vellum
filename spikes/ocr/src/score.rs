//! Scoring OCR against a page's known text. Pure.
//!
//! The truth is the page's own text layer, split into words. A truth word is **found** when an
//! OCR word overlapping it (more than half of the smaller box) reads the same, ignoring case
//! and trailing punctuation: that is what search needs. It is **near** when the best
//! overlapping reading is one edit away, or the overlapping OCR words joined without spaces
//! read the same (the engine split or merged it): a fuzzy or space-insensitive search would
//! still find those. Anything else is **missed**. On the OCR side, a word overlapping no truth
//! word is **junk** (it would turn up as a false hit only if someone searched for it).

use crate::geom::{PageWord, TruthWord, overlap_ratio};
use std::collections::BTreeMap;

/// Lower case, trailing and leading sentence punctuation dropped, look-alike symbols folded.
pub fn normalise(s: &str) -> String {
    let t: String = s
        .chars()
        .map(|c| match c {
            '\u{2013}' | '\u{2014}' | '\u{2212}' => '-',
            '\u{00d7}' => 'x',
            c => c,
        })
        .flat_map(char::to_lowercase)
        .collect();
    t.trim_matches(|c: char| ".,;:".contains(c)).to_string()
}

/// Levenshtein distance over characters.
pub fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        for j in 1..=b.len() {
            let sub = prev[j - 1] + usize::from(a[i - 1] != b[j - 1]);
            cur[j] = sub.min(prev[j] + 1).min(cur[j - 1] + 1);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize)]
pub struct Tally {
    pub truth: usize,
    pub found: usize,
    pub near: usize,
}

impl Tally {
    pub fn recall(&self) -> f64 {
        if self.truth == 0 { 0.0 } else { self.found as f64 / self.truth as f64 }
    }
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct Score {
    pub all: Tally,
    /// By font size bucket ("<3", "3-4", "4-6", "6-9", "9+" points).
    pub by_size: BTreeMap<String, Tally>,
    /// By angle as displayed ("0", "90", "180", "270", "other"), anticlockwise.
    pub by_angle: BTreeMap<String, Tally>,
    pub ocr_words: usize,
    pub junk: usize,
}

pub fn size_bucket(pt: f32) -> &'static str {
    match pt {
        p if p < 3.0 => "a <3",
        p if p < 4.0 => "b 3-4",
        p if p < 6.0 => "c 4-6",
        p if p < 9.0 => "d 6-9",
        _ => "e 9+",
    }
}

pub fn angle_bucket(deg: f32) -> &'static str {
    let d = deg.rem_euclid(360.0);
    for (c, name) in [(0.0, "0"), (90.0, "90"), (180.0, "180"), (270.0, "270"), (360.0, "0")] {
        if (d - c).abs() <= 5.0 {
            return name;
        }
    }
    "other"
}

/// A coarse spatial index of boxes (cells of `CELL` points), so scoring a page with tens of
/// thousands of words stays fast.
pub struct Grid {
    cells: std::collections::HashMap<(i32, i32), Vec<usize>>,
}

const CELL: f32 = 24.0;

fn cells(r: &[f32; 4]) -> impl Iterator<Item = (i32, i32)> {
    let (x0, y0) = ((r[0] / CELL).floor() as i32, (r[1] / CELL).floor() as i32);
    let (x1, y1) = ((r[2] / CELL).floor() as i32, (r[3] / CELL).floor() as i32);
    (y0..=y1).flat_map(move |y| (x0..=x1).map(move |x| (x, y)))
}

impl Grid {
    pub fn new<'a>(rects: impl Iterator<Item = &'a [f32; 4]>) -> Self {
        let mut cellmap: std::collections::HashMap<(i32, i32), Vec<usize>> = Default::default();
        for (i, r) in rects.enumerate() {
            for c in cells(r) {
                cellmap.entry(c).or_default().push(i);
            }
        }
        Self { cells: cellmap }
    }

    /// Indices of boxes that may touch `r` (each once).
    pub fn near(&self, r: &[f32; 4]) -> Vec<usize> {
        let mut v: Vec<usize> = cells(r).filter_map(|c| self.cells.get(&c)).flatten().copied().collect();
        v.sort_unstable();
        v.dedup();
        v
    }
}

/// Outcome for one truth word: 2 found, 1 near, 0 missed.
pub fn judge(t: &TruthWord, ocr: &[PageWord]) -> u8 {
    judge_in(t, ocr, &(0..ocr.len()).collect::<Vec<_>>())
}

fn judge_in(t: &TruthWord, ocr: &[PageWord], candidates: &[usize]) -> u8 {
    let want = normalise(&t.text);
    if want.is_empty() {
        return 2;
    }
    let mut over: Vec<&PageWord> = candidates.iter().map(|&i| &ocr[i]).filter(|w| overlap_ratio(&w.rect, &t.rect) > 0.5).collect();
    if over.iter().any(|w| normalise(&w.text) == want) {
        return 2;
    }
    let near_one = over.iter().any(|w| edit_distance(&normalise(&w.text), &want) <= 1);
    over.sort_by(|a, b| (a.line, a.rect[0] as i32, a.rect[1] as i32).cmp(&(b.line, b.rect[0] as i32, b.rect[1] as i32)));
    let joined: String = over.iter().map(|w| normalise(&w.text)).collect();
    if near_one || (!joined.is_empty() && (joined == want || joined.contains(&want))) {
        return 1;
    }
    0
}

pub fn score(truth: &[TruthWord], ocr: &[PageWord]) -> Score {
    let mut s = Score { ocr_words: ocr.len(), ..Default::default() };
    let og = Grid::new(ocr.iter().map(|w| &w.rect));
    for t in truth {
        let j = judge_in(t, ocr, &og.near(&t.rect));
        for tally in [
            &mut s.all,
            s.by_size.entry(size_bucket(t.size).to_string()).or_default(),
            s.by_angle.entry(angle_bucket(t.angle).to_string()).or_default(),
        ] {
            tally.truth += 1;
            tally.found += usize::from(j == 2);
            tally.near += usize::from(j == 1);
        }
    }
    let tg = Grid::new(truth.iter().map(|t| &t.rect));
    s.junk = ocr.iter().filter(|w| !tg.near(&w.rect).iter().any(|&i| overlap_ratio(&w.rect, &truth[i].rect) > 0.0)).count();
    s
}
