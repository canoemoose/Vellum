//! The drawing-like fixture's content: deterministic, so results can be compared run to run.
//! An A1 landscape sheet (2384 x 1684 pt) in four quadrants, one per text angle (0, 90, 270
//! and 45 degrees anticlockwise). Each quadrant has a row per font size (2 to 12 pt) of
//! sixteen drawing-style tokens: dimensions, levels, grid and door references, short notes.
//! Every token has a dimension line beside it, and light random line work covers the sheet.

pub const PAGE_W: f64 = 2384.0;
pub const PAGE_H: f64 = 1684.0;
pub const SIZES: [f64; 8] = [2.0, 2.5, 3.0, 3.5, 4.5, 6.0, 8.0, 12.0];
pub const ANGLES: [f64; 4] = [0.0, 90.0, 270.0, 45.0];
const PER_ROW: usize = 16;

/// A small deterministic generator (mulberry32, as tools/gen-synthetic.mjs uses).
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Self(seed)
    }
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4_294_967_296.0
    }
    pub fn below(&mut self, n: usize) -> usize {
        (self.next() * n as f64) as usize % n
    }
}

const NOUNS: [&str; 12] = ["STAIR", "CORE", "RISER", "DUCT", "BEAM", "LOBBY", "PLANT", "SHAFT", "TRUSS", "STAGE", "RIGGING", "FOH"];
const GRID: [&str; 10] = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K"];

/// One token in the style of drawing text, from `rng`.
pub fn token(rng: &mut Rng) -> String {
    match rng.below(9) {
        0 => format!("{}", 100 + rng.below(9900)),
        1 => format!("{}.{}", 100 + rng.below(4900), rng.below(10)),
        2 => format!("FFL+{}.{:03}", rng.below(40), rng.below(1000)),
        3 => format!("{}-{}", GRID[rng.below(GRID.len())], 1 + rng.below(30)),
        4 => format!("D{}{:02}", 1 + rng.below(4), rng.below(100)),
        5 => NOUNS[rng.below(NOUNS.len())].to_string(),
        6 => format!("{}x{}", 100 * (1 + rng.below(12)), 100 * (1 + rng.below(12))),
        7 => format!("R{}", 5 + rng.below(400)),
        _ => format!("{}{}", NOUNS[rng.below(NOUNS.len())], 1 + rng.below(9)),
    }
}

#[derive(Clone, Debug)]
pub struct Item {
    pub text: String,
    /// Baseline start, PDF user space (y up).
    pub x: f64,
    pub y: f64,
    pub size: f64,
    pub angle: f64,
}

/// What goes on the sheet besides the text.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Variant {
    /// Random line work across the sheet (3,000 short lines).
    pub line_work: bool,
    /// A dimension line beside every token, this far from the baseline as a fraction of the
    /// font size (0: touching it, like an underline). None: no dimension lines.
    pub dim_gap: Option<f64>,
}

impl Variant {
    /// What a drawing looks like: line work, dimension lines a quarter of the text height
    /// clear of the text (AutoCAD's default gap is 0.625 mm for 2.5 mm text).
    pub const DRAWING: Variant = Variant { line_work: true, dim_gap: Some(0.25) };
    pub const CLEAN: Variant = Variant { line_work: false, dim_gap: None };
    pub const LINE_WORK: Variant = Variant { line_work: true, dim_gap: None };
    pub const UNDERLINED: Variant = Variant { line_work: true, dim_gap: Some(0.0) };

    pub fn name(&self) -> &'static str {
        match *self {
            Variant::DRAWING => "drawing",
            Variant::CLEAN => "clean",
            Variant::LINE_WORK => "linework",
            Variant::UNDERLINED => "underlined",
            _ => "custom",
        }
    }
}

/// Every text item and line ([x0, y0, x1, y1], y up) of the fixture. The tokens are the same
/// in every variant.
pub fn layout(seed: u32, v: Variant) -> (Vec<Item>, Vec<[f64; 4]>) {
    let mut rng = Rng::new(seed);
    let mut lines_rng = Rng::new(seed ^ 0x5eed);
    let mut items = Vec::new();
    let mut lines = Vec::new();
    // Light line work first, so text sits over it as on a drawing.
    if v.line_work {
        for _ in 0..3000 {
            let r = &mut lines_rng;
            let (x, y) = (40.0 + r.next() * (PAGE_W - 80.0), 160.0 + r.next() * (PAGE_H - 200.0));
            let (dx, dy) = ((r.next() - 0.5) * 120.0, (r.next() - 0.5) * 120.0);
            lines.push([x, y, x + dx, y + dy]);
        }
    }
    let (qw, qh) = ((PAGE_W - 80.0) / 2.0, (PAGE_H - 200.0) / 2.0);
    for (qi, &angle) in ANGLES.iter().enumerate() {
        let (qx, qy) = (40.0 + (qi % 2) as f64 * qw, 160.0 + (1 - qi / 2) as f64 * qh);
        let row_h = qh / SIZES.len() as f64;
        let col_w = qw / PER_ROW as f64;
        for (si, &size) in SIZES.iter().enumerate() {
            let cy = qy + si as f64 * row_h;
            for c in 0..PER_ROW {
                let text = token(&mut rng);
                let cx = qx + c as f64 * col_w;
                let (x, y) = match angle as i32 {
                    90 => (cx + col_w * 0.5, cy + 4.0),
                    270 => (cx + col_w * 0.5, cy + row_h - 4.0),
                    45 => (cx + 4.0, cy + 6.0),
                    _ => (cx + 4.0, cy + row_h * 0.4),
                };
                if let Some(g) = v.dim_gap {
                    // A dimension line under the text (on the baseline's clockwise side).
                    let len = (text.len() as f64 * size * 0.6).min(col_w - 6.0);
                    let (s, co) = angle.to_radians().sin_cos();
                    let d = g * size + 0.2;
                    let (ox, oy) = (s * d, -co * d);
                    lines.push([x + ox - co * 2.0, y + oy - s * 2.0, x + ox + co * (len + 2.0), y + oy + s * (len + 2.0)]);
                }
                items.push(Item { text, x, y, size, angle });
            }
        }
    }
    items.push(Item { text: "VELLUM OCR FIXTURE".into(), x: PAGE_W - 600.0, y: 90.0, size: 24.0, angle: 0.0 });
    items.push(Item { text: "SHEET A-101 REV C".into(), x: PAGE_W - 600.0, y: 55.0, size: 14.0, angle: 0.0 });
    (items, lines)
}
