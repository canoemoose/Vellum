//! The pure print geometry: matrices, crops, bands, paper matching, colour modes.

use vellum_lib::print::job::*;

fn near(a: (f64, f64), b: (f64, f64)) -> bool {
    (a.0 - b.0).abs() < 1e-9 && (a.1 - b.1).abs() < 1e-9
}

#[test]
fn item_matrix_places_corners() {
    // A 200 x 100 form (y up) at scale 2, top-left at (10, 20) on a 300-tall sheet.
    let m = item_matrix(200.0, 100.0, 2.0, 0, 10.0, 20.0, 300.0);
    // Form top-left (0, 100) -> sheet (10, 20) y down -> PDF (10, 280).
    assert!(near(apply(&m, 0.0, 100.0), (10.0, 280.0)));
    // Form bottom-right (200, 0) -> sheet (410, 220) -> PDF (410, 80).
    assert!(near(apply(&m, 200.0, 0.0), (410.0, 80.0)));
}

#[test]
fn item_matrix_rotations_keep_the_box_at_its_top_left() {
    for rot in [0, 90, 180, 270] {
        let m = item_matrix(200.0, 100.0, 1.0, rot, 5.0, 7.0, 1000.0);
        let corners = [(0.0, 0.0), (200.0, 0.0), (0.0, 100.0), (200.0, 100.0)];
        let pts: Vec<_> = corners.iter().map(|&(x, y)| apply(&m, x, y)).collect();
        let minx = pts.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
        let maxy = pts.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
        let maxx = pts.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max);
        let miny = pts.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
        let (w, h) = rotated_size(200.0, 100.0, rot);
        assert!((minx - 5.0).abs() < 1e-9 && (1000.0 - maxy - 7.0).abs() < 1e-9, "rot {rot}");
        assert!((maxx - minx - w).abs() < 1e-9 && (maxy - miny - h).abs() < 1e-9, "rot {rot}");
    }
    // 90 clockwise: the form's top-left (0, 100) ends at the box's top-right.
    let m = item_matrix(200.0, 100.0, 1.0, 90, 0.0, 0.0, 1000.0);
    assert!(near(apply(&m, 0.0, 100.0), (100.0, 1000.0)));
}

#[test]
fn quarter_rounds_to_quarter_turns() {
    assert_eq!(quarter(0), 0);
    assert_eq!(quarter(90), 90);
    assert_eq!(quarter(360), 0);
    assert_eq!(quarter(450), 90);
    assert_eq!(quarter(89), 90);
    assert_eq!(rotated_size(3.0, 4.0, 270), (4.0, 3.0));
    assert_eq!(rotated_size(3.0, 4.0, 180), (3.0, 4.0));
}

#[test]
fn page_matrix_maps_the_crop_box_onto_the_displayed_page() {
    let bbox = (10.0, 20.0, 210.0, 120.0); // 200 x 100, offset origin
    for rot in 0..4 {
        let m = page_matrix(bbox, rot);
        let (dw, dh) = display_size(bbox, rot);
        let pts = [apply(&m, 10.0, 20.0), apply(&m, 210.0, 20.0), apply(&m, 10.0, 120.0), apply(&m, 210.0, 120.0)];
        for p in pts {
            assert!(p.0 > -1e-9 && p.0 < dw + 1e-9 && p.1 > -1e-9 && p.1 < dh + 1e-9, "rot {rot}: {p:?}");
        }
    }
    // Rotate 90 cw: user top-left goes to the displayed top-right.
    let m = page_matrix(bbox, 1);
    assert!(near(apply(&m, 10.0, 120.0), (100.0, 200.0)));
}

#[test]
fn crop_to_user_inverts_the_display() {
    let bbox = (0.0, 0.0, 200.0, 100.0);
    // Unrotated: displayed y-down 20..60 is user y 40..80.
    assert_eq!(crop_to_user(bbox, 0, &Rect::new(40.0, 20.0, 100.0, 60.0)), Some((40.0, 40.0, 100.0, 80.0)));
    // Clamped to the page.
    assert_eq!(crop_to_user(bbox, 0, &Rect::new(-10.0, -10.0, 300.0, 50.0)), Some((0.0, 50.0, 200.0, 100.0)));
    // Entirely off the page.
    assert_eq!(crop_to_user(bbox, 0, &Rect::new(300.0, 0.0, 400.0, 50.0)), None);
    // Rotate 90: displayed is 100 x 200; its top half (y-down 0..100) is user x 0..100.
    assert_eq!(crop_to_user(bbox, 1, &Rect::new(0.0, 0.0, 100.0, 100.0)), Some((0.0, 0.0, 100.0, 100.0)));
    // Rotate 180: displayed top-left 50 x 50 is user's bottom-right.
    assert_eq!(crop_to_user(bbox, 2, &Rect::new(0.0, 0.0, 50.0, 50.0)), Some((150.0, 0.0, 200.0, 50.0)));
    // Rotate 270: displayed top half is user x 100..200.
    assert_eq!(crop_to_user(bbox, 3, &Rect::new(0.0, 0.0, 100.0, 100.0)), Some((100.0, 0.0, 200.0, 100.0)));
    // Offset media box.
    assert_eq!(crop_to_user((10.0, 20.0, 210.0, 120.0), 0, &Rect::new(0.0, 0.0, 10.0, 10.0)), Some((10.0, 110.0, 20.0, 120.0)));
}

#[test]
fn invert_round_trips() {
    let m = [0.0, -2.0, 3.0, 0.0, 5.0, 7.0];
    let i = invert(&m).unwrap();
    let (x, y) = apply(&m, 11.0, 13.0);
    assert!(near(apply(&i, x, y), (11.0, 13.0)));
    assert!(invert(&[1.0, 2.0, 2.0, 4.0, 0.0, 0.0]).is_none());
}

#[test]
fn item_bounds_follow_crop_rotation_and_scale() {
    let it = Item {
        doc_id: 1,
        page: 0,
        path: None,
        src_w: 200.0,
        src_h: 100.0,
        crop: Some(Rect::new(0.0, 0.0, 50.0, 20.0)),
        x: 5.0,
        y: 6.0,
        scale: 2.0,
        rotation: 90,
    };
    assert_eq!(item_bounds(&it), Rect::new(5.0, 6.0, 45.0, 106.0));
    assert_eq!(sheet_rect_to_pdf(&Rect::new(5.0, 6.0, 45.0, 106.0), 200.0), (5.0, 94.0, 45.0, 194.0));
}

#[test]
fn bands_cover_exactly() {
    assert_eq!(bands(0, 1000, 512), vec![(0, 512), (512, 488)]);
    assert_eq!(bands(10, 11, 512), vec![(10, 1)]);
    assert_eq!(bands(5, 5, 512), vec![]);
    let b = bands(3, 2049, 100);
    assert_eq!(b.first().unwrap().0, 3);
    assert_eq!(b.iter().map(|x| x.1).sum::<i32>(), 2046);
    for w in b.windows(2) {
        assert_eq!(w[0].0 + w[0].1, w[1].0);
    }
}

#[test]
fn sheet_pixels_round() {
    // A3 at 600 dpi: 841.89 x 1190.55 pt -> 7016 x 9921 px.
    assert_eq!(sheet_pixels(841.89, 1190.55, 600.0), (7016, 9921));
    assert_eq!(sheet_pixels(72.0, 72.0, 300.0), (300, 300));
}

#[test]
fn matches_paper_either_way_round() {
    let papers = vec![
        Paper { id: 9, name: "A4".into(), w: 210.0, h: 297.0 },
        Paper { id: 8, name: "A3".into(), w: 297.0, h: 420.0 },
        Paper { id: 1, name: "Letter".into(), w: 215.9, h: 279.4 },
    ];
    assert_eq!(match_paper(&papers, 210.0, 297.0), Some((9, false)));
    assert_eq!(match_paper(&papers, 420.0, 297.0), Some((8, true)));
    assert_eq!(match_paper(&papers, 296.0, 421.5), Some((8, false)));
    assert_eq!(match_paper(&papers, 279.4, 215.9), Some((1, true)));
    assert_eq!(match_paper(&papers, 594.0, 841.0), None);
}

#[test]
fn validates_jobs() {
    let ok = Job { sheets: vec![Sheet { w: 100.0, h: 100.0, items: vec![], clip: None, lines: vec![], texts: vec![] }] };
    assert!(validate(&ok).is_ok());
    assert!(validate(&Job { sheets: vec![] }).is_err());
    let mut bad = ok.clone();
    bad.sheets[0].w = 0.0;
    assert!(validate(&bad).is_err());
    let mut bad = ok.clone();
    bad.sheets[0].items.push(Item { doc_id: 1, page: 0, path: None, src_w: 10.0, src_h: 10.0, crop: None, x: 0.0, y: 0.0, scale: 0.0, rotation: 0 });
    assert!(validate(&bad).is_err());
}

const BL: BlackLines = BlackLines { sensitivity: BLACK_LINES_SENSITIVITY, radius: 3, invert: false };

#[test]
fn colour_modes() {
    let px = vec![
        255, 255, 255, 0, // white
        250, 250, 250, 0, // near white
        200, 220, 255, 0, // pale colour
        0, 0, 255, 0,     // red (BGR order)
    ];
    let mut g = px.clone();
    apply_colour(&mut g, 4, ColourMode::Greyscale, &BL);
    assert_eq!(&g[0..4], &[255, 255, 255, 0]);
    // Red: 0.299 * 255 = 76.
    assert_eq!(&g[12..16], &[76, 76, 76, 0]);
    let mut c = px.clone();
    apply_colour(&mut c, 4, ColourMode::Colour, &BL);
    assert_eq!(c, px);
}

/// A `w` x `h` grey picture (B = G = R) from a function of x, y.
fn picture(w: usize, h: usize, f: impl Fn(usize, usize) -> u8) -> Vec<u8> {
    let mut px = Vec::with_capacity(w * h * 4);
    for y in 0..h {
        for x in 0..w {
            let v = f(x, y);
            px.extend_from_slice(&[v, v, v, 0]);
        }
    }
    px
}

fn is_black(px: &[u8], w: usize, x: usize, y: usize) -> bool {
    px[(y * w + x) * 4] == 0
}

#[test]
fn black_lines_drops_paper_texture_and_keeps_lines() {
    // Grainy, unevenly toned paper (darker to the right) with a faint line down column 20.
    let (w, h) = (40, 20);
    let mut px = picture(w, h, |x, y| {
        let paper = 220 - (x as i32 * 2) + if (x + y) % 3 == 0 { 6 } else { 0 };
        if x == 20 { (paper - 50) as u8 } else { paper as u8 }
    });
    black_lines(&mut px, w, &BL);
    for y in 0..h {
        assert!(is_black(&px, w, 20, y), "the faint line is kept at row {y}");
        for x in [2, 10, 30, 38] {
            assert!(!is_black(&px, w, x, y), "paper at {x},{y} goes white");
        }
    }
}

#[test]
fn black_lines_sensitivity_decides_how_faint_a_line_counts() {
    let (w, h) = (30, 10);
    let make = || picture(w, h, |x, _| if x == 15 { 190 } else { 230 }); // ~17% darker than the paper
    let mut strict = make();
    black_lines(&mut strict, w, &BlackLines { sensitivity: 0, ..BL });
    assert!(!is_black(&strict, w, 15, 5));
    let mut keen = make();
    black_lines(&mut keen, w, &BlackLines { sensitivity: 100, ..BL });
    assert!(is_black(&keen, w, 15, 5));
}

#[test]
fn black_lines_margin_runs_from_nothing_to_faint() {
    assert_eq!(black_lines_margin(0), 100);
    assert_eq!(black_lines_margin(60), 20);
    assert_eq!(black_lines_margin(100), 5);
    // At the far end nothing prints, solid black included.
    let (w, h) = (30, 30);
    let mut px = picture(w, h, |x, y| if x == 15 { 0 } else if y > 20 { 5 } else { 255 });
    black_lines(&mut px, w, &BlackLines { sensitivity: 0, ..BL });
    assert!(px.chunks_exact(4).all(|p| p[0] == 255));
}

#[test]
fn black_lines_keeps_solid_black_and_drops_pale_fills() {
    let (w, h) = (40, 40);
    // A pale grey fill on the left, a solid black block on the right, white elsewhere.
    let mut px = picture(w, h, |x, y| if (5..18).contains(&x) && (5..35).contains(&y) { 215 } else if x >= 25 && (5..35).contains(&y) { 10 } else { 255 });
    black_lines(&mut px, w, &BL);
    assert!(!is_black(&px, w, 11, 20), "the middle of a pale fill goes white");
    assert!(is_black(&px, w, 32, 20), "the middle of a solid black block stays black");
}

#[test]
fn black_lines_works_page_by_page() {
    // Grey scanned paper (150) from x 10 to 29 on a white sheet: judged on its own, its edges
    // stay paper; judged with the white margin, they'd turn black.
    let (w, h) = (40, 20);
    let px0 = picture(w, h, |x, _| if (10..30).contains(&x) { 150 } else { 255 });
    let mut whole = px0.clone();
    black_lines(&mut whole, w, &BL);
    assert!(is_black(&whole, w, 10, 10), "whole-sheet: the page edge goes black");
    let mut paged = px0.clone();
    black_lines_in(&mut paged, w, (10, 0, 30, h), &BL);
    assert!((10..30).all(|x| !is_black(&paged, w, x, 10)), "page by page: the paper stays white");
    assert!(!is_dark_region(&px0, w, (10, 0, 30, h)));
}

#[test]
fn black_lines_reads_a_blueprint_inverted() {
    // Dark blue paper (B high, R low) with a white line.
    let (w, h) = (30, 10);
    let mut px = Vec::new();
    for _y in 0..h {
        for x in 0..w {
            px.extend_from_slice(if x == 12 { &[250, 250, 250, 0] } else { &[160, 70, 30, 0] });
        }
    }
    assert!(is_dark_sheet(&px));
    black_lines(&mut px, w, &BlackLines { invert: true, ..BL });
    assert!(is_black(&px, w, 12, 5));
    assert!(!is_black(&px, w, 3, 5));
    assert!(!is_dark_sheet(&picture(10, 10, |x, _| if x < 2 { 0 } else { 240 })));
}
