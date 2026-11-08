//! Drawing-scale detection: matching scale notes in page text and ranking them.

use vellum_lib::scale::{RawCandidate, find_scale_matches, rank_candidates, score};

fn chars(s: &str) -> Vec<char> {
    s.chars().collect()
}

fn ratios(s: &str) -> Vec<f64> {
    find_scale_matches(&chars(s)).into_iter().map(|m| m.ratio).collect()
}

#[test]
fn finds_common_forms() {
    assert_eq!(ratios("SCALE 1:100 @ A1"), vec![100.0]);
    assert_eq!(ratios("Scale: 1 : 50"), vec![50.0]);
    assert_eq!(ratios("1:200"), vec![200.0]);
    assert_eq!(ratios("scale 1\u{2236}20"), vec![20.0]);
    assert_eq!(ratios("Plan 1:1,000 and detail 1:5"), vec![1000.0, 5.0]);
    assert_eq!(ratios("1:12.5"), vec![12.5]);
    assert_eq!(ratios("SCALE 1/100"), vec![100.0]);
    assert_eq!(ratios("(1:100)"), vec![100.0]);
}

#[test]
fn match_positions_and_text() {
    let m = &find_scale_matches(&chars("Scale 1 : 50 at A3"))[0];
    assert_eq!((m.start, m.end), (6, 12));
    assert_eq!(m.text, "1 : 50");
    assert!(m.labelled);
    let m = &find_scale_matches(&chars("Hall 3 1:200"))[0];
    assert!(!m.labelled);
}

#[test]
fn rejects_lookalikes() {
    assert!(ratios("Meeting at 11:30").is_empty(), "times");
    assert!(ratios("Starts 1:30:00").is_empty(), "times with seconds");
    assert!(ratios("Issued 1/10/2021").is_empty(), "dates");
    assert!(ratios("A1:50").is_empty(), "paper size then colon");
    assert!(ratios("21:100").is_empty(), "part of a larger number");
    assert!(ratios("Thickness 1/2 in").is_empty(), "fractions (non-standard slash ratio)");
    assert!(ratios("1:").is_empty(), "no number");
    assert!(ratios("ratio 1:x").is_empty(), "no number");
    assert!(ratios("v1.1:50").is_empty(), "version-like prefix");
}

#[test]
fn thousands_separator_needs_three_digits() {
    assert_eq!(ratios("1:1,50"), vec![1.0]);
    assert_eq!(ratios("1:2,500"), vec![2500.0]);
    assert_eq!(ratios("1:2,5000"), vec![2.0]);
}

fn cand(ratio: f64, x: f64, y: f64, labelled: bool) -> RawCandidate {
    RawCandidate { ratio, text: format!("1:{ratio}"), bbox: [x, y, x + 20.0, y + 8.0], labelled }
}

#[test]
fn prefers_bottom_right() {
    let (w, h) = (1190.0, 842.0);
    let ranked = rank_candidates(vec![cand(50.0, 100.0, 100.0, false), cand(200.0, 1100.0, 800.0, false)], w, h);
    assert_eq!(ranked[0].ratio, 200.0);
    assert_eq!(ranked.len(), 2);
}

#[test]
fn label_outweighs_position() {
    let (w, h) = (1190.0, 842.0);
    let ranked = rank_candidates(vec![cand(200.0, 1100.0, 800.0, false), cand(100.0, 600.0, 400.0, true)], w, h);
    assert_eq!(ranked[0].ratio, 100.0);
}

#[test]
fn standard_ratio_beats_odd_one_in_same_place() {
    let (w, h) = (1000.0, 700.0);
    let a = cand(137.0, 900.0, 650.0, false);
    let b = cand(100.0, 900.0, 650.0, false);
    assert!(score(&b, w, h) > score(&a, w, h));
}

#[test]
fn one_to_one_is_demoted() {
    let (w, h) = (1000.0, 700.0);
    let ranked = rank_candidates(vec![cand(1.0, 950.0, 680.0, true), cand(50.0, 500.0, 350.0, true)], w, h);
    assert_eq!(ranked[0].ratio, 50.0);
}

#[test]
fn implausible_ratios_dropped() {
    let ranked = rank_candidates(
        vec![
            cand(0.5, 0.0, 0.0, true),
            cand(250000.0, 0.0, 0.0, true),
            cand(f64::NAN, 0.0, 0.0, true),
            cand(100.0, 0.0, 0.0, false),
        ],
        100.0,
        100.0,
    );
    assert_eq!(ranked.len(), 1);
    assert_eq!(ranked[0].ratio, 100.0);
}

#[test]
fn empty_and_zero_size_page() {
    assert!(rank_candidates(vec![], 100.0, 100.0).is_empty());
    assert_eq!(rank_candidates(vec![cand(100.0, 5.0, 5.0, false)], 0.0, 0.0).len(), 1);
}
