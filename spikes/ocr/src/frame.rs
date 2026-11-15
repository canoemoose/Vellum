//! `PageFrame` copied from the app (`src-tauri/src/text.rs`, tested there): how a page's user
//! space maps to Vellum's page coordinates (/Rotate applied, points, y down). The spike needs
//! it for the ground truth; the app would use its own.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageFrame {
    pub quarter_turns: i32,
    pub bbox: [f64; 4],
}

impl PageFrame {
    pub fn new(rotate_quarter_turns: i32, left: f64, bottom: f64, right: f64, top: f64) -> Self {
        Self { quarter_turns: rotate_quarter_turns.rem_euclid(4), bbox: [left.min(right), bottom.min(top), left.max(right), bottom.max(top)] }
    }

    pub fn to_page(&self, x: f64, y: f64) -> (f64, f64) {
        let [l, b, r, t] = self.bbox;
        match self.quarter_turns {
            1 => (y - b, x - l),
            2 => (r - x, y - b),
            3 => (t - y, r - x),
            _ => (x - l, t - y),
        }
    }

    pub fn rect(&self, x0: f64, y0: f64, x1: f64, y1: f64) -> [f32; 4] {
        let (ax, ay) = self.to_page(x0, y0);
        let (bx, by) = self.to_page(x1, y1);
        [ax.min(bx) as f32, ay.min(by) as f32, ax.max(bx) as f32, ay.max(by) as f32]
    }
}
