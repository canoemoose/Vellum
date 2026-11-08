//! Drawing-scale detection from page text (pure; PDFium access is in pdfium.rs).
//!
//! `find_scale_matches` finds every "1:NNN" (also "1 : NNN", "1∶NNN" and, for standard
//! ratios from 1/10 only, "1/NNN") in a page's characters; `rank_candidates` drops implausible ratios
//! and orders the rest, preferring ones near the bottom-right (where title blocks live),
//! ones labelled "scale", and standard architectural ratios. Tested in tests/scale.rs.

use serde::Serialize;

/// Ratios a drawing is commonly plotted at. Slash forms ("1/100") only count if standard and
/// at least 1/10, because "1/2" and the like are usually fractions or dates.
pub const STANDARD_RATIOS: &[f64] = &[
    1.0, 2.0, 5.0, 10.0, 20.0, 25.0, 50.0, 75.0, 100.0, 125.0, 150.0, 200.0, 250.0, 300.0, 400.0,
    500.0, 750.0, 1000.0, 1250.0, 1500.0, 2000.0, 2500.0, 5000.0, 10000.0, 25000.0, 50000.0,
];

/// Ratios outside this range are not drawing scales.
pub const MIN_RATIO: f64 = 1.0;
pub const MAX_RATIO: f64 = 100_000.0;

/// A scale note found in the text: chars `start..end` (indices into the input).
#[derive(Debug, Clone, PartialEq)]
pub struct ScaleMatch {
    pub start: usize,
    pub end: usize,
    pub ratio: f64,
    pub text: String,
    /// The word "scale" appears shortly before it.
    pub labelled: bool,
}

/// A match with its position on the page, before ranking.
#[derive(Debug, Clone, PartialEq)]
pub struct RawCandidate {
    pub ratio: f64,
    pub text: String,
    /// [x0, y0, x1, y1] in page points, y down from the top of the page.
    pub bbox: [f64; 4],
    pub labelled: bool,
}

/// What `doc_find_scale` returns, best first.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ScaleCandidate {
    pub ratio: f64,
    pub text: String,
    pub bbox: [f64; 4],
}

fn is_space(c: char) -> bool {
    c == ' ' || c == '\u{a0}' || c == '\u{2009}' || c == '\u{202f}'
}

fn skip_spaces(chars: &[char], mut i: usize, max: usize) -> usize {
    let mut n = 0;
    while i < chars.len() && is_space(chars[i]) && n < max {
        i += 1;
        n += 1;
    }
    i
}

/// Every scale note in `chars`, in text order.
pub fn find_scale_matches(chars: &[char]) -> Vec<ScaleMatch> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] != '1' || !boundary_before(chars, i) {
            i += 1;
            continue;
        }
        if let Some(m) = match_at(chars, i) {
            i = m.end;
            out.push(m);
        } else {
            i += 1;
        }
    }
    out
}

/// The '1' must start a token: not part of a number, a time, a paper size ("A1") or a word.
fn boundary_before(chars: &[char], i: usize) -> bool {
    match i.checked_sub(1).map(|k| chars[k]) {
        None => true,
        Some(c) => !(c.is_alphanumeric() || matches!(c, '.' | ',' | ':' | '/' | '-' | '\u{2236}')),
    }
}

fn match_at(chars: &[char], start: usize) -> Option<ScaleMatch> {
    let mut i = skip_spaces(chars, start + 1, 2);
    let sep = *chars.get(i)?;
    let slash = match sep {
        ':' | '\u{2236}' => false,
        '/' => true,
        _ => return None,
    };
    i = skip_spaces(chars, i + 1, 2);
    // The number: digits, optional thousands separators (",000"), optional decimal part.
    let num_start = i;
    let mut digits = String::new();
    while i < chars.len() {
        let c = chars[i];
        if c.is_ascii_digit() {
            digits.push(c);
            i += 1;
        } else if c == ','
            && !digits.is_empty()
            && !digits.contains('.')
            && chars.get(i + 1..i + 4).is_some_and(|g| g.iter().all(char::is_ascii_digit))
            && !chars.get(i + 4).is_some_and(char::is_ascii_digit)
        {
            i += 1; // thousands separator
        } else if c == '.'
            && !digits.is_empty()
            && !digits.contains('.')
            && chars.get(i + 1).is_some_and(char::is_ascii_digit)
        {
            digits.push('.');
            i += 1;
        } else {
            break;
        }
    }
    if i == num_start || digits.is_empty() {
        return None;
    }
    // Reject what follows a time ("1:30:00"), a date ("1/10/2021") or a longer number.
    if matches!(chars.get(i), Some(':') | Some('/') | Some('\u{2236}')) {
        return None;
    }
    let ratio: f64 = digits.parse().ok()?;
    if slash && (ratio < 10.0 || !STANDARD_RATIOS.contains(&ratio)) {
        return None;
    }
    let text: String = chars[start..i].iter().collect();
    Some(ScaleMatch { start, end: i, ratio, text, labelled: labelled(chars, start) })
}

/// "scale" (any case) within the 24 characters before `start`.
fn labelled(chars: &[char], start: usize) -> bool {
    let from = start.saturating_sub(24);
    let before: String = chars[from..start].iter().collect::<String>().to_lowercase();
    before.contains("scale")
}

/// Score used for ordering (higher is better). Public for tests.
pub fn score(c: &RawCandidate, page_w: f64, page_h: f64) -> f64 {
    let cx = (c.bbox[0] + c.bbox[2]) / 2.0;
    let cy = (c.bbox[1] + c.bbox[3]) / 2.0;
    // 0 at the top-left corner, 2 at the bottom-right.
    let pos = if page_w > 0.0 && page_h > 0.0 {
        (cx / page_w).clamp(0.0, 1.0) + (cy / page_h).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let mut s = pos;
    if c.labelled {
        s += 1.5;
    }
    if STANDARD_RATIOS.contains(&c.ratio) {
        s += 0.5;
    }
    if c.ratio == 1.0 {
        // "1:1" is usually a detail or a note, rarely the sheet's scale.
        s -= 1.5;
    }
    s
}

/// Drop implausible ratios and order the rest best first (stable for equal scores).
pub fn rank_candidates(cands: Vec<RawCandidate>, page_w: f64, page_h: f64) -> Vec<ScaleCandidate> {
    let mut v: Vec<(f64, RawCandidate)> = cands
        .into_iter()
        .filter(|c| c.ratio.is_finite() && c.ratio >= MIN_RATIO && c.ratio <= MAX_RATIO)
        .map(|c| (score(&c, page_w, page_h), c))
        .collect();
    v.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    v.into_iter()
        .map(|(_, c)| ScaleCandidate { ratio: c.ratio, text: c.text, bbox: c.bbox })
        .collect()
}
