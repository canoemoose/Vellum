//! Band splitting: every byte of a region buffer is written by exactly one band, and no band
//! writes outside the buffer. An off-by-one here corrupts memory rather than drawing a seam.

use vellum_lib::pdfium::{BandPart, HEAVY_PAGE_OBJECTS, PageProfile, bands_for, split_region};

fn light() -> PageProfile {
    PageProfile { one_band: false, objects: 88_244 } // Curtis Hall p48, the densest ordinary sheet
}

fn heavy() -> PageProfile {
    PageProfile { one_band: false, objects: 327_207 } // the aerial drawing
}

#[test]
fn small_region_of_an_ordinary_page_stays_on_one_worker() {
    // Zoomed out with many pages on screen: banding would make every worker parse every page.
    assert_eq!(bands_for(400, 300, light(), 8), 1);
    assert_eq!(bands_for(512, 1024, light(), 8), 1, "exactly 0.5 MP is still small");
}

#[test]
fn large_region_of_an_ordinary_page_is_banded() {
    assert_eq!(bands_for(512, 1025, light(), 8), 8);
    assert_eq!(bands_for(1600, 960, light(), 8), 8);
}

#[test]
fn small_region_of_a_heavy_page_is_banded() {
    // The aerial drawing's fit view, about 56 x 1071 px: one worker took 2.3 s.
    assert_eq!(bands_for(56, 1071, heavy(), 8), 8);
    assert_eq!(bands_for(1600, 960, heavy(), 8), 8);
}

#[test]
fn heavy_threshold_is_inclusive() {
    let at = PageProfile { one_band: false, objects: HEAVY_PAGE_OBJECTS };
    let below = PageProfile { one_band: false, objects: HEAVY_PAGE_OBJECTS - 1 };
    assert_eq!(bands_for(56, 1071, at, 8), 8);
    assert_eq!(bands_for(56, 1071, below, 8), 1);
}

#[test]
fn one_band_pages_stay_on_one_worker_at_any_size() {
    // A swapped or slow-to-decode image, however heavy or large.
    let p = PageProfile { one_band: true, objects: 400_000 };
    assert_eq!(bands_for(56, 1071, p, 8), 1);
    assert_eq!(bands_for(4000, 3000, p, 8), 1);
}

#[test]
fn band_count_is_never_zero() {
    assert_eq!(bands_for(1600, 960, heavy(), 0), 1);
    assert_eq!(bands_for(1600, 960, heavy(), 1), 1);
}

/// Mark every pixel each part covers (by its offset and stride) and check each is covered
/// exactly once, all inside the buffer.
fn check_cover(parts: &[BandPart], w: i32, h: i32) {
    let stride = w as usize * 4;
    let len = stride * h as usize;
    let mut hits = vec![0u8; (w * h) as usize];
    for p in parts {
        assert!(p.w > 0 && p.h > 0, "empty part {p:?}");
        assert_eq!(p.offset, p.ry as usize * stride + p.rx as usize * 4, "offset matches rx/ry");
        // One past the last byte the part writes.
        let end = p.offset + (p.h as usize - 1) * stride + p.w as usize * 4;
        assert!(end <= len, "part {p:?} writes past the buffer ({end} > {len})");
        assert!(p.rx >= 0 && p.ry >= 0 && p.rx + p.w <= w && p.ry + p.h <= h, "part {p:?} outside region");
        for y in p.ry..p.ry + p.h {
            for x in p.rx..p.rx + p.w {
                hits[(y * w + x) as usize] += 1;
            }
        }
    }
    assert!(hits.iter().all(|&c| c == 1), "every pixel covered exactly once");
}

#[test]
fn whole_landscape_page_splits_along_x() {
    let parts = split_region(1000.0, 700.0, 4, 0, 0, 1000, 700);
    assert_eq!(parts.len(), 4);
    assert!(parts.iter().all(|p| p.h == 700 && p.ry == 0));
    assert_eq!(parts.iter().map(|p| p.w).sum::<i32>(), 1000);
    assert_eq!(parts.iter().map(|p| p.band).collect::<Vec<_>>(), vec![0, 1, 2, 3]);
    check_cover(&parts, 1000, 700);
}

#[test]
fn portrait_page_splits_along_y() {
    let parts = split_region(600.0, 900.0, 3, 0, 0, 600, 900);
    assert_eq!(parts.len(), 3);
    assert!(parts.iter().all(|p| p.w == 600 && p.rx == 0));
    assert_eq!(parts[1].ry, 300);
    assert_eq!(parts[1].offset, 300 * 600 * 4);
    check_cover(&parts, 600, 900);
}

#[test]
fn square_page_counts_as_landscape() {
    let parts = split_region(512.0, 512.0, 2, 0, 0, 512, 512);
    assert!(parts.iter().all(|p| p.h == 512));
    check_cover(&parts, 512, 512);
}

#[test]
fn region_inside_one_band_is_one_part() {
    // Bands are 250 px wide; region x 260..500 sits in band 1.
    let parts = split_region(1000.0, 500.0, 4, 260, 10, 240, 100);
    assert_eq!(parts.len(), 1);
    assert_eq!(parts[0].band, 1);
    assert_eq!((parts[0].x, parts[0].y, parts[0].w, parts[0].h), (260, 10, 240, 100));
    assert_eq!(parts[0].offset, 0);
    check_cover(&parts, 240, 100);
}

#[test]
fn region_straddling_a_boundary_splits_there() {
    let parts = split_region(1000.0, 500.0, 4, 200, 0, 100, 50);
    assert_eq!(parts.len(), 2);
    assert_eq!((parts[0].band, parts[0].x, parts[0].w), (0, 200, 50));
    assert_eq!((parts[1].band, parts[1].x, parts[1].w, parts[1].rx), (1, 250, 50, 50));
    assert_eq!(parts[1].offset, 50 * 4);
    check_cover(&parts, 100, 50);
}

#[test]
fn fractional_boundaries_round_consistently() {
    // 1001 / 3: boundaries at 333.67 -> 334 and 667.33 -> 667. Both neighbours use the same
    // rounded value, so there is no gap or overlap.
    for n in 1..=16 {
        for &(w, h) in &[(1001, 300), (7, 3), (4097, 4096), (300, 1001)] {
            let parts = split_region(w as f64, h as f64, n, 0, 0, w, h);
            check_cover(&parts, w, h);
        }
    }
}

#[test]
fn every_subregion_of_an_awkward_page_is_covered_once() {
    // Page 1234.5 x 876.25 device px (fractional, as at most render scales), 7 bands.
    let (pw, ph) = (1234.5, 876.25);
    let dw = (pw as f64).ceil() as i32;
    for x in (0..dw).step_by(97) {
        for w in [1, 13, 176, 512, dw - x] {
            if w <= 0 || x + w > dw {
                continue;
            }
            let parts = split_region(pw, ph, 7, x as i64, 5, w, 40);
            check_cover(&parts, w, 40);
            for p in &parts {
                assert_eq!(p.x, x as i64 + p.rx as i64);
                assert_eq!(p.y, 5);
            }
        }
    }
}

#[test]
fn region_past_the_rounded_page_edge_goes_to_the_last_band() {
    // ceil(999.2) = 1000: the last pixel column lies past page_len but must still render.
    let parts = split_region(999.2, 400.0, 4, 990, 0, 10, 10);
    assert_eq!(parts.len(), 1);
    assert_eq!(parts[0].band, 3);
}

#[test]
fn one_band_and_degenerate_inputs() {
    let parts = split_region(800.0, 600.0, 1, 0, 0, 800, 600);
    assert_eq!(parts.len(), 1);
    assert_eq!((parts[0].w, parts[0].h, parts[0].offset), (800, 600, 0));
    // n = 0 behaves as 1.
    assert_eq!(split_region(800.0, 600.0, 0, 0, 0, 10, 10).len(), 1);
    assert!(split_region(800.0, 600.0, 4, 0, 0, 0, 10).is_empty());
    assert!(split_region(800.0, 600.0, 4, 0, 0, 10, -1).is_empty());
}

#[test]
fn more_bands_than_pixels() {
    let parts = split_region(3.0, 2.0, 16, 0, 0, 3, 2);
    check_cover(&parts, 3, 2);
    assert!(parts.len() <= 3);
}
