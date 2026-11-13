//! Appearance streams: the drawing every viewer shows for an annotation.
//!
//! Pure geometry in PDF user space (points, y up, unrotated page). Each builder returns the
//! content-stream operators and the bounding box they cover, so the annotation's /Rect and the
//! form XObject's /BBox can be the same rectangle.

use crate::helvetica;

pub type Pt = (f64, f64);
pub type Rgb = [f64; 3];

/// Stroke and fill for a markup. Widths are in points on paper.
#[derive(Clone, Debug)]
pub struct Style {
    pub stroke: Rgb,
    pub width: f64,
    pub fill: Option<Rgb>,
    /// 0..1, applied to stroke and fill alike (/CA and /ca).
    pub opacity: f64,
    pub dash: Option<Vec<f64>>,
}

impl Style {
    pub fn stroke(stroke: Rgb, width: f64) -> Self {
        Self { stroke, width, fill: None, opacity: 1.0, dash: None }
    }
}

/// Bounding box as [x0, y0, x1, y1].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BBox(pub [f64; 4]);

impl BBox {
    pub fn of(points: &[Pt]) -> Self {
        let mut b = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
        for &(x, y) in points {
            b[0] = b[0].min(x);
            b[1] = b[1].min(y);
            b[2] = b[2].max(x);
            b[3] = b[3].max(y);
        }
        BBox(b)
    }
    pub fn grow(self, d: f64) -> Self {
        let b = self.0;
        BBox([b[0] - d, b[1] - d, b[2] + d, b[3] + d])
    }
    pub fn union(self, o: BBox) -> Self {
        let (a, b) = (self.0, o.0);
        BBox([a[0].min(b[0]), a[1].min(b[1]), a[2].max(b[2]), a[3].max(b[3])])
    }
    /// Snap outwards to whole points so /Rect and /BBox are tidy and never clip a stroke.
    pub fn snap(self) -> Self {
        let b = self.0;
        BBox([b[0].floor(), b[1].floor(), b[2].ceil(), b[3].ceil()])
    }
}

/// Format a number compactly: at most 3 decimals, no trailing zeros.
pub fn n(v: f64) -> String {
    let s = format!("{:.3}", v);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" { "0".into() } else { s.to_string() }
}

/// A content stream under construction.
#[derive(Default)]
pub struct Ops(pub String);

impl Ops {
    fn op(&mut self, s: String) {
        self.0.push_str(&s);
        self.0.push('\n');
    }
    pub fn raw(&mut self, s: &str) {
        self.op(s.to_string());
    }
    pub fn stroke_rgb(&mut self, c: Rgb) {
        self.op(format!("{} {} {} RG", n(c[0]), n(c[1]), n(c[2])));
    }
    pub fn fill_rgb(&mut self, c: Rgb) {
        self.op(format!("{} {} {} rg", n(c[0]), n(c[1]), n(c[2])));
    }
    pub fn width(&mut self, w: f64) {
        self.op(format!("{} w", n(w)));
    }
    pub fn m(&mut self, p: Pt) {
        self.op(format!("{} {} m", n(p.0), n(p.1)));
    }
    pub fn l(&mut self, p: Pt) {
        self.op(format!("{} {} l", n(p.0), n(p.1)));
    }
    pub fn c(&mut self, a: Pt, b: Pt, p: Pt) {
        self.op(format!("{} {} {} {} {} {} c", n(a.0), n(a.1), n(b.0), n(b.1), n(p.0), n(p.1)));
    }
    /// Set the stroke state shared by every shape: colour, width, dash, round joins.
    pub fn style(&mut self, s: &Style, gs: bool) {
        if gs {
            self.raw("/GS0 gs");
        }
        self.stroke_rgb(s.stroke);
        if let Some(f) = s.fill {
            self.fill_rgb(f);
        }
        self.width(s.width);
        self.raw("1 j 1 J");
        if let Some(d) = &s.dash {
            let parts: Vec<String> = d.iter().map(|v| n(*v)).collect();
            self.op(format!("[{}] 0 d", parts.join(" ")));
        }
    }
}

/// The finished appearance: operators, bounding box, and whether it needs the /GS0 opacity
/// graphics state or the /Helv font in its resources.
pub struct Appearance {
    pub ops: String,
    pub bbox: BBox,
    pub opacity: Option<f64>,
    pub font: bool,
}

fn sub(a: Pt, b: Pt) -> Pt {
    (a.0 - b.0, a.1 - b.1)
}
fn add(a: Pt, b: Pt) -> Pt {
    (a.0 + b.0, a.1 + b.1)
}
fn mul(a: Pt, k: f64) -> Pt {
    (a.0 * k, a.1 * k)
}
fn len(a: Pt) -> f64 {
    a.0.hypot(a.1)
}
fn unit(a: Pt) -> Pt {
    let l = len(a);
    if l == 0.0 { (1.0, 0.0) } else { (a.0 / l, a.1 / l) }
}
fn rot(a: Pt, ang: f64) -> Pt {
    let (s, c) = ang.sin_cos();
    (a.0 * c - a.1 * s, a.0 * s + a.1 * c)
}

/// Line-ending styles we draw (a subset of /LE names).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum End {
    None,
    OpenArrow,
    ClosedArrow,
}

impl End {
    pub fn pdf_name(self) -> &'static str {
        match self {
            End::None => "None",
            End::OpenArrow => "OpenArrow",
            End::ClosedArrow => "ClosedArrow",
        }
    }
}

/// Arrowhead length for a line width: big enough to read on a drawing, growing with weight.
pub fn arrow_len(width: f64) -> f64 {
    6.0 + 4.0 * width
}

/// Draw an arrowhead at `tip`, pointing along `dir` (from tail to tip). Returns its points so
/// the caller can include them in the bounding box.
fn arrowhead(o: &mut Ops, tip: Pt, dir: Pt, width: f64, end: End) -> Vec<Pt> {
    if end == End::None {
        return vec![];
    }
    let l = arrow_len(width);
    let back = mul(unit(dir), -l);
    let w1 = add(tip, rot(back, 0.4636)); // ~26.6 deg: a 2:1 head
    let w2 = add(tip, rot(back, -0.4636));
    o.m(w1);
    o.l(tip);
    o.l(w2);
    if end == End::ClosedArrow {
        o.raw("h b"); // close, fill with the stroke colour set as fill below, stroke
    } else {
        o.raw("S");
    }
    vec![w1, w2, tip]
}

/// A straight line with optional arrowheads at either end (Line annotation).
pub fn line(a: Pt, b: Pt, ends: (End, End), s: &Style) -> Appearance {
    let mut o = Ops::default();
    o.style(s, s.opacity < 1.0);
    o.fill_rgb(s.stroke); // closed arrowheads are filled with the line colour
    let dir = sub(b, a);
    // Stop the shaft short of a closed head so the round cap doesn't poke through its tip.
    let shorten = |end: End| if end == End::ClosedArrow { arrow_len(s.width) * 0.8 } else { 0.0 };
    let a2 = add(a, mul(unit(dir), shorten(ends.0)));
    let b2 = sub(b, mul(unit(dir), shorten(ends.1)));
    o.m(a2);
    o.l(b2);
    o.raw("S");
    let mut pts = vec![a, b];
    pts.extend(arrowhead(&mut o, b, dir, s.width, ends.1));
    pts.extend(arrowhead(&mut o, a, mul(dir, -1.0), s.width, ends.0));
    Appearance { ops: o.0, bbox: BBox::of(&pts).grow(s.width + 1.0).snap(), opacity: op(s), font: false }
}

fn op(s: &Style) -> Option<f64> {
    (s.opacity < 1.0).then_some(s.opacity)
}

/// Rectangle (Square annotation). `r` is the shape's own rectangle; the stroke is centred on it.
pub fn rect(r: BBox, s: &Style) -> Appearance {
    let mut o = Ops::default();
    o.style(s, s.opacity < 1.0);
    let b = r.0;
    o.raw(&format!("{} {} {} {} re", n(b[0]), n(b[1]), n(b[2] - b[0]), n(b[3] - b[1])));
    o.raw(if s.fill.is_some() { "B" } else { "S" });
    Appearance { ops: o.0, bbox: r.grow(s.width / 2.0 + 1.0).snap(), opacity: op(s), font: false }
}

/// Closed polygon (Polygon annotation).
pub fn polygon(v: &[Pt], s: &Style) -> Appearance {
    let mut o = Ops::default();
    o.style(s, s.opacity < 1.0);
    o.m(v[0]);
    for p in &v[1..] {
        o.l(*p);
    }
    o.raw(if s.fill.is_some() { "h B" } else { "h S" });
    Appearance { ops: o.0, bbox: BBox::of(v).grow(s.width / 2.0 + 1.0).snap(), opacity: op(s), font: false }
}

/// Signed area (positive when the vertices run anticlockwise, y up).
pub fn signed_area(v: &[Pt]) -> f64 {
    let mut a = 0.0;
    for i in 0..v.len() {
        let (p, q) = (v[i], v[(i + 1) % v.len()]);
        a += p.0 * q.1 - q.0 * p.1;
    }
    a / 2.0
}

/// Scallop chord length for a cloud of the given /BE intensity (0..2, 1 is usual).
pub fn cloud_chord(intensity: f64) -> f64 {
    14.0 * intensity.max(0.5)
}

/// Revision cloud (Polygon with a cloudy /BE border effect). Each edge is divided into equal
/// chords and each chord bulges outwards as a half circle, drawn as two Bezier quarter arcs.
pub fn cloud(v: &[Pt], intensity: f64, s: &Style) -> Appearance {
    let mut o = Ops::default();
    o.style(s, s.opacity < 1.0);
    let ccw = signed_area(v) > 0.0;
    let target = cloud_chord(intensity);
    let k = 0.552_284_75; // Bezier handle length for a quarter circle
    let mut first = true;
    let mut pts = Vec::new();
    for i in 0..v.len() {
        let (a, b) = (v[i], v[(i + 1) % v.len()]);
        let e = len(sub(b, a));
        let count = (e / target).round().max(1.0) as usize;
        let d = mul(sub(b, a), 1.0 / count as f64);
        // Outward normal: to the right of travel for an anticlockwise polygon.
        let u = unit(d);
        let out = if ccw { (u.1, -u.0) } else { (-u.1, u.0) };
        for j in 0..count {
            let p0 = add(a, mul(d, j as f64));
            let p1 = add(p0, d);
            let m = mul(add(p0, p1), 0.5);
            let r = len(d) / 2.0;
            let top = add(m, mul(out, r));
            if first {
                o.m(p0);
                first = false;
            }
            // p0 -> top: tangent at p0 is `out`, tangent at top is `u`.
            o.c(add(p0, mul(out, k * r)), sub(top, mul(u, k * r)), top);
            // top -> p1: tangent at top is `u`, tangent at p1 is `-out`.
            o.c(add(top, mul(u, k * r)), add(p1, mul(out, k * r)), p1);
            pts.push(top);
            pts.push(p0);
        }
    }
    o.raw(if s.fill.is_some() { "h B" } else { "h S" });
    Appearance { ops: o.0, bbox: BBox::of(&pts).grow(s.width / 2.0 + 1.0).snap(), opacity: op(s), font: false }
}

/// Freehand ink: each stroke smoothed with a Catmull-Rom spline through its points.
pub fn ink(strokes: &[Vec<Pt>], s: &Style) -> Appearance {
    let mut o = Ops::default();
    o.style(s, s.opacity < 1.0);
    let mut all = Vec::new();
    for st in strokes {
        if st.is_empty() {
            continue;
        }
        o.m(st[0]);
        for i in 0..st.len().saturating_sub(1) {
            let p0 = st[i.saturating_sub(1)];
            let (p1, p2) = (st[i], st[i + 1]);
            let p3 = st[(i + 2).min(st.len() - 1)];
            let c1 = add(p1, mul(sub(p2, p0), 1.0 / 6.0));
            let c2 = sub(p2, mul(sub(p3, p1), 1.0 / 6.0));
            o.c(c1, c2, p2);
        }
        o.raw("S");
        all.extend_from_slice(st);
    }
    Appearance { ops: o.0, bbox: BBox::of(&all).grow(s.width / 2.0 + 2.0).snap(), opacity: op(s), font: false }
}

/// Escape a string for a PDF literal, encoding it as WinAnsi (what /Helv uses here).
pub fn pdf_text(s: &str) -> String {
    let mut out = String::new();
    for b in helvetica::to_winansi(s) {
        match b {
            b'(' | b')' | b'\\' => {
                out.push('\\');
                out.push(b as char);
            }
            0x20..=0x7e => out.push(b as char),
            _ => out.push_str(&format!("\\{:03o}", b)),
        }
    }
    out
}

/// Text box: border, optional fill, and the text wrapped to the box with Helvetica's metrics.
pub struct TextLayout {
    pub lines: Vec<String>,
    pub size: f64,
    pub leading: f64,
    pub pad: f64,
}

pub fn layout_text(text: &str, box_width: f64, size: f64) -> TextLayout {
    let pad = 4.0;
    let lines = helvetica::wrap(text, box_width - 2.0 * pad, size);
    TextLayout { lines, size, leading: size * 1.2, pad }
}

/// Reading direction and "up" in page space for a page shown with /Rotate `rot` (clockwise),
/// so text reads upright on screen however the page is stored.
pub fn text_axes(rot: i64) -> (Pt, Pt) {
    match rot.rem_euclid(360) {
        90 => ((0.0, 1.0), (-1.0, 0.0)),
        180 => ((-1.0, 0.0), (0.0, -1.0)),
        270 => ((0.0, -1.0), (1.0, 0.0)),
        _ => ((1.0, 0.0), (0.0, 1.0)),
    }
}

/// A box as the reader sees it: width, height and the page point at its on-screen bottom left.
pub fn reader_frame(r: BBox, rot: i64) -> (f64, f64, Pt) {
    let b = r.0;
    let (w, h) = (b[2] - b[0], b[3] - b[1]);
    match rot.rem_euclid(360) {
        90 => (h, w, (b[2], b[1])),
        180 => (w, h, (b[2], b[3])),
        270 => (h, w, (b[0], b[3])),
        _ => (w, h, (b[0], b[1])),
    }
}

/// `cm` operator mapping the reader's frame (origin bottom left, x along the text) to the page.
fn frame_cm(o: &mut Ops, rot: i64, origin: Pt) {
    let (d, up) = text_axes(rot);
    o.raw(&format!("{} {} {} {} {} {} cm", n(d.0), n(d.1), n(up.0), n(up.1), n(origin.0), n(origin.1)));
}

/// Text in a box (FreeText). `r` is the box. `text_rgb` is the text colour, `s.stroke` the border.
/// `rot` is the page's /Rotate; `t` must have been laid out to the reader's width of the box.
pub fn text_box(r: BBox, t: &TextLayout, text_rgb: Rgb, s: &Style, rot: i64) -> Appearance {
    let mut o = Ops::default();
    o.raw("q");
    o.style(s, s.opacity < 1.0);
    let b = r.0;
    let hw = s.width / 2.0;
    if s.width > 0.0 || s.fill.is_some() {
        o.raw(&format!("{} {} {} {} re", n(b[0] + hw), n(b[1] + hw), n(b[2] - b[0] - s.width), n(b[3] - b[1] - s.width)));
        o.raw(match (s.fill.is_some(), s.width > 0.0) {
            (true, true) => "B",
            (true, false) => "f",
            _ => "S",
        });
    }
    o.raw("Q");
    let (w, h, origin) = reader_frame(r, rot);
    o.raw("q");
    frame_cm(&mut o, rot, origin);
    text_lines(&mut o, t.pad + s.width, h - t.pad - s.width - t.size * 0.78, t, text_rgb, Some(BBox([0.0, 0.0, w, h])));
    o.raw("Q");
    Appearance { ops: o.0, bbox: r.snap(), opacity: op(s), font: true }
}

/// Lines of text from a baseline origin, clipped to `clip` when given.
fn text_lines(o: &mut Ops, x: f64, y: f64, t: &TextLayout, rgb: Rgb, clip: Option<BBox>) {
    o.raw("q");
    if let Some(c) = clip {
        let c = c.0;
        o.raw(&format!("{} {} {} {} re W n", n(c[0]), n(c[1]), n(c[2] - c[0]), n(c[3] - c[1])));
    }
    o.raw("BT");
    o.fill_rgb(rgb);
    o.raw(&format!("/Helv {} Tf", n(t.size)));
    o.raw(&format!("{} {} Td", n(x), n(y)));
    o.raw(&format!("{} TL", n(t.leading)));
    for (i, line) in t.lines.iter().enumerate() {
        if i > 0 {
            o.raw("T*");
        }
        o.raw(&format!("({}) Tj", pdf_text(line)));
    }
    o.raw("ET");
    o.raw("Q");
}

/// Callout: a text box plus a leader from `leader[0]` (the arrow tip, at the thing being
/// pointed at) through an optional knee to the box edge.
pub fn callout(r: BBox, t: &TextLayout, text_rgb: Rgb, leader: &[Pt], s: &Style, rot: i64) -> Appearance {
    let mut boxed = text_box(r, t, text_rgb, s, rot);
    let mut o = Ops::default();
    o.raw("q");
    o.style(s, false);
    o.fill_rgb(s.stroke);
    o.m(leader[leader.len() - 1]);
    for p in leader.iter().rev().skip(1) {
        o.l(*p);
    }
    o.raw("S");
    let head = arrowhead(&mut o, leader[0], sub(leader[0], leader[1]), s.width, End::OpenArrow);
    o.raw("Q");
    boxed.ops.push_str(&o.0);
    let mut pts = leader.to_vec();
    pts.extend(head);
    boxed.bbox = boxed.bbox.union(BBox::of(&pts).grow(s.width + 1.0)).snap();
    boxed
}

/// A dimension: line with arrowheads at both ends and its value written above it, along the
/// line and kept upright.
pub fn dimension(a: Pt, b: Pt, label: &str, size: f64, s: &Style, rot: i64) -> Appearance {
    let mut ap = line(a, b, (End::ClosedArrow, End::ClosedArrow), s);
    // Read left to right (or bottom to top) as the page is shown on screen.
    let (right, up) = text_axes(rot);
    let d0 = unit(sub(b, a));
    let along = d0.0 * right.0 + d0.1 * right.1;
    let rising = d0.0 * up.0 + d0.1 * up.1;
    let (a, b) = if along < -1e-9 || along.abs() <= 1e-9 && rising < 0.0 { (b, a) } else { (a, b) };
    let d = unit(sub(b, a));
    let normal = (-d.1, d.0);
    let mid = mul(add(a, b), 0.5);
    let w = helvetica::width(label, size);
    let gap = s.width / 2.0 + 2.0;
    let origin = add(add(mid, mul(d, -w / 2.0)), mul(normal, gap));
    let mut o = Ops::default();
    o.raw("BT");
    o.fill_rgb(s.stroke);
    o.raw(&format!("/Helv {} Tf", n(size)));
    o.raw(&format!("{} {} {} {} {} {} Tm", n(d.0), n(d.1), n(-d.1), n(d.0), n(origin.0), n(origin.1)));
    o.raw(&format!("({}) Tj", pdf_text(label)));
    o.raw("ET");
    ap.ops.push_str(&o.0);
    let far = add(origin, mul(normal, size));
    let corners = [origin, add(origin, mul(d, w)), far, add(far, mul(d, w))];
    ap.bbox = ap.bbox.union(BBox::of(&corners).grow(1.0)).snap();
    ap.font = true;
    ap
}

/// Area of a polygon with its value at the centroid of its vertices.
pub fn area(v: &[Pt], label: &str, size: f64, s: &Style, rot: i64) -> Appearance {
    let mut ap = polygon(v, s);
    let cx = v.iter().map(|p| p.0).sum::<f64>() / v.len() as f64;
    let cy = v.iter().map(|p| p.1).sum::<f64>() / v.len() as f64;
    let w = helvetica::width(label, size);
    let mut o = Ops::default();
    o.raw("BT");
    o.fill_rgb(s.stroke);
    o.raw(&format!("/Helv {} Tf", n(size)));
    let (d, up) = text_axes(rot);
    let origin = sub(sub((cx, cy), mul(d, w / 2.0)), mul(up, size * 0.35));
    o.raw(&format!("{} {} {} {} {} {} Tm", n(d.0), n(d.1), n(up.0), n(up.1), n(origin.0), n(origin.1)));
    o.raw(&format!("({}) Tj", pdf_text(label)));
    o.raw("ET");
    ap.ops.push_str(&o.0);
    ap.font = true;
    ap
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_compact() {
        assert_eq!(n(1.0), "1");
        assert_eq!(n(1.25), "1.25");
        assert_eq!(n(-0.0001), "0");
        assert_eq!(n(2384.1234), "2384.123");
    }

    #[test]
    fn cloud_scallops_bulge_outwards() {
        // A square either way round: every scallop top must lie outside the square.
        for v in [
            vec![(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)],
            vec![(0.0, 0.0), (0.0, 100.0), (100.0, 100.0), (100.0, 0.0)],
        ] {
            let ap = cloud(&v, 1.0, &Style::stroke([1.0, 0.0, 0.0], 1.0));
            let b = ap.bbox.0;
            assert!(b[0] < -5.0 && b[1] < -5.0 && b[2] > 105.0 && b[3] > 105.0, "{b:?}");
        }
    }

    #[test]
    fn text_escapes_and_encodes() {
        assert_eq!(pdf_text("a(b)\\"), "a\\(b\\)\\\\");
        assert_eq!(pdf_text("12 m\u{b2}"), "12 m\\262");
    }
}
