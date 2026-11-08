//! Drawing-scale detection from page text (pure; PDFium access is in pdfium.rs).
//!
//! `find_scale_matches` finds every "1:NNN" (also "1 : NNN", "1∶NNN" and, for standard
//! ratios from 1/10 only, "1/NNN") in a page's characters; `rank_candidates` drops implausible ratios
//! and orders the rest, preferring ones near the bottom-right (where title blocks live),
//! ones labelled "scale", and standard architectural ratios. Tested in tests/scale.rs.
//!
//! A title block often states the scale for a particular sheet size ("1:200 @A3") while the
//! PDF page is another size (an A1 page). The ratio that holds on the page itself is then
//! the stated one times (stated sheet's long side / page's long side), snapped to the
//! nearest standard ratio when it is within 5% of one: "1:200 @A3" on an A1 page is 1:100.
//! `rank_candidates` makes that correction, so `ratio` is always the scale on the page.

use serde::Serialize;

/// Ratios a drawing is commonly plotted at. Slash forms ("1/100") only count if standard and
/// at least 1/10, because "1/2" and the like are usually fractions or dates.
pub const STANDARD_RATIOS: &[f64] = &[
    1.0, 2.0, 5.0, 10.0, 20.0, 25.0, 50.0, 75.0, 100.0, 125.0, 150.0, 200.0, 250.0, 300.0, 400.0,
    500.0, 750.0, 1000.0, 1250.0, 1500.0, 2000.0, 2500.0, 5000.0, 10000.0, 25000.0, 50000.0,
];

/// Long sides of ISO A sheets in mm, A0 to A5.
pub const A_SERIES_LONG_MM: [f64; 6] = [1189.0, 841.0, 594.0, 420.0, 297.0, 210.0];

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
    /// The sheet size the ratio is stated for ("@A3", "@ A3", "at A3"): the A number.
    pub sheet: Option<u8>,
}

/// A match with its position on the page, before ranking.
#[derive(Debug, Clone, PartialEq)]
pub struct RawCandidate {
    pub ratio: f64,
    pub text: String,
    /// [x0, y0, x1, y1] in page points, y down from the top of the page.
    pub bbox: [f64; 4],
    pub labelled: bool,
    /// Stated sheet size (A number), if the note names one.
    pub sheet: Option<u8>,
}

/// What `doc_find_scale` returns, best first.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScaleCandidate {
    /// The scale on the page itself (already corrected for a stated sheet size).
    pub ratio: f64,
    /// The ratio as written, e.g. "1:200".
    pub text: String,
    pub bbox: [f64; 4],
    /// The ratio as written when it was stated for another sheet size (200 for "1:200 @A3" on
    /// an A1 page); null when `ratio` is as written.
    pub stated_ratio: Option<f64>,
    /// The stated sheet size ("A3"), if the note names one.
    pub sheet: Option<String>,
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
    Some(ScaleMatch { start, end: i, ratio, text, labelled: labelled(chars, start), sheet: stated_sheet(chars, i) })
}

/// "@A3", "@ A3", "at A3" (any case) right after a ratio ending at `i`: the A number (0 to 5).
fn stated_sheet(chars: &[char], i: usize) -> Option<u8> {
    let mut j = skip_spaces(chars, i, 2);
    match chars.get(j) {
        Some('@') => j += 1,
        Some('a' | 'A') if chars.get(j + 1).is_some_and(|c| *c == 't' || *c == 'T') && chars.get(j + 2).is_some_and(|c| is_space(*c)) => {
            j += 2
        }
        _ => return None,
    }
    j = skip_spaces(chars, j, 2);
    if !matches!(chars.get(j), Some('a' | 'A')) {
        return None;
    }
    let d = chars.get(j + 1)?.to_digit(10)?;
    if d as usize >= A_SERIES_LONG_MM.len() || chars.get(j + 2).is_some_and(|c| c.is_alphanumeric()) {
        return None;
    }
    Some(d as u8)
}

/// The scale that holds on a page whose long side is `page_long_mm`, for a ratio stated for
/// a sheet whose long side is `sheet_long_mm`. Unchanged when the page is that sheet (within
/// 3%); otherwise scaled by sheet / page and snapped to the nearest standard ratio if within
/// 5% of it (else rounded to a whole number).
pub fn rescale_for_page(ratio: f64, sheet_long_mm: f64, page_long_mm: f64) -> f64 {
    if !(page_long_mm > 0.0) || !(sheet_long_mm > 0.0) || (page_long_mm / sheet_long_mm - 1.0).abs() <= 0.03 {
        return ratio;
    }
    let n = ratio * sheet_long_mm / page_long_mm;
    let nearest = STANDARD_RATIOS
        .iter()
        .copied()
        .min_by(|a, b| (a / n).ln().abs().partial_cmp(&(b / n).ln().abs()).unwrap())
        .unwrap_or(n);
    if (nearest / n - 1.0).abs() <= 0.05 { nearest } else { n.round().max(1.0) }
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
    if c.sheet.is_some() {
        // "1:200 @A3" is how title blocks write it.
        s += 0.5;
    }
    if c.ratio == 1.0 {
        // "1:1" is usually a detail or a note, rarely the sheet's scale.
        s -= 1.5;
    }
    s
}

/// Drop implausible ratios and order the rest best first (stable for equal scores).
/// Ratios stated for another sheet size are first corrected to the page's own size
/// (`rescale_for_page`, with the page size in points).
pub fn rank_candidates(cands: Vec<RawCandidate>, page_w: f64, page_h: f64) -> Vec<ScaleCandidate> {
    let page_long_mm = page_w.max(page_h) * 25.4 / 72.0;
    let mut v: Vec<(f64, RawCandidate, Option<f64>)> = cands
        .into_iter()
        .filter(|c| c.ratio.is_finite() && c.ratio >= MIN_RATIO && c.ratio <= MAX_RATIO)
        .map(|mut c| {
            let stated = c.ratio;
            if let Some(a) = c.sheet {
                c.ratio = rescale_for_page(stated, A_SERIES_LONG_MM[a as usize], page_long_mm);
            }
            let stated = (c.ratio != stated).then_some(stated);
            (score(&c, page_w, page_h), c, stated)
        })
        .collect();
    v.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    v.into_iter()
        .map(|(_, c, stated)| ScaleCandidate {
            ratio: c.ratio,
            text: c.text,
            bbox: c.bbox,
            stated_ratio: stated,
            sheet: c.sheet.map(|a| format!("A{a}")),
        })
        .collect()
}
