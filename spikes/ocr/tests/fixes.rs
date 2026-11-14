//! The improvements after the first spike: forgiving search, re-reading misread clusters, and
//! merging a pass with the line work removed. Pure.

use ocr_spike::geom::{PageWord, TruthWord, along_across, better_reading, clusters, merge_clean, suspect};
use ocr_spike::score::search_score;
use ocr_spike::search::{Mode, fold, search};

fn w(text: &str, rect: [f32; 4], turns: i32, line: u32) -> PageWord {
    PageWord { text: text.into(), rect, turns, line, alt: false }
}

#[test]
fn folding_maps_look_alikes_only_when_forgiving() {
    assert_eq!(fold('O', Mode::Strict), vec!['o']);
    assert_eq!(fold('O', Mode::Forgiving), vec!['0']);
    assert_eq!(fold('l', Mode::Forgiving), vec!['1']);
    assert_eq!(fold('I', Mode::Forgiving), vec!['1']);
    assert_eq!(fold('S', Mode::Forgiving), vec!['5']);
    assert_eq!(fold('B', Mode::Forgiving), vec!['8']);
    assert_eq!(fold('Z', Mode::Forgiving), vec!['2']);
    assert!(fold(' ', Mode::Forgiving).is_empty());
    assert_eq!(fold(' ', Mode::Strict), vec![' ']);
}

#[test]
fn a_code_read_in_pieces_is_found_only_when_forgiving() {
    let words = vec![w("D2.1", [100.0, 10.0, 110.0, 14.0], 0, 7), w("0A", [111.0, 10.0, 115.0, 14.0], 0, 7)];
    assert!(search(&words, "D2.10A", Mode::Strict).is_empty());
    let hits = search(&words, "D2.10A", Mode::Forgiving);
    assert_eq!(hits, vec![[100.0, 10.0, 115.0, 14.0]]);
}

#[test]
fn a_look_alike_is_found_only_when_forgiving() {
    let words = vec![w("D2.O5A", [0.0, 0.0, 20.0, 5.0], 0, 0)];
    assert!(search(&words, "D2.05A", Mode::Strict).is_empty());
    assert_eq!(search(&words, "d2.05a", Mode::Forgiving).len(), 1);
}

#[test]
fn strict_search_is_case_insensitive_and_finds_every_occurrence() {
    let words = vec![w("GAS", [0.0, 0.0, 10.0, 4.0], 0, 0), w("MAIN", [11.0, 0.0, 25.0, 4.0], 0, 0), w("gas", [0.0, 50.0, 10.0, 54.0], 0, 1)];
    assert_eq!(search(&words, "gas", Mode::Strict).len(), 2);
    assert_eq!(search(&words, "GAS MAIN", Mode::Strict), vec![[0.0, 0.0, 25.0, 4.0]]);
    assert!(search(&words, "", Mode::Strict).is_empty());
}

#[test]
fn words_of_a_vertical_line_are_read_in_its_direction() {
    // Text reading up (turn 1): the lower word comes first.
    let words = vec![w("MAIN", [0.0, 10.0, 4.0, 30.0], 1, 0), w("WATER", [0.0, 32.0, 4.0, 55.0], 1, 0)];
    assert_eq!(search(&words, "WATER MAIN", Mode::Strict).len(), 1);
    // Reading down (turn 3): the upper word comes first.
    let words = vec![w("WATER", [0.0, 10.0, 4.0, 30.0], 3, 0), w("MAIN", [0.0, 32.0, 4.0, 55.0], 3, 0)];
    assert_eq!(search(&words, "WATER MAIN", Mode::Strict).len(), 1);
}

#[test]
fn alternates_are_searched_on_their_own() {
    let mut alt = w("D2.29A", [0.0, 0.0, 20.0, 5.0], 0, 0);
    alt.alt = true;
    let words = vec![alt, w("STAIR", [21.0, 0.0, 40.0, 5.0], 0, 0)];
    assert_eq!(search(&words, "D2.29A", Mode::Strict).len(), 1);
    // ...and not joined to the primary words around them.
    assert!(search(&words, "D2.29A STAIR", Mode::Strict).is_empty());
}

#[test]
fn search_score_counts_hits_and_strays() {
    let truth = vec![
        TruthWord { text: "PLANT".into(), rect: [0.0, 0.0, 20.0, 5.0], size: 4.0, angle: 0.0 },
        TruthWord { text: "DUCT".into(), rect: [0.0, 20.0, 20.0, 25.0], size: 4.0, angle: 0.0 },
    ];
    let ocr = vec![w("PLANT", [0.0, 0.0, 20.0, 5.0], 0, 0), w("PLANT", [100.0, 100.0, 120.0, 105.0], 0, 1)];
    let s = search_score(&truth, &ocr, Mode::Strict);
    assert_eq!((s.queries, s.hit, s.stray), (2, 1, 1));
}

#[test]
fn reading_axes_follow_the_pass() {
    let r = [10.0, 20.0, 14.0, 60.0];
    // Upright: along x, across y.
    assert_eq!(along_across(&r, 0), ((10.0, 14.0), (20.0, 60.0)));
    // Reading up: along is upwards (from the bottom), across is x.
    assert_eq!(along_across(&r, 1), ((-60.0, -20.0), (10.0, 14.0)));
    // Reading down: along y.
    assert_eq!(along_across(&r, 3).0, (20.0, 60.0));
}

#[test]
fn clusters_split_at_wide_gaps() {
    let words = vec![
        w("8\"", [0.0, 0.0, 6.0, 4.0], 0, 0),
        w("WATER", [7.0, 0.0, 30.0, 4.0], 0, 0),
        w("MAIN", [31.0, 0.0, 50.0, 4.0], 0, 0),
        // 50 pt further along the same OCR line: another label.
        w("CURB", [100.0, 0.0, 120.0, 4.0], 0, 0),
        w("TOP", [0.0, 40.0, 15.0, 44.0], 0, 1),
    ];
    let mut c = clusters(&words);
    c.sort();
    assert_eq!(c, vec![vec![0, 1, 2], vec![3], vec![4]]);
}

#[test]
fn suspect_clusters() {
    // Pieces closer than half the text height: one word in fragments.
    let frag = vec![w("D2.1", [0.0, 0.0, 10.0, 4.0], 0, 0), w("0A", [11.0, 0.0, 15.0, 4.0], 0, 0)];
    assert!(suspect(&frag, &[0, 1]));
    // O next to a digit.
    let oh = vec![w("D2.O5A", [0.0, 0.0, 20.0, 4.0], 0, 0)];
    assert!(suspect(&oh, &[0]));
    // A clean label.
    let ok = vec![w("WATER", [0.0, 0.0, 22.0, 4.0], 0, 0), w("VALVE", [26.0, 0.0, 48.0, 4.0], 0, 0)];
    assert!(!suspect(&ok, &[0, 1]));
}

#[test]
fn a_reread_replaces_only_when_it_is_no_worse() {
    let old = [w("D2.1", [0.0; 4], 0, 0), w("0A", [0.0; 4], 0, 0)];
    let good = [w("D2.10A", [0.0; 4], 0, 1)];
    let lost = [w("D", [0.0; 4], 0, 1)];
    let junk = [w("D?;~a", [0.0; 4], 0, 1)];
    fn refs(ws: &[PageWord]) -> Vec<&PageWord> {
        ws.iter().collect()
    }
    assert!(better_reading(&refs(&old), &refs(&good)));
    assert!(!better_reading(&refs(&old), &refs(&lost)));
    assert!(!better_reading(&refs(&old), &refs(&junk)));
    assert!(!better_reading(&refs(&old), &[]));
}

#[test]
fn the_clean_pass_wins_where_both_read_and_the_rest_is_kept() {
    let base = vec![w("D2.1", [0.0, 0.0, 10.0, 4.0], 0, 3), w("TITLE", [0.0, 100.0, 80.0, 120.0], 0, 4)];
    let clean = vec![w("D2.10A", [0.0, 0.0, 15.0, 4.0], 0, 0)];
    let m = merge_clean(base, clean);
    let get = |t: &str| m.iter().find(|x| x.text == t).unwrap();
    assert!(get("D2.1").alt, "the cluttered reading becomes an alternate");
    assert!(!get("D2.10A").alt);
    assert!(!get("TITLE").alt, "large text the filter may have removed stays");
    assert!(get("D2.10A").line > 4, "clean lines don't collide with base lines");
}
