//! Pure geometry for OCR on pages: splitting a page render into tiles the engine accepts,
//! deciding which tile owns a word, mapping OCR boxes back to Vellum page coordinates (also
//! from renders turned a quarter turn, for vertical text), and merging the passes.

/// One tile of a page render, in pixels of that render.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tile {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    /// The part of the render this tile owns: [x0, y0, x1, y1]. Cores tile the render
    /// exactly, without gaps or overlaps; a word belongs to the tile whose core holds its centre.
    pub core: [f32; 4],
}

/// Spans along one axis: (start, length, core start, core end).
fn spans(len: u32, max: u32, overlap: u32) -> Vec<(u32, u32, f32, f32)> {
    if len <= max {
        return vec![(0, len, 0.0, len as f32)];
    }
    let overlap = overlap.min(max / 2);
    let n = (len - overlap).div_ceil(max - overlap);
    // Equal tiles, as small as covers the length with that overlap.
    let size = (len + (n - 1) * overlap).div_ceil(n).min(max);
    let mut out = Vec::with_capacity(n as usize);
    for i in 0..n {
        let start = (i * (size - overlap)).min(len - size);
        out.push((start, size, 0.0, 0.0));
    }
    for i in 0..out.len() {
        let c0 = if i == 0 { 0.0 } else { (out[i].0 as f32 + (out[i - 1].0 + out[i - 1].1) as f32) / 2.0 };
        let c1 = if i + 1 == out.len() { len as f32 } else { ((out[i].0 + out[i].1) as f32 + out[i + 1].0 as f32) / 2.0 };
        out[i].2 = c0;
        out[i].3 = c1;
    }
    out
}

/// Tiles no larger than `max` px a side, overlapping by `overlap` px, covering a `w` x `h`
/// render. A word up to `overlap` px long that straddles a seam is whole in the tile that
/// owns its centre.
pub fn plan_tiles(w: u32, h: u32, max: u32, overlap: u32) -> Vec<Tile> {
    let mut out = Vec::new();
    for &(y, th, cy0, cy1) in &spans(h, max, overlap) {
        for &(x, tw, cx0, cx1) in &spans(w, max, overlap) {
            out.push(Tile { x, y, w: tw, h: th, core: [cx0, cy0, cx1, cy1] });
        }
    }
    out
}

/// Whether a word found in `tile` (box in tile pixels) belongs to it.
pub fn owns(tile: &Tile, r: &[f32; 4]) -> bool {
    let cx = tile.x as f32 + (r[0] + r[2]) / 2.0;
    let cy = tile.y as f32 + (r[1] + r[3]) / 2.0;
    cx >= tile.core[0] && cx < tile.core[2] && cy >= tile.core[1] && cy < tile.core[3]
}

/// A point of the page (points, y down, `pw` x `ph` as displayed) in a render turned
/// `turns` quarter turns clockwise, still in points.
pub fn turn_point(x: f32, y: f32, turns: i32, pw: f32, ph: f32) -> (f32, f32) {
    match turns.rem_euclid(4) {
        1 => (ph - y, x),
        2 => (pw - x, ph - y),
        3 => (y, pw - x),
        _ => (x, y),
    }
}

/// The inverse of `turn_point`: a point of the turned render back on the page.
pub fn unturn_point(u: f32, v: f32, turns: i32, pw: f32, ph: f32) -> (f32, f32) {
    match turns.rem_euclid(4) {
        1 => (v, ph - u),
        2 => (pw - u, ph - v),
        3 => (pw - v, u),
        _ => (u, v),
    }
}

/// A box in pixels of a render at `scale` px per point turned `turns` clockwise, as a box in
/// page points (y down, the page as displayed).
pub fn to_page(r: &[f32; 4], scale: f32, turns: i32, pw: f32, ph: f32) -> [f32; 4] {
    let (ax, ay) = unturn_point(r[0] / scale, r[1] / scale, turns, pw, ph);
    let (bx, by) = unturn_point(r[2] / scale, r[3] / scale, turns, pw, ph);
    [ax.min(bx), ay.min(by), ax.max(bx), ay.max(by)]
}

/// A word of the page's own text layer: the ground truth OCR is scored against.
#[derive(Clone, Debug)]
pub struct TruthWord {
    pub text: String,
    /// Page points, y down (Vellum's page coordinates).
    pub rect: [f32; 4],
    /// Font size in points (as PDFium reports it: the size after the text matrix).
    pub size: f32,
    /// Baseline angle, degrees anticlockwise as displayed, 0..360.
    pub angle: f32,
}

/// A recognised word on the page.
#[derive(Clone, Debug, PartialEq)]
pub struct PageWord {
    pub text: String,
    /// Page points, y down.
    pub rect: [f32; 4],
    /// The render it came from: quarter turns clockwise (0: as displayed; 1: vertical text
    /// reading bottom to top; 3: reading top to bottom).
    pub turns: i32,
    /// Line it belongs to, unique within the page.
    pub line: u32,
    /// Another pass read the same ink more plausibly: kept for search (so a query matching
    /// either reading finds it) but not shown for selection or copy.
    pub alt: bool,
}

pub fn area(r: &[f32; 4]) -> f32 {
    (r[2] - r[0]).max(0.0) * (r[3] - r[1]).max(0.0)
}

pub fn intersection(a: &[f32; 4], b: &[f32; 4]) -> f32 {
    let w = (a[2].min(b[2]) - a[0].max(b[0])).max(0.0);
    let h = (a[3].min(b[3]) - a[1].max(b[1])).max(0.0);
    w * h
}

/// Overlap as a share of the smaller box.
pub fn overlap_ratio(a: &[f32; 4], b: &[f32; 4]) -> f32 {
    let m = area(a).min(area(b));
    if m <= 0.0 { 0.0 } else { intersection(a, b) / m }
}

/// Whether a word reads along its box's long side as displayed in that pass: a word found in
/// a turned render is vertical on the page, so its page box should be taller than wide.
fn fits_pass(w: &PageWord) -> bool {
    let (bw, bh) = (w.rect[2] - w.rect[0], w.rect[3] - w.rect[1]);
    let n = w.text.chars().count();
    if n < 2 {
        // A single character's box says nothing about direction.
        return true;
    }
    if w.turns % 2 == 1 { bh >= bw } else { bw >= bh }
}

/// How plausible a word's text is as drawing text, per character: capitals and digits count
/// for it, a word all in lower case a little less, mixed-case letters and stray symbols
/// against it. Used to choose between two readings of the same ink: the 90 and 270 degree
/// passes both see every vertical word, one of them upside down, and upside-down text comes
/// out as mixed case and symbols ("Lona" for DUCT, "99ta" for D365).
pub fn plausibility(s: &str) -> i32 {
    let letters: Vec<char> = s.chars().filter(|c| c.is_alphabetic()).collect();
    let all_lower = letters.len() >= 2 && letters.iter().all(|c| c.is_lowercase());
    let mut score = 0;
    for c in s.chars() {
        score += if c.is_ascii_digit() || c.is_uppercase() {
            2
        } else if c.is_lowercase() {
            if all_lower { 1 } else { -2 }
        } else if "+-.,/:()%#&'\"=\u{b0}".contains(c) {
            0
        } else {
            -3
        };
    }
    score
}

/// Added to the rank of words from the upright pass: most drawing text is horizontal, and a
/// turned pass reading horizontal text sideways can still produce plausible capitals. At 4
/// (the most a rank can otherwise differ by) an upright reading always wins a clash: measured
/// best (bias 0: 64.9% on the Xero plan; 4: 69.7%; no change on the fixture's vertical text).
/// Overridden by OCR_SPIKE_BIAS for experiments.
fn upright_bias() -> f32 {
    std::env::var("OCR_SPIKE_BIAS").ok().and_then(|v| v.parse().ok()).unwrap_or(UPRIGHT_BIAS)
}
pub const UPRIGHT_BIAS: f32 = 4.0;

/// Plausibility per character, over a set of words.
fn quality<'a>(ws: impl Iterator<Item = &'a PageWord>) -> f32 {
    let (mut p, mut n) = (0i32, 0usize);
    for w in ws {
        p += plausibility(&w.text);
        n += w.text.chars().count();
    }
    if n == 0 { 0.0 } else { p as f32 / n as f32 }
}

/// Merge the words of every pass. Words whose box contradicts the pass's reading direction
/// are dropped (a turned pass reading horizontal text sideways). Where two survivors from
/// different passes overlap by more than half, the reading whose word and line are more
/// plausible wins (ties: the longer text, then the earlier pass); the other is kept as an
/// alternate for search.
pub fn merge_passes(mut words: Vec<PageWord>) -> Vec<PageWord> {
    words.retain(fits_pass);
    let mut lines: std::collections::HashMap<u32, Vec<usize>> = Default::default();
    for (i, w) in words.iter().enumerate() {
        lines.entry(w.line).or_default().push(i);
    }
    let bias = upright_bias();
    let rank: Vec<f32> = words
        .iter()
        .map(|w| quality(lines[&w.line].iter().map(|&i| &words[i])) + quality(std::iter::once(w)) + if w.turns == 0 { bias } else { 0.0 })
        .collect();
    let mut order: Vec<usize> = (0..words.len()).collect();
    order.sort_by(|&a, &b| {
        rank[b]
            .total_cmp(&rank[a])
            .then(words[b].text.chars().count().cmp(&words[a].text.chars().count()))
            .then(words[a].turns.cmp(&words[b].turns))
    });
    let mut kept: Vec<usize> = Vec::new();
    for i in order {
        let clash = kept.iter().any(|&k| !words[k].alt && words[k].turns != words[i].turns && overlap_ratio(&words[k].rect, &words[i].rect) > 0.5);
        if clash {
            words[i].alt = true;
        }
        kept.push(i);
    }
    words
}

/// A word's extent along its reading direction (start, end) and across it (start, end), page
/// points: x for the upright pass, y (reversed for text reading up) for the turned ones.
pub fn along_across(r: &[f32; 4], turns: i32) -> ((f32, f32), (f32, f32)) {
    match turns.rem_euclid(4) {
        1 => ((-r[3], -r[1]), (r[0], r[2])),
        3 => ((r[1], r[3]), (-r[2], -r[0])),
        2 => ((-r[2], -r[0]), (-r[3], -r[1])),
        _ => ((r[0], r[2]), (r[1], r[3])),
    }
}

/// Runs of primary words on one line that sit close together (gaps under 1.5 times the text
/// height): one label, dimension or code each. Indices into `words`, in reading order.
pub fn clusters(words: &[PageWord]) -> Vec<Vec<usize>> {
    let mut by_line: std::collections::BTreeMap<u32, Vec<usize>> = Default::default();
    for (i, w) in words.iter().enumerate() {
        if !w.alt {
            by_line.entry(w.line).or_default().push(i);
        }
    }
    let mut out = Vec::new();
    for (_, mut idx) in by_line {
        let t = words[idx[0]].turns;
        idx.sort_by(|&a, &b| along_across(&words[a].rect, t).0.0.total_cmp(&along_across(&words[b].rect, t).0.0));
        let mut cur: Vec<usize> = Vec::new();
        for i in idx {
            if let Some(&last) = cur.last() {
                let (la, lx) = along_across(&words[last].rect, t);
                let (a, x) = along_across(&words[i].rect, t);
                let h = (lx.1 - lx.0).max(x.1 - x.0).max(0.1);
                if a.0 - la.1 > 1.5 * h {
                    out.push(std::mem::take(&mut cur));
                }
            }
            cur.push(i);
        }
        if !cur.is_empty() {
            out.push(cur);
        }
    }
    out
}

/// Whether a cluster looks misread, worth reading again on its own: pieces closer than half the
/// text height (one word read in fragments), a one- or two-character piece, an O or o touching
/// a digit (the commonest confusion), or implausible text.
pub fn suspect(words: &[PageWord], cluster: &[usize]) -> bool {
    let t = words[cluster[0]].turns;
    for k in 0..cluster.len() {
        let w = &words[cluster[k]];
        let chars: Vec<char> = w.text.chars().collect();
        if chars.len() <= 2 {
            return true;
        }
        for p in chars.windows(2) {
            let o = |c: char| c == 'O' || c == 'o';
            if (o(p[0]) && p[1].is_ascii_digit()) || (p[0].is_ascii_digit() && o(p[1])) {
                return true;
            }
        }
        if (plausibility(&w.text) as f32) < chars.len() as f32 {
            return true;
        }
        if k > 0 {
            let (la, lx) = along_across(&words[cluster[k - 1]].rect, t);
            let (a, x) = along_across(&w.rect, t);
            let h = (lx.1 - lx.0).max(x.1 - x.0).max(0.1);
            if a.0 - la.1 < 0.5 * h {
                return true;
            }
        }
    }
    false
}

/// The box around a set of words, page points.
pub fn union(words: &[PageWord], idx: &[usize]) -> [f32; 4] {
    let mut b = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
    for &i in idx {
        let r = &words[i].rect;
        b = [b[0].min(r[0]), b[1].min(r[1]), b[2].max(r[2]), b[3].max(r[3])];
    }
    b
}

/// Plausibility per character of some words (public twin of `quality`).
pub fn text_quality(ws: &[&PageWord]) -> f32 {
    quality(ws.iter().copied())
}

/// Whether a re-read should replace the original: it has text, it is no less plausible
/// (within a quarter point per character), and it hasn't lost more than a quarter of the
/// characters.
pub fn better_reading(old: &[&PageWord], new: &[&PageWord]) -> bool {
    if new.is_empty() {
        return false;
    }
    let n = |ws: &[&PageWord]| ws.iter().map(|w| w.text.chars().count()).sum::<usize>();
    text_quality(new) >= text_quality(old) - 0.25 && n(new) * 4 >= n(old) * 3
}

/// Merge a pass over the page with its line work removed (`clean`) into the normal pass
/// (`base`): clean words win where they overlap a base word by more than half (the base
/// reading becomes a search-only alternate), and base words elsewhere stay (large text and
/// anything the filter removed). Line numbers of `clean` are shifted past `base`'s.
pub fn merge_clean(mut base: Vec<PageWord>, mut clean: Vec<PageWord>) -> Vec<PageWord> {
    let shift = base.iter().map(|w| w.line).max().map_or(0, |l| l + 1);
    for w in &mut clean {
        w.line += shift;
    }
    let grid_rects: Vec<[f32; 4]> = clean.iter().filter(|w| !w.alt).map(|w| w.rect).collect();
    for b in &mut base {
        if !b.alt && grid_rects.iter().any(|r| overlap_ratio(r, &b.rect) > 0.5) {
            b.alt = true;
        }
    }
    base.extend(clean);
    base
}
