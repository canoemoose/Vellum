//! A checking tool rather than a test: report what's in PDFs printed or saved by Vellum.
//!
//!   VELLUM_INSPECT="a.pdf;b.pdf" cargo test --test print_inspect -- --ignored --nocapture
//!
//! For each file and page: size in mm (and its ISO name), the bounding box of the ink in mm
//! (any channel under 200, rendered at 288 dpi), the centroid of strongly blue pixels
//! from the top-left, and the share of the page that's ink. Ignored by default.

mod print_common;

use print_common::*;
use std::sync::Arc;

fn iso(w: f64, h: f64) -> &'static str {
    let (a, b) = (w.min(h), w.max(h));
    for (n, x, y) in [("A0", 841.0, 1189.0), ("A1", 594.0, 841.0), ("A2", 420.0, 594.0), ("A3", 297.0, 420.0), ("A4", 210.0, 297.0)] {
        if (a - x).abs() < 2.0 && (b - y).abs() < 2.0 {
            return n;
        }
    }
    "-"
}

#[test]
#[ignore]
fn inspect() {
    let list = std::env::var("VELLUM_INSPECT").unwrap_or_default();
    let mm = 25.4 / 72.0;
    for path in list.split(';').filter(|s| !s.is_empty()) {
        let bytes = Arc::new(std::fs::read(path).expect("read"));
        let sizes = page_sizes(bytes.clone());
        println!("{path}: {} pages, {} bytes", sizes.len(), bytes.len());
        for (i, &(w, h)) in sizes.iter().enumerate() {
            let ppp = 4.0;
            let (px, pw, ph) = render_pdf_page(bytes.clone(), i, w, h, ppp);
            let ink = px.chunks_exact(4).filter(|p| p[0].min(p[1]).min(p[2]) < 200).count();
            let dark: Vec<u8> = px.iter().enumerate().map(|(i, &v)| if i % 4 == 3 { v } else if px[i - i % 4].min(px[i - i % 4 + 1]).min(px[i - i % 4 + 2]) < 200 { 0 } else { 255 }).collect();
            let bb = ink_bbox(&dark, pw, ph);
            // Centroid of strongly blue pixels (finds a test image's blue disc).
            // VELLUM_INSPECT_BLUE_BELOW_MM limits it to the part of the page below that line.
            let below = std::env::var("VELLUM_INSPECT_BLUE_BELOW_MM").ok().and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
            let (mut sx, mut sy, mut n) = (0f64, 0f64, 0f64);
            for (k, p) in px.chunks_exact(4).enumerate() {
                // BGRx: byte 0 is blue.
                if p[0] as i32 > p[2] as i32 + 60 && p[0] > 120 && (k as i32 / pw) as f64 * mm / ppp >= below {
                    sx += (k as i32 % pw) as f64;
                    sy += (k as i32 / pw) as f64;
                    n += 1.0;
                }
            }
            if n > 50.0 {
                println!("  blue centroid at {:.1}, {:.1} mm", sx / n * mm / ppp, sy / n * mm / ppp);
            }
            let bbs = bb.map_or("none".to_string(), |(a, b, c, d)| {
                format!("x {:.1}..{:.1} y {:.1}..{:.1} mm", a as f64 * mm / ppp, c as f64 * mm / ppp, b as f64 * mm / ppp, d as f64 * mm / ppp)
            });
            println!(
                "  page {}: {:.1} x {:.1} mm ({}) ink {} ({:.1}% of page)",
                i + 1,
                w * mm,
                h * mm,
                iso(w * mm, h * mm),
                bbs,
                100.0 * ink as f64 / (pw * ph) as f64
            );
        }
    }
}
