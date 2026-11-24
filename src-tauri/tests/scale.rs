//! Drawing-scale detection: matching scale notes in page text and ranking them.

use vellum_lib::scale::{RawCandidate, find_scale_matches, rank_candidates, rescale_for_page, score};

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
    RawCandidate { ratio, text: format!("1:{ratio}"), bbox: [x, y, x + 20.0, y + 8.0], labelled, sheet: None }
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

// ---------------------------------------------------------------- stated sheet sizes

/// A1 and A3 pages in points, landscape.
const A1: (f64, f64) = (2383.94, 1683.78);
const A3: (f64, f64) = (1190.55, 841.89);

fn sheets(s: &str) -> Vec<Option<u8>> {
    find_scale_matches(&chars(s)).into_iter().map(|m| m.sheet).collect()
}

#[test]
fn reads_the_stated_sheet_size() {
    assert_eq!(sheets("Scale 1:200 @A3"), vec![Some(3)]);
    assert_eq!(sheets("1:200 @ A3"), vec![Some(3)]);
    assert_eq!(sheets("1:100 at A1"), vec![Some(1)]);
    assert_eq!(sheets("1:50@a2"), vec![Some(2)]);
    assert_eq!(sheets("1:200"), vec![None]);
    assert_eq!(sheets("1:200 A3"), vec![None], "no @ or 'at': not a stated sheet");
    assert_eq!(sheets("1:200 @A34"), vec![None], "not a sheet name");
    assert_eq!(sheets("1:200 @A9"), vec![None], "outside A0-A5");
    assert_eq!(sheets("1:200 attic A3"), vec![None]);
    // The match text and box stay on the ratio itself.
    let m = &find_scale_matches(&chars("1:200 @A3"))[0];
    assert_eq!(m.text, "1:200");
    assert_eq!(m.end, 5);
}

#[test]
fn rescale_maths() {
    // 1:200 at A3 on an A1 page: 200 * 420 / 841 = 99.9, snapped to 100.
    assert_eq!(rescale_for_page(200.0, 420.0, 841.0), 100.0);
    // Page is the stated sheet (within 3%): unchanged.
    assert_eq!(rescale_for_page(100.0, 841.0, 841.0), 100.0);
    assert_eq!(rescale_for_page(100.0, 841.0, 830.0), 100.0);
    // 1:100 at A1 printed on A3: 1:200.
    assert_eq!(rescale_for_page(100.0, 841.0, 420.0), 200.0);
    // Far from any standard ratio: rounded to a whole number.
    // 100 * 841 / 760 = 110.7: 10% from 100, 13% from 125.
    assert_eq!(rescale_for_page(100.0, 841.0, 760.0), 111.0);
    // 100 * 841 / 700 = 120.1: within 5% of 125, so snapped.
    assert_eq!(rescale_for_page(100.0, 841.0, 700.0), 125.0);
    // Degenerate page sizes leave it alone.
    assert_eq!(rescale_for_page(200.0, 420.0, 0.0), 200.0);
}

fn cand_at(text: &str, page: (f64, f64)) -> Vec<vellum_lib::scale::ScaleCandidate> {
    let raw = find_scale_matches(&chars(text))
        .into_iter()
        .map(|m| RawCandidate { ratio: m.ratio, text: m.text, bbox: [page.0 - 300.0, page.1 - 150.0, page.0 - 270.0, page.1 - 140.0], labelled: m.labelled, sheet: m.sheet })
        .collect();
    rank_candidates(raw, page.0, page.1)
}

#[test]
fn stage_plan_title_block_on_an_a1_page_is_1_to_100() {
    // The stage plan: title block says "1:200 @A3", the PDF page is A1.
    let c = cand_at("Scale 1:200 @A3", A1);
    assert_eq!(c[0].ratio, 100.0);
    assert_eq!(c[0].stated_ratio, Some(200.0));
    assert_eq!(c[0].sheet.as_deref(), Some("A3"));
    assert_eq!(c[0].text, "1:200");
}

#[test]
fn stated_sheet_matching_the_page_is_unchanged() {
    let c = cand_at("Scale 1:100 @A1", A1);
    assert_eq!(c[0].ratio, 100.0);
    assert_eq!(c[0].stated_ratio, None);
    assert_eq!(c[0].sheet.as_deref(), Some("A1"));
    // Portrait pages use their long side too.
    let c = cand_at("1:200 @A3", (A3.1, A3.0));
    assert_eq!(c[0].ratio, 200.0);
}

#[test]
fn ratio_without_a_sheet_is_unchanged_on_any_page() {
    let c = cand_at("Scale 1:200", A1);
    assert_eq!(c[0].ratio, 200.0);
    assert_eq!(c[0].stated_ratio, None);
    assert_eq!(c[0].sheet, None);
}

#[test]
fn a_stated_sheet_ranks_above_a_bare_ratio_in_the_same_place() {
    let (w, h) = A1;
    let bare = RawCandidate { ratio: 50.0, text: "1:50".into(), bbox: [2000.0, 1500.0, 2030.0, 1510.0], labelled: false, sheet: None };
    let stated = RawCandidate { sheet: Some(1), ratio: 100.0, text: "1:100".into(), ..bare.clone() };
    assert!(score(&stated, w, h) > score(&bare, w, h));
}

mod clean {
    use vellum_lib::scale::{TextChar, clean_text, find_scale_matches, same_line};

    /// Characters laid out left to right from `x` on a line whose baseline is `y` (user
    /// space, y up), 10 pt high, 6 pt wide each. `|` is a PDFium-generated line break.
    fn line(s: &str, x: f64, y: f64) -> Vec<TextChar> {
        let mut out = Vec::new();
        let mut cx = x;
        for c in s.chars() {
            if c == '|' {
                out.push(TextChar { c: '\r', generated: true, bbox: None });
                out.push(TextChar { c: '\n', generated: true, bbox: None });
            } else {
                out.push(TextChar { c, generated: false, bbox: Some([cx, y, cx + 6.0, y + 10.0]) });
                cx += 6.0;
            }
        }
        out
    }

    fn brk() -> Vec<TextChar> {
        vec![TextChar { c: '\r', generated: true, bbox: None }, TextChar { c: '\n', generated: true, bbox: None }]
    }

    #[test]
    fn same_line_needs_half_the_height_to_overlap() {
        assert!(same_line([0.0, 0.0, 6.0, 10.0], [6.0, 2.0, 12.0, 12.0]));
        assert!(!same_line([0.0, 0.0, 6.0, 10.0], [6.0, 6.0, 12.0, 16.0]));
        assert!(!same_line([0.0, 0.0, 6.0, 10.0], [0.0, -20.0, 6.0, -10.0]));
    }

    #[test]
    fn drops_breaks_pdfium_put_inside_a_line() {
        // The Fieldwork site plan's title block as PDFium reports it: a break between nearly
        // every character, the label above the scale and the date below it on other lines.
        let mut t = line("S|C|A|L|E", 0.0, 40.0);
        t.extend(brk());
        t.extend(line("1|:|5|0|0|0| |@| |A|1", 0.0, 20.0));
        t.extend(brk());
        t.extend(line("2|0|2|6|-|1|1|-|1|7", 0.0, 0.0));
        let (chars, map) = clean_text(&t);
        let s: String = chars.iter().collect();
        assert_eq!(s, "SCALE 1:5000 @ A1 2026-11-17");
        let m = find_scale_matches(&chars);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].ratio, 5000.0);
        assert!(m[0].labelled);
        assert_eq!(m[0].sheet, Some(1));
        // Every matched char maps back to a real PDFium char (for its box).
        assert!((m[0].start..m[0].end).all(|i| map[i].is_some_and(|k| !t[k].generated)));
    }

    #[test]
    fn keeps_clean_text_as_it_was() {
        let mut t = line("SCALE", 0.0, 40.0);
        t.extend(brk());
        t.extend(line("1:200 @ A3", 0.0, 20.0));
        let (chars, _) = clean_text(&t);
        assert_eq!(chars.iter().collect::<String>(), "SCALE 1:200 @ A3");
    }

    #[test]
    fn a_break_with_nothing_on_one_side_is_a_space() {
        let mut t = brk();
        t.extend(line("1:50", 0.0, 0.0));
        t.extend(brk());
        let (chars, _) = clean_text(&t);
        assert_eq!(chars.iter().collect::<String>(), "1:50 ");
    }
}

mod imperial {
    use vellum_lib::scale::find_scale_matches;

    fn found(s: &str) -> Vec<(String, f64)> {
        find_scale_matches(&s.chars().collect::<Vec<_>>()).into_iter().map(|m| (m.text, m.ratio)).collect()
    }
    fn ratios(s: &str) -> Vec<f64> {
        found(s).into_iter().map(|(_, r)| r).collect()
    }

    #[test]
    fn reads_architectural_scales() {
        assert_eq!(ratios("SCALE: 1/4\" = 1'-0\""), vec![48.0]);
        assert_eq!(ratios("1/8\"=1'-0\""), vec![96.0]);
        assert_eq!(ratios("3/16\" = 1'-0\""), vec![64.0]);
        assert_eq!(ratios("3/32\" = 1'-0\""), vec![128.0]);
        assert_eq!(ratios("1/2\" = 1'-0\""), vec![24.0]);
        assert_eq!(ratios("3/4\" = 1'-0\""), vec![16.0]);
        assert_eq!(ratios("1\" = 1'-0\""), vec![12.0]);
        assert_eq!(ratios("1 1/2\" = 1'-0\""), vec![8.0]);
        assert_eq!(ratios("1-1/2\" = 1'-0\""), vec![8.0]);
        assert_eq!(ratios("3\" = 1'-0\""), vec![4.0]);
        assert_eq!(ratios("1/4\" = 1' 0\""), vec![48.0]);
        assert_eq!(ratios("1/4\" = 1'"), vec![48.0]);
    }

    #[test]
    fn reads_engineering_scales() {
        assert_eq!(ratios("SCALE 1\" = 20'"), vec![240.0]);
        assert_eq!(ratios("1\" = 20'-0\""), vec![240.0]);
        assert_eq!(ratios("1\"=10'"), vec![120.0]);
        assert_eq!(ratios("1\" = 100'-0\""), vec![1200.0]);
        assert_eq!(ratios("1 in = 50 ft"), vec![600.0]);
    }

    #[test]
    fn takes_typographic_marks_and_fraction_characters() {
        assert_eq!(ratios("¼″ = 1′-0″"), vec![48.0]);
        assert_eq!(ratios("1/4\u{201d} = 1\u{2019}-0\u{201d}"), vec![48.0]);
        assert_eq!(ratios("1½\" = 1'-0\""), vec![8.0]);
        assert_eq!(ratios("⅛\" = 1'-0\""), vec![96.0]);
        assert_eq!(ratios("1/4'' = 1'-0''"), vec![48.0]);
    }

    #[test]
    fn keeps_the_text_and_the_label() {
        let m = find_scale_matches(&"SCALE: 1/4\" = 1'-0\" NOTES".chars().collect::<Vec<_>>());
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].text, "1/4\" = 1'-0\"");
        assert!(m[0].labelled);
    }

    #[test]
    fn finds_ratios_and_imperial_scales_together_in_order() {
        assert_eq!(ratios("PLAN 1:100   DETAIL 1/4\" = 1'-0\"   SECTION 1:20"), vec![100.0, 48.0, 20.0]);
    }

    #[test]
    fn leaves_lengths_and_other_equations_alone() {
        assert!(ratios("1/4\" DIA. BOLT").is_empty());
        assert!(ratios("WALL 6\" THICK, 12'-0\" LONG").is_empty());
        assert!(ratios("6\" = 150 mm").is_empty());
        assert!(ratios("x = 1'").is_empty());
        assert!(ratios("A1/4\" = 1'-0\"").is_empty()); // part of a word
        assert!(ratios("2'-0\" = 1\"").is_empty()); // real side smaller than paper
    }
}

#[test]
fn ranks_common_imperial_scales_like_standard_ratios() {
    use vellum_lib::scale::{RawCandidate, score};
    let at = |ratio: f64| RawCandidate { ratio, text: String::new(), bbox: [500.0, 500.0, 520.0, 510.0], labelled: false, sheet: None };
    assert_eq!(score(&at(48.0), 1000.0, 1000.0), score(&at(50.0), 1000.0, 1000.0));
    assert!(score(&at(47.0), 1000.0, 1000.0) < score(&at(48.0), 1000.0, 1000.0));
}
