//! The markups every sample carries: the first five tools (arrow, rectangle, cloud, text box,
//! pen) plus polygon, callout and the two measurements, laid out on a page of any size.

use crate::appearance::{BBox, Style};
use crate::writer::{Markup, Meta};

pub const RED: [f64; 3] = [0.85, 0.1, 0.1];
pub const BLUE: [f64; 3] = [0.05, 0.35, 0.8];
pub const TEAL: [f64; 3] = [0.05, 0.58, 0.53];
pub const BLACK: [f64; 3] = [0.0, 0.0, 0.0];

/// (name, markup) pairs for a page `w` x `h` points with its origin at `(x0, y0)`.
pub fn markups(x0: f64, y0: f64, w: f64, h: f64) -> Vec<(&'static str, Markup)> {
    // Scale weights and text with the paper: A4 1x, A1 about 2.8x.
    let k = ((w * h) / (595.0 * 842.0)).sqrt().clamp(1.0, 3.0);
    let p = |fx: f64, fy: f64| (x0 + fx * w, y0 + fy * h);
    let bb = |a: f64, b: f64, c: f64, d: f64| BBox([x0 + a * w, y0 + b * h, x0 + c * w, y0 + d * h]);
    let st = |c, wt: f64| Style::stroke(c, wt * k);
    vec![
        ("arrow", Markup::Arrow { from: p(0.06, 0.60), to: p(0.24, 0.76), style: st(RED, 1.5) }),
        ("rectangle", Markup::Rect { rect: bb(0.30, 0.60, 0.45, 0.78), style: st(RED, 1.5) }),
        (
            "cloud",
            Markup::Cloud {
                vertices: vec![p(0.52, 0.60), p(0.68, 0.58), p(0.70, 0.72), p(0.62, 0.80), p(0.53, 0.76)],
                intensity: 1.0,
                style: st(RED, 1.0),
            },
        ),
        (
            "text box",
            Markup::Text {
                rect: bb(0.75, 0.62, 0.95, 0.80),
                text: "Text box: Helvetica, wrapped by Vellum to the box width.\nSecond paragraph: \u{b1}5 mm, 90\u{b0}.".into(),
                size: 9.0 * k,
                colour: BLACK,
                style: Style { fill: Some([1.0, 1.0, 0.85]), ..st(BLUE, 1.0) },
            },
        ),
        (
            "pen",
            Markup::Ink {
                strokes: vec![
                    (0..=40)
                        .map(|i| {
                            let t = i as f64 / 40.0;
                            p(0.06 + 0.18 * t, 0.39 + 0.05 * (t * std::f64::consts::TAU * 2.0).sin())
                        })
                        .collect(),
                    vec![p(0.08, 0.31), p(0.12, 0.33), p(0.16, 0.31), p(0.20, 0.33)],
                ],
                style: st(BLUE, 2.0),
            },
        ),
        (
            "polygon",
            Markup::Polygon {
                vertices: vec![p(0.30, 0.30), p(0.46, 0.32), p(0.44, 0.48), p(0.34, 0.45)],
                style: Style { fill: Some([1.0, 0.85, 0.0]), opacity: 0.5, ..st([0.75, 0.55, 0.0], 1.0) },
            },
        ),
        (
            "callout",
            Markup::Callout {
                rect: bb(0.75, 0.32, 0.95, 0.45),
                leader: vec![p(0.58, 0.40), p(0.66, 0.40), p(0.75, 0.40)],
                text: "Callout with a leader".into(),
                size: 9.0 * k,
                colour: BLACK,
                style: Style { fill: Some([1.0, 1.0, 1.0]), ..st(TEAL, 1.0) },
            },
        ),
        (
            "distance",
            Markup::Distance { from: p(0.06, 0.14), to: p(0.45, 0.14), ratio: 100.0, unit: "m", size: 9.0 * k, style: st(TEAL, 1.0) },
        ),
        (
            "area",
            Markup::Area {
                vertices: vec![p(0.52, 0.08), p(0.70, 0.08), p(0.70, 0.22), p(0.60, 0.26), p(0.52, 0.22)],
                ratio: 100.0,
                unit: "m",
                size: 9.0 * k,
                style: Style { fill: Some(TEAL), opacity: 0.25, ..st(TEAL, 1.0) },
            },
        ),
    ]
}

pub fn meta(id: String) -> Meta {
    Meta { id, author: "Vellum spike".into(), date: "D:20261113120000Z".into() }
}
