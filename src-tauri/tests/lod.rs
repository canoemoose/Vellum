// Image level of detail: thresholds, eligibility and the 1/8 decode.

use image::codecs::jpeg::JpegEncoder;
use image::{ImageBuffer, ImageEncoder, Luma, Rgb};
use vellum_lib::pdfium_lod::*;

fn jpeg_rgb(w: u32, h: u32) -> Vec<u8> {
    let img = ImageBuffer::from_fn(w, h, |x, _| Rgb([if x < w / 2 { 250 } else { 5 }, 100, 50]));
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, 90).write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgb8).unwrap();
    out
}

#[test]
fn threshold_is_where_the_reduced_copy_runs_out_of_pixels() {
    // 1024 px over 100 pt: the 128 px copy covers 1.28 device px per point.
    assert!((image_threshold(1024, 1024, 100.0, 100.0) - 1.28).abs() < 1e-9);
    // The tighter axis decides.
    assert!((image_threshold(1024, 512, 100.0, 100.0) - 0.64).abs() < 1e-9);
    // Rounds the reduced size up like the decoder does.
    assert!((image_threshold(1001, 1001, 126.0, 126.0) - 1.0).abs() < 1e-9);
    // Degenerate bounds never pick LOD by accident on that axis.
    assert!((image_threshold(1024, 1024, 0.0, 100.0) - 1.28).abs() < 1e-9);
}

#[test]
fn only_big_single_filter_jpegs_in_rebuildable_colour_spaces() {
    let dct = vec!["DCTDecode".to_string()];
    assert!(eligible(&dct, 1024, 1024, 2));
    assert!(eligible(&dct, 512, 512, 1));
    assert!(eligible(&dct, 4000, 600, 7));
    assert!(!eligible(&dct, 511, 1024, 2)); // too small
    assert!(!eligible(&dct, 1024, 1024, 3)); // CMYK
    assert!(!eligible(&dct, 1024, 1024, 0)); // unknown
    assert!(!eligible(&["FlateDecode".to_string()], 1024, 1024, 2));
    assert!(!eligible(&["FlateDecode".to_string(), "DCTDecode".to_string()], 1024, 1024, 2));
    assert!(!eligible(&[], 1024, 1024, 2));
}

#[test]
fn page_threshold_needs_enough_pixels_and_takes_the_smallest() {
    assert_eq!(page_threshold(&[]), None);
    assert_eq!(page_threshold(&[(1_000_000, 1.0)]), None);
    let many: Vec<(u64, f64)> = (0..20).map(|i| (1_048_576u64, 1.0 + i as f64 * 0.1)).collect();
    assert_eq!(page_threshold(&many), Some(1.0));
    assert_eq!(page_threshold(&[(10_000_000, 0.5), (10_000_000, 0.3)]), Some(0.3));
}

#[test]
fn decode_small_uses_one_eighth() {
    let j = jpeg_rgb(1024, 768);
    let s = decode_small(&j, 1024, 768).unwrap();
    assert_eq!((s.w, s.h, s.channels), (128, 96, 3));
    assert_eq!(s.samples.len(), 128 * 96 * 3);
    // Left half stays red-ish, right half doesn't.
    assert!(s.samples[(48 * 128 + 10) * 3] > 200);
    assert!(s.samples[(48 * 128 + 118) * 3] < 60);
}

#[test]
fn decode_small_grey_and_odd_sizes() {
    let img = ImageBuffer::from_fn(1001, 517, |_, _| Luma([77u8]));
    let mut j = Vec::new();
    JpegEncoder::new_with_quality(&mut j, 90).write_image(img.as_raw(), 1001, 517, image::ExtendedColorType::L8).unwrap();
    let s = decode_small(&j, 1001, 517).unwrap();
    assert_eq!((s.w, s.h, s.channels), (126, 65, 1));
}

#[test]
fn decode_small_refuses_garbage() {
    assert!(decode_small(b"not a jpeg", 1024, 1024).is_none());
    let mut j = jpeg_rgb(1024, 1024);
    j.truncate(200);
    assert!(decode_small(&j, 1024, 1024).is_none());
}

#[test]
fn to_bgrx_swaps_channels_and_respects_stride() {
    let rgb = [10u8, 20, 30, 40, 50, 60];
    let mut out = vec![0xAA; 2 * 12];
    to_bgrx(&rgb, 3, 1, 2, &mut out, 12);
    assert_eq!(&out[0..4], &[30, 20, 10, 255]);
    assert_eq!(out[4], 0xAA);
    assert_eq!(&out[12..16], &[60, 50, 40, 255]);
    let grey = [7u8];
    let mut out = vec![0; 4];
    to_bgrx(&grey, 1, 1, 1, &mut out, 4);
    assert_eq!(out, [7, 7, 7, 255]);
}
