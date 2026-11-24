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

/// The common imperial scales as ratios: architectural (3/32" to 3" = 1'-0") and engineering
/// (1" = 10' to 1" = 100'). The same lists as the scale box offers (src/lib/markup/imperial.ts).
pub const IMPERIAL_RATIOS: &[f64] = &[
    128.0, 96.0, 64.0, 48.0, 32.0, 24.0, 16.0, 12.0, 8.0, 4.0, 120.0, 240.0, 360.0, 480.0, 600.0, 720.0, 1200.0,
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

/// One character of a page's text layer as PDFium reports it: the character, whether PDFium
/// generated it (a space or line break it guessed, not in the content), and its box in user
/// space (left, bottom, right, top), if it has one.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TextChar {
    pub c: char,
    pub generated: bool,
    pub bbox: Option<[f64; 4]>,
}

/// Whether two character boxes (left, bottom, right, top) sit on one line: their vertical
/// extents overlap by at least half the shorter one's height.
pub fn same_line(a: [f64; 4], b: [f64; 4]) -> bool {
    let (a0, a1) = (a[1].min(a[3]), a[1].max(a[3]));
    let (b0, b1) = (b[1].min(b[3]), b[1].max(b[3]));
    let overlap = a1.min(b1) - a0.max(b0);
    let h = (a1 - a0).min(b1 - b0);
    h > 0.0 && overlap >= 0.5 * h
}

/// The page's characters ready for `find_scale_matches`, each with the PDFium index it came
/// from (None for one this added). A line break PDFium generated between two characters on
/// the same line is dropped: on some pages (the Fieldwork set's site plan, whose map labels are
/// drawn twice) PDFium breaks the line between nearly every character, so "1:5000" reaches
/// the matcher as "1\r\n:\r\n5\r\n0\r\n0\r\n0". Other generated breaks stay, as one space, so
/// text on different lines ("SCALE" over "1:5000", the date under it) doesn't run together.
pub fn clean_text(chars: &[TextChar]) -> (Vec<char>, Vec<Option<usize>>) {
    let real = |i: usize| !chars[i].generated && chars[i].bbox.is_some();
    let mut out = Vec::with_capacity(chars.len());
    let mut map = Vec::with_capacity(chars.len());
    for (i, ch) in chars.iter().enumerate() {
        if ch.generated && (ch.c == '\r' || ch.c == '\n') {
            let prev = (0..i).rev().find(|&k| real(k));
            let next = (i + 1..chars.len()).find(|&k| real(k));
            let spurious = match (prev, next) {
                (Some(p), Some(n)) => same_line(chars[p].bbox.unwrap(), chars[n].bbox.unwrap()),
                _ => false,
            };
            if !spurious && out.last().is_some_and(|c: &char| !c.is_whitespace()) {
                out.push(' ');
                map.push(None);
            }
            continue;
        }
        out.push(ch.c);
        map.push(Some(i));
    }
    (out, map)
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

/// Every scale note in `chars`, in text order: ratios ("1:100") and imperial scales
/// (1/4" = 1'-0", 1" = 20'), see `find_imperial_matches`.
pub fn find_scale_matches(chars: &[char]) -> Vec<ScaleMatch> {
    let mut out = find_ratio_matches(chars);
    for m in find_imperial_matches(chars) {
        if !out.iter().any(|r| m.start < r.end && r.start < m.end) {
            out.push(m);
        }
    }
    out.sort_by_key(|m| m.start);
    out
}

/// Ratios: "1:NNN", "1 : NNN", "1∶NNN", and "1/NNN" for standard ratios from 1/10.
fn find_ratio_matches(chars: &[char]) -> Vec<ScaleMatch> {
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
// ------------------------------------------------------------------ imperial scales

const QUOTES: [char; 4] = ['"', '\u{2033}', '\u{201d}', '\u{201c}'];
const PRIMES: [char; 3] = ['\'', '\u{2019}', '\u{2032}'];

/// Inch marks: ", two apostrophes, the typographic and prime forms, or "in". The index after.
fn inch_mark(chars: &[char], i: usize) -> Option<usize> {
    let c = *chars.get(i)?;
    if QUOTES.contains(&c) {
        return Some(i + 1);
    }
    if PRIMES.contains(&c) && chars.get(i + 1).is_some_and(|n| PRIMES.contains(n)) {
        return Some(i + 2);
    }
    if matches!(c, 'i' | 'I') && matches!(chars.get(i + 1), Some('n' | 'N')) && !chars.get(i + 2).is_some_and(|n| n.is_alphabetic()) {
        return Some(if chars.get(i + 2) == Some(&'.') { i + 3 } else { i + 2 });
    }
    None
}

/// Foot marks: ', the typographic and prime forms, or "ft". The index after.
fn foot_mark(chars: &[char], i: usize) -> Option<usize> {
    let c = *chars.get(i)?;
    if PRIMES.contains(&c) && !chars.get(i + 1).is_some_and(|n| PRIMES.contains(n)) {
        return Some(i + 1);
    }
    if matches!(c, 'f' | 'F') && matches!(chars.get(i + 1), Some('t' | 'T')) && !chars.get(i + 2).is_some_and(|n| n.is_alphabetic()) {
        return Some(if chars.get(i + 2) == Some(&'.') { i + 3 } else { i + 2 });
    }
    None
}

/// A single vulgar-fraction character's value: ½ ¼ ¾ ⅛ ⅜ ⅝ ⅞ and the thirds.
fn vulgar(c: char) -> Option<f64> {
    Some(match c {
        '½' => 0.5,
        '¼' => 0.25,
        '¾' => 0.75,
        '⅛' => 0.125,
        '⅜' => 0.375,
        '⅝' => 0.625,
        '⅞' => 0.875,
        '⅓' => 1.0 / 3.0,
        '⅔' => 2.0 / 3.0,
        _ => return None,
    })
}

/// Digits, with an optional decimal part ("1.5"), and the index after.
fn number(chars: &[char], i: usize) -> Option<(f64, usize)> {
    let mut j = i;
    while chars.get(j).is_some_and(char::is_ascii_digit) {
        j += 1;
    }
    if j == i {
        return None;
    }
    if chars.get(j) == Some(&'.') && chars.get(j + 1).is_some_and(char::is_ascii_digit) {
        j += 1;
        while chars.get(j).is_some_and(char::is_ascii_digit) {
            j += 1;
        }
    }
    let v: f64 = chars[i..j].iter().collect::<String>().parse().ok()?;
    Some((v, j))
}

/// A length as written on a drawing: 3, 1.5, 1/4, 1 1/2, 1-1/2, ½, 1½. The index after.
fn length_number(chars: &[char], i: usize) -> Option<(f64, usize)> {
    if let Some(v) = chars.get(i).and_then(|&c| vulgar(c)) {
        return Some((v, i + 1));
    }
    let (whole, j) = number(chars, i)?;
    if chars.get(j) == Some(&'/') {
        let (den, k) = number(chars, j + 1)?;
        return (den > 0.0).then_some((whole / den, k));
    }
    if let Some(v) = chars.get(j).and_then(|&c| vulgar(c)) {
        return Some((whole + v, j + 1));
    }
    // A mixed number: "1 1/2" or "1-1/2".
    if matches!(chars.get(j), Some(' ' | '-')) {
        if let Some((num, k)) = number(chars, j + 1) {
            if chars.get(k) == Some(&'/') {
                if let Some((den, m)) = number(chars, k + 1) {
                    if den > 0.0 && num < den {
                        return Some((whole + num / den, m));
                    }
                }
            }
        }
    }
    Some((whole, j))
}

/// The real-world side, in inches: 1'-0", 1' 0", 1', 20'-0", 20 ft, 12". The index after.
fn real_side(chars: &[char], i: usize) -> Option<(f64, usize)> {
    let (n, j) = length_number(chars, i)?;
    let j = skip_spaces(chars, j, 1); // "50 ft"
    if let Some(k) = foot_mark(chars, j) {
        // Inches after the feet are optional: "-0\"" or " 6\"".
        let after = if matches!(chars.get(k), Some('-' | ' ')) { k + 1 } else { k };
        if let Some((v, m)) = length_number(chars, after) {
            if let Some(e) = inch_mark(chars, m) {
                return Some((n * 12.0 + v, e));
            }
        }
        return Some((n * 12.0, k));
    }
    let k = inch_mark(chars, j)?;
    Some((n, k))
}

/// Imperial scales: an inch length on paper, "=", a real length in feet (and inches) or in
/// inches. Architectural: 1/4" = 1'-0" (1:48), 1 1/2" = 1'-0" (1:8), 3" = 1'-0" (1:4).
/// Engineering: 1" = 20' or 1" = 20'-0" (1:240). Typographic quotes and primes, "in" and
/// "ft", and fraction characters (½ ¼ ¾ ⅛) are accepted. Mirrors `parseLengthScale` in
/// src/lib/markup/imperial.ts, which reads what is typed in the scale box.
pub fn find_imperial_matches(chars: &[char]) -> Vec<ScaleMatch> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if !((c.is_ascii_digit() || vulgar(c).is_some()) && boundary_before(chars, i)) {
            i += 1;
            continue;
        }
        let found = (|| {
            let (paper, j) = length_number(chars, i)?;
            let j = inch_mark(chars, skip_spaces(chars, j, 1))?;
            let j = skip_spaces(chars, j, 2);
            if chars.get(j) != Some(&'=') {
                return None;
            }
            let (real, end) = real_side(chars, skip_spaces(chars, j + 1, 2))?;
            (paper > 0.0 && real >= paper).then_some((real / paper, end))
        })();
        match found {
            Some((ratio, end)) => {
                let text: String = chars[i..end].iter().collect();
                out.push(ScaleMatch { start: i, end, ratio, text, labelled: labelled(chars, i), sheet: None });
                i = end;
            }
            None => i += 1,
        }
    }
    out
}

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
    if STANDARD_RATIOS.contains(&c.ratio) || IMPERIAL_RATIOS.contains(&c.ratio) {
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
