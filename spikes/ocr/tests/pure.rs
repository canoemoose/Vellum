//! The pure parts: tiling, coordinate mapping, merging passes, scoring, image helpers and the
//! fixture. No PDFium, no OCR engine.

use ocr_spike::fixture::{self, Variant};
use ocr_spike::geom::{PageWord, TruthWord, merge_passes, owns, plan_tiles, plausibility, to_page, turn_point, unturn_point};
use ocr_spike::image;
use ocr_spike::score::{angle_bucket, edit_distance, judge, normalise, score, size_bucket};

fn word(text: &str, rect: [f32; 4], turns: i32, line: u32) -> PageWord {
    PageWord { text: text.into(), rect, turns, line, alt: false }
}

fn truth(text: &str, rect: [f32; 4]) -> TruthWord {
    TruthWord { text: text.into(), rect, size: 6.0, angle: 0.0 }
}

#[test]
fn small_render_is_one_tile() {
    let t = plan_tiles(1000, 800, 1600, 300);
    assert_eq!(t.len(), 1);
    assert_eq!((t[0].x, t[0].y, t[0].w, t[0].h), (0, 0, 1000, 800));
    assert_eq!(t[0].core, [0.0, 0.0, 1000.0, 800.0]);
}

#[test]
fn tiles_respect_the_limit_and_cover_the_render() {
    for &(w, h, max, ov) in &[(9933u32, 7017u32, 1600u32, 300u32), (4967, 3508, 4096, 400), (2072, 40000, 1600, 300), (1601, 1600, 1600, 300)] {
        let tiles = plan_tiles(w, h, max, ov);
        for t in &tiles {
            assert!(t.w <= max && t.h <= max, "tile {t:?} over {max}");
            assert!(t.x + t.w <= w && t.y + t.h <= h, "tile {t:?} outside {w}x{h}");
            // The core lies inside the tile, at least half the overlap from an inner seam.
            assert!(t.core[0] >= t.x as f32 && t.core[2] <= (t.x + t.w) as f32);
            assert!(t.core[1] >= t.y as f32 && t.core[3] <= (t.y + t.h) as f32);
        }
        // Cores tile the render: their areas add up to it exactly.
        let area: f64 = tiles.iter().map(|t| ((t.core[2] - t.core[0]) * (t.core[3] - t.core[1])) as f64).sum();
        assert!((area - w as f64 * h as f64).abs() < 1.0, "{w}x{h}: cores cover {area}");
    }
}

#[test]
fn every_point_is_owned_by_exactly_one_tile() {
    let tiles = plan_tiles(5000, 3500, 1600, 300);
    let mut y = 0.5;
    while y < 3500.0 {
        let mut x = 0.5;
        while x < 5000.0 {
            let owners = tiles
                .iter()
                .filter(|t| {
                    let r = [x - t.x as f32 - 0.25, y - t.y as f32 - 0.25, x - t.x as f32 + 0.25, y - t.y as f32 + 0.25];
                    owns(t, &r)
                })
                .count();
            assert_eq!(owners, 1, "point {x},{y}");
            x += 37.0;
        }
        y += 41.0;
    }
}

#[test]
fn a_word_up_to_the_overlap_long_is_whole_in_its_owner() {
    // A word 280 px long straddling a seam: the tile owning its centre contains all of it.
    let tiles = plan_tiles(5000, 1000, 1600, 300);
    for start in (1000..2200).step_by(13) {
        let (x0, x1) = (start as f32, start as f32 + 280.0);
        let owner = tiles
            .iter()
            .find(|t| owns(t, &[x0 - t.x as f32, 10.0, x1 - t.x as f32, 20.0]))
            .expect("an owner");
        assert!(x0 >= owner.x as f32 && x1 <= (owner.x + owner.w) as f32, "word {x0}..{x1} cut by tile {owner:?}");
    }
}

#[test]
fn turned_points_round_trip() {
    let (pw, ph) = (2384.0, 1684.0);
    for turns in 0..4 {
        for &(x, y) in &[(0.0, 0.0), (100.0, 50.0), (2384.0, 1684.0), (1234.5, 17.25)] {
            let (u, v) = turn_point(x, y, turns, pw, ph);
            let (bx, by) = unturn_point(u, v, turns, pw, ph);
            assert!((bx - x).abs() < 1e-3 && (by - y).abs() < 1e-3, "turns {turns}: {x},{y} -> {u},{v} -> {bx},{by}");
        }
    }
}

#[test]
fn a_quarter_turn_clockwise_puts_the_page_top_on_the_right() {
    // Turned 90 degrees clockwise, the top-left corner of the page goes to the top-right.
    let (pw, ph) = (200.0, 100.0);
    assert_eq!(turn_point(0.0, 0.0, 1, pw, ph), (100.0, 0.0));
    assert_eq!(turn_point(200.0, 0.0, 1, pw, ph), (100.0, 200.0));
    assert_eq!(turn_point(0.0, 0.0, 3, pw, ph), (0.0, 200.0));
}

#[test]
fn ocr_boxes_map_back_to_page_points() {
    // At 300 dpi (scale 300/72), a box in the turn-1 render of a 200 x 100 pt page.
    let s = 300.0 / 72.0;
    let page_box = [20.0f32, 10.0, 30.0, 60.0];
    let (u0, v0) = turn_point(page_box[0], page_box[1], 1, 200.0, 100.0);
    let (u1, v1) = turn_point(page_box[2], page_box[3], 1, 200.0, 100.0);
    let px = [u0.min(u1) * s, v0.min(v1) * s, u0.max(u1) * s, v0.max(v1) * s];
    let back = to_page(&px, s, 1, 200.0, 100.0);
    for i in 0..4 {
        assert!((back[i] - page_box[i]).abs() < 1e-3, "{back:?}");
    }
}

#[test]
fn plausibility_prefers_upright_readings() {
    // Pairs measured on the fixture: the upright reading (second) against the upside-down one.
    for (upside_down, upright) in [("Lona", "DUCT"), ("99ta", "D365"), ("ssnul", "TRUSS"), ("vvw-38", "BEAM4"), ("e\u{fffd}ggee", "3366.3")] {
        assert!(plausibility(upright) > plausibility(upside_down), "{upright} vs {upside_down}");
    }
    // Upside-down capitals and digits are still capitals and digits: a word alone can't tell
    // these apart, which is why merging also weighs the rest of the line.
    for (upside_down, upright) in [("L99L", "1561"), ("9N1991E", "RIGGING"), ("ZZ-O", "G-27")] {
        assert_eq!(plausibility(upright), plausibility(upside_down), "{upright} vs {upside_down}");
    }
    assert!(plausibility("conc.") > 0, "an all lower-case word is fine");
    assert!(plausibility("\u{fffd}\u{fffd}") < 0);
}

#[test]
fn merge_keeps_the_plausible_reading_and_the_other_as_an_alternate() {
    let words = vec![
        word("DUCT", [10.0, 10.0, 14.0, 40.0], 3, 0),
        word("Lona", [10.0, 11.0, 14.0, 39.0], 1, 1),
        // Horizontal word read by a turned pass: dropped (a sideways reading).
        word("SIDEWAYS", [50.0, 10.0, 90.0, 14.0], 1, 2),
        word("PLANT", [50.0, 10.0, 90.0, 14.0], 0, 3),
    ];
    let m = merge_passes(words);
    let get = |t: &str| m.iter().find(|w| w.text == t);
    assert!(!get("DUCT").unwrap().alt);
    assert!(get("Lona").unwrap().alt);
    assert!(get("SIDEWAYS").is_none());
    assert!(!get("PLANT").unwrap().alt);
}

#[test]
fn merge_uses_the_whole_line_to_break_a_tie() {
    // "8008" reads the same either way up; its line decides.
    let words = vec![
        word("8008", [10.0, 10.0, 14.0, 40.0], 1, 0),
        word("Lona", [10.0, 45.0, 14.0, 70.0], 1, 0),
        word("8008", [10.0, 10.0, 14.0, 40.0], 3, 1),
        word("DUCT", [10.0, 45.0, 14.0, 70.0], 3, 1),
    ];
    let m = merge_passes(words);
    let primary: Vec<_> = m.iter().filter(|w| !w.alt).map(|w| (w.text.as_str(), w.turns)).collect();
    assert!(primary.contains(&("8008", 3)) && primary.contains(&("DUCT", 3)), "{primary:?}");
}

#[test]
fn normalising_and_edit_distance() {
    assert_eq!(normalise("Conc."), "conc");
    assert_eq!(normalise("600\u{00d7}600"), "600x600");
    assert_eq!(normalise("\u{2013}5"), "-5");
    assert_eq!(edit_distance("D212", "0212"), 1);
    assert_eq!(edit_distance("kitten", "sitting"), 3);
    assert_eq!(edit_distance("", "abc"), 3);
}

#[test]
fn judging_found_near_and_missed() {
    let t = truth("FFL+5.654", [100.0, 100.0, 140.0, 108.0]);
    assert_eq!(judge(&t, &[word("ffl+5.654", [101.0, 100.0, 139.0, 107.0], 0, 0)]), 2);
    // Split by the engine: near (a space-insensitive search would still find it).
    let split = [word("FFL", [100.0, 100.0, 112.0, 107.0], 0, 0), word("+5.654", [113.0, 100.0, 140.0, 107.0], 0, 0)];
    assert_eq!(judge(&t, &split), 1);
    // One character wrong: near.
    assert_eq!(judge(&t, &[word("FFL+5.664", [100.0, 100.0, 140.0, 108.0], 0, 0)]), 1);
    // Right text in the wrong place: missed.
    assert_eq!(judge(&t, &[word("FFL+5.654", [300.0, 100.0, 340.0, 108.0], 0, 0)]), 0);
}

#[test]
fn scoring_counts_buckets_and_junk() {
    let truth = vec![truth("A-1", [0.0, 0.0, 10.0, 6.0]), TruthWord { text: "B-2".into(), rect: [0.0, 20.0, 6.0, 30.0], size: 2.5, angle: 90.0 }];
    let ocr = vec![word("A-1", [0.0, 0.0, 10.0, 6.0], 0, 0), word("junk", [500.0, 500.0, 520.0, 506.0], 0, 1)];
    let s = score(&truth, &ocr);
    assert_eq!((s.all.truth, s.all.found, s.junk, s.ocr_words), (2, 1, 1, 2));
    assert_eq!(s.by_angle["0"].found, 1);
    assert_eq!(s.by_angle["90"].found, 0);
    assert_eq!(size_bucket(2.5), "a <3");
    assert_eq!(angle_bucket(-90.0), "270");
    assert_eq!(angle_bucket(358.0), "0");
    assert_eq!(angle_bucket(45.0), "other");
}

#[test]
fn dark_tiles_are_detected_and_inverted() {
    let mut px = vec![20u8; 64 * 64];
    assert!(image::is_dark(&px, 64, 64, 64));
    image::invert(&mut px);
    assert!(!image::is_dark(&px, 64, 64, 64));
    assert_eq!(px[0], 235);
    let white = vec![255u8; 64 * 64];
    assert_eq!(image::mean(&white, 64, 64, 64), 255.0);
}

#[test]
fn the_fixture_is_deterministic_and_complete() {
    let (a, la) = fixture::layout(1, Variant::DRAWING);
    let (b, lb) = fixture::layout(1, Variant::DRAWING);
    assert_eq!(a.len(), b.len());
    assert!(a.iter().zip(&b).all(|(x, y)| x.text == y.text && x.x == y.x && x.y == y.y));
    assert_eq!(la.len(), lb.len());
    // 4 angles x 8 sizes x 16 tokens, plus the title block.
    assert_eq!(a.len(), 4 * 8 * 16 + 2);
    // Every variant has the same text; only the lines differ.
    let (clean, lc) = fixture::layout(1, Variant::CLEAN);
    assert!(clean.iter().zip(&a).all(|(x, y)| x.text == y.text));
    assert!(lc.is_empty());
    let (_, lw) = fixture::layout(1, Variant::LINE_WORK);
    assert_eq!(lw.len(), 3000);
    // Everything lies on the sheet.
    for it in &a {
        assert!(it.x > 0.0 && it.x < fixture::PAGE_W && it.y > 0.0 && it.y < fixture::PAGE_H, "{it:?}");
    }
}
