//! Searching OCR words. Pure.
//!
//! The text of each OCR line is its primary words joined by single spaces (alternates are
//! searched separately, one word at a time). Two matchers:
//!
//! - **strict**: case-insensitive substring, as PDFium's own search behaves on a real text layer;
//! - **forgiving**: also folds characters the engine confuses (O and 0, I, l and 1, S and 5,
//!   B and 8, Z and 2) on both sides, and ignores spaces, so a code the engine read in pieces
//!   ("D2.1" "0A") or with a look-alike ("D2.O5A") is still found.
//!
//! A hit is the boxes of the words it touches.

use crate::geom::PageWord;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Strict,
    Forgiving,
}

/// One character as compared. None: dropped (spaces in forgiving mode).
pub fn fold(c: char, mode: Mode) -> Vec<char> {
    let lower: Vec<char> = c.to_lowercase().collect();
    if mode == Mode::Strict {
        return lower;
    }
    lower
        .into_iter()
        .filter(|c| !c.is_whitespace())
        .map(|c| match c {
            'o' => '0',
            'i' | 'l' | '|' => '1',
            's' => '5',
            'b' => '8',
            'z' => '2',
            '\u{2013}' | '\u{2014}' | '\u{2212}' => '-',
            '\u{00d7}' => 'x',
            c => c,
        })
        .collect()
}

/// A searchable run of text: folded characters, each with the word it came from.
struct Run {
    chars: Vec<char>,
    word: Vec<usize>,
}

fn runs(words: &[PageWord], mode: Mode) -> Vec<Run> {
    let mut by_line: std::collections::BTreeMap<u32, Vec<usize>> = Default::default();
    let mut out = Vec::new();
    for (i, w) in words.iter().enumerate() {
        if w.alt {
            out.push(single(words, i, mode));
        } else {
            by_line.entry(w.line).or_default().push(i);
        }
    }
    for (_, mut idx) in by_line {
        // Reading order within the line: along x for the upright pass, along the turned axis
        // otherwise (a line's words all come from one pass).
        let t = words[idx[0]].turns;
        idx.sort_by(|&a, &b| {
            let (ra, rb) = (&words[a].rect, &words[b].rect);
            match t {
                1 => rb[3].total_cmp(&ra[3]),
                3 => ra[1].total_cmp(&rb[1]),
                2 => rb[2].total_cmp(&ra[2]),
                _ => ra[0].total_cmp(&rb[0]),
            }
        });
        let mut r = Run { chars: Vec::new(), word: Vec::new() };
        for (k, &i) in idx.iter().enumerate() {
            if k > 0 {
                for c in fold(' ', mode) {
                    r.chars.push(c);
                    r.word.push(i);
                }
            }
            for ch in words[i].text.chars() {
                for c in fold(ch, mode) {
                    r.chars.push(c);
                    r.word.push(i);
                }
            }
        }
        out.push(r);
    }
    out
}

fn single(words: &[PageWord], i: usize, mode: Mode) -> Run {
    let mut r = Run { chars: Vec::new(), word: Vec::new() };
    for ch in words[i].text.chars() {
        for c in fold(ch, mode) {
            r.chars.push(c);
            r.word.push(i);
        }
    }
    r
}

/// Every hit for `query`: the union box of the words each match touches (page points).
pub fn search(words: &[PageWord], query: &str, mode: Mode) -> Vec<[f32; 4]> {
    let q: Vec<char> = query.chars().flat_map(|c| fold(c, mode)).collect();
    if q.is_empty() {
        return Vec::new();
    }
    let mut hits = Vec::new();
    for r in runs(words, mode) {
        if r.chars.len() < q.len() {
            continue;
        }
        let mut s = 0;
        while s + q.len() <= r.chars.len() {
            if r.chars[s..s + q.len()] == q[..] {
                let mut ws: Vec<usize> = r.word[s..s + q.len()].to_vec();
                ws.dedup();
                let mut b = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
                for &i in &ws {
                    let w = &words[i].rect;
                    b = [b[0].min(w[0]), b[1].min(w[1]), b[2].max(w[2]), b[3].max(w[3])];
                }
                hits.push(b);
                s += q.len();
            } else {
                s += 1;
            }
        }
    }
    hits
}
