//! Framing a photo before the knock-out (`import::Adjust`): quarter turns, straightening and
//! cropping land where the preview showed them, and an import honours them.

use image::{ImageEncoder, Rgb, RgbImage};
use vellum_lib::signature::import::{self, Adjust, Crop};

fn white(w: u32, h: u32) -> RgbImage {
    RgbImage::from_pixel(w, h, Rgb([235, 232, 226]))
}

/// A dark disc, as a pen dot.
fn dot(img: &mut RgbImage, cx: f32, cy: f32, r: f32) {
    let (w, h) = img.dimensions();
    for y in 0..h {
        for x in 0..w {
            let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            if d <= r {
                img.put_pixel(x, y, Rgb([30, 30, 35]));
            }
        }
    }
}

/// A stroke: dots along a wavy line from (x0, y) to (x1, y).
fn scribble(img: &mut RgbImage, x0: f32, x1: f32, y: f32, amp: f32, r: f32) {
    let n = ((x1 - x0) / (r * 0.5)).ceil() as usize;
    for i in 0..=n {
        let t = i as f32 / n as f32;
        let x = x0 + (x1 - x0) * t;
        dot(img, x, y + amp * (t * 12.0).sin(), r);
    }
}

/// The centre of the dark pixels.
fn centroid(img: &RgbImage) -> (f32, f32) {
    let (mut sx, mut sy, mut n) = (0f32, 0f32, 0f32);
    for (x, y, p) in img.enumerate_pixels() {
        if p[0] < 128 {
            sx += x as f32 + 0.5;
            sy += y as f32 + 0.5;
            n += 1.0;
        }
    }
    assert!(n > 0.0, "no dark pixels");
    (sx / n, sy / n)
}

fn png(img: &RgbImage) -> Vec<u8> {
    let mut buf = Vec::new();
    image::codecs::png::PngEncoder::new(&mut buf)
        .write_image(img.as_raw(), img.width(), img.height(), image::ExtendedColorType::Rgb8)
        .unwrap();
    buf
}

fn adjust(turns: u8, angle: f64, crop: Option<[f64; 4]>) -> Adjust {
    Adjust { turns, angle, crop: crop.map(|[x, y, w, h]| Crop { x, y, w, h }) }
}

#[test]
fn nothing_to_do_leaves_the_picture_alone() {
    let mut img = white(60, 40);
    dot(&mut img, 10.0, 10.0, 3.0);
    assert_eq!(import::frame(&img, &Adjust::default()), img);
}

#[test]
fn quarter_turns_go_clockwise() {
    let mut img = white(60, 40);
    dot(&mut img, 10.0, 10.0, 3.0); // near the top left
    let one = import::frame(&img, &adjust(1, 0.0, None));
    assert_eq!(one.dimensions(), (40, 60));
    let (x, y) = centroid(&one);
    // Clockwise: the top left goes to the top right.
    assert!((x - 30.0).abs() < 0.6 && (y - 10.0).abs() < 0.6, "({x}, {y})");
    let two = import::frame(&img, &adjust(2, 0.0, None));
    let (x, y) = centroid(&two);
    assert!((x - 50.0).abs() < 0.6 && (y - 30.0).abs() < 0.6, "({x}, {y})");
    // Turns wrap.
    assert_eq!(import::frame(&img, &adjust(5, 0.0, None)), one);
}

#[test]
fn a_crop_keeps_exactly_that_part() {
    let mut img = white(200, 100);
    dot(&mut img, 150.0, 30.0, 4.0);
    // The right half, top 60%.
    let out = import::frame(&img, &adjust(0, 0.0, Some([0.5, 0.0, 0.5, 0.6])));
    assert_eq!(out.dimensions(), (100, 60));
    let (x, y) = centroid(&out);
    assert!((x - 50.0).abs() < 0.6 && (y - 30.0).abs() < 0.6, "({x}, {y})");
    // Out-of-range fractions are clamped to the frame, never panic.
    let out = import::frame(&img, &adjust(0, 0.0, Some([0.9, -0.5, 0.5, 3.0])));
    assert_eq!(out.dimensions(), (20, 100));
    let out = import::frame(&img, &adjust(0, 0.0, Some([1.0, 1.0, -1.0, f64::NAN])));
    assert_eq!(out.dimensions(), (200, 100), "a NaN crop is ignored");
}

#[test]
fn a_crop_applies_after_the_turn() {
    let mut img = white(200, 100);
    dot(&mut img, 150.0, 30.0, 4.0);
    // Turned clockwise the frame is 100 x 200 and the dot is at (70, 150).
    let out = import::frame(&img, &adjust(1, 0.0, Some([0.5, 0.5, 0.5, 0.5])));
    assert_eq!(out.dimensions(), (50, 100));
    let (x, y) = centroid(&out);
    assert!((x - 20.0).abs() < 0.6 && (y - 50.0).abs() < 0.6, "({x}, {y})");
}

#[test]
fn a_turned_box_turns_the_picture_back() {
    let mut img = white(201, 101);
    dot(&mut img, 160.5, 50.5, 5.0); // 60 px right of the centre
    // The whole frame as the box, turned 30 degrees clockwise: what lay along the box's top
    // edge comes out level, so a point right of centre on the photo comes out up and right.
    let out = import::frame(&img, &adjust(0, 30.0, None));
    assert_eq!(out.dimensions(), (201, 101));
    let (x, y) = centroid(&out);
    let (ex, ey) = (100.5 + 60.0 * 30f32.to_radians().cos(), 50.5 - 60.0 * 30f32.to_radians().sin());
    assert!((x - ex).abs() < 0.8 && (y - ey).abs() < 0.8, "({x}, {y}) vs ({ex}, {ey})");
}

#[test]
fn a_box_turned_ninety_degrees_matches_a_quarter_turn_back() {
    // A square, so the frame is the same either way.
    let mut img = white(81, 81);
    scribble(&mut img, 10.0, 60.0, 20.0, 6.0, 3.0);
    dot(&mut img, 65.0, 70.0, 4.0);
    let turned = import::frame(&img, &adjust(3, 0.0, None));
    let boxed = import::frame(&img, &adjust(0, 90.0, None));
    let worst = turned
        .pixels()
        .zip(boxed.pixels())
        .map(|(a, b)| (0..3).map(|c| (a[c] as i32 - b[c] as i32).abs()).max().unwrap())
        .max()
        .unwrap();
    assert!(worst <= 1, "differs by {worst}");
}

#[test]
fn a_box_turned_along_a_slanted_signature_levels_it() {
    // Two dots 160 px apart on a line rising 20 degrees to the right, in a bigger photo, and a
    // box round them turned to lie along that line.
    let mut img = white(400, 300);
    let (cx, cy, phi) = (220.0f32, 140.0f32, -20f32.to_radians());
    dot(&mut img, cx - 80.0 * phi.cos(), cy - 80.0 * phi.sin(), 5.0);
    dot(&mut img, cx + 80.0 * phi.cos(), cy + 80.0 * phi.sin(), 5.0);
    let (bw, bh) = (240.0 / 400.0, 60.0 / 300.0);
    let crop = [cx as f64 / 400.0 - bw / 2.0, cy as f64 / 300.0 - bh / 2.0, bw, bh];
    let out = import::frame(&img, &adjust(0, -20.0, Some(crop)));
    assert_eq!(out.dimensions(), (240, 60));
    let half = |left: bool| {
        let mut part = out.clone();
        for (x, _, p) in part.enumerate_pixels_mut() {
            if (x < 120) != left {
                *p = Rgb([255, 255, 255]);
            }
        }
        centroid(&part)
    };
    let ((lx, ly), (rx, ry)) = (half(true), half(false));
    assert!((ly - 30.0).abs() < 0.8 && (ry - 30.0).abs() < 0.8, "level: {ly} and {ry}");
    assert!((lx - 40.0).abs() < 0.8 && (rx - 200.0).abs() < 0.8, "apart: {lx} and {rx}");
}

#[test]
fn a_turned_box_over_the_edge_is_paper_there() {
    // The whole frame turned 45 degrees: the corners lie beyond the photo, and repeat its edge.
    let img = white(120, 80);
    let out = import::frame(&img, &adjust(0, 45.0, None));
    assert_eq!(out.dimensions(), (120, 80));
    assert!(out.pixels().all(|p| *p == Rgb([235, 232, 226])));
    // Silly sizes are capped, never panic.
    let out = import::frame(&img, &adjust(0, 10.0, Some([-5.0, 0.2, 40.0, 0.1])));
    assert_eq!(out.dimensions(), (240, 8));
}

#[test]
fn an_import_keeps_only_the_cropped_signature() {
    // Two signatures side by side; crop to the left one.
    let mut img = white(1200, 400);
    scribble(&mut img, 80.0, 480.0, 200.0, 40.0, 4.0);
    scribble(&mut img, 700.0, 1120.0, 200.0, 40.0, 4.0);
    let bytes = png(&img);
    let both = import::import_bytes(&bytes).unwrap();
    let left = import::import_bytes_adjusted(&bytes, &adjust(0, 0.0, Some([0.0, 0.0, 0.5, 1.0]))).unwrap();
    assert!(both.width > 1000, "both signatures: {} wide", both.width);
    assert!(left.width > 400 && left.width < 460, "the left one: {} wide", left.width);
    // A quarter turn first: the signature comes out upright-turned (tall, not wide).
    let turned = import::import_bytes_adjusted(&bytes, &adjust(1, 0.0, Some([0.0, 0.0, 1.0, 0.5]))).unwrap();
    assert!(turned.height > 400 && turned.height < 460 && turned.width < 150, "{} x {}", turned.width, turned.height);
}

#[test]
fn cropping_first_keeps_a_small_signature_sharp() {
    // A big photo (over the working size) with a small signature in one corner.
    let mut img = white(4000, 3000);
    scribble(&mut img, 300.0, 900.0, 400.0, 50.0, 5.0);
    let bytes = png(&img);
    let whole = import::import_bytes(&bytes).unwrap();
    assert!(whole.work_scale < 0.8, "the whole photo is shrunk ({})", whole.work_scale);
    let cropped = import::import_bytes_adjusted(&bytes, &adjust(0, 0.0, Some([0.0, 0.0, 0.3, 0.3]))).unwrap();
    assert_eq!(cropped.work_scale, 1.0, "the crop isn't");
    assert!(cropped.width as f64 > whole.width as f64 * 1.2, "{} vs {}", cropped.width, whole.width);
}

#[test]
fn the_preview_is_upright_and_capped() {
    let img = white(3000, 1000);
    let (jpeg, w, h) = import::preview_bytes(&png(&img)).unwrap();
    assert_eq!((w, h), (3000, 1000));
    let back = image::load_from_memory(&jpeg).unwrap();
    assert_eq!((back.width(), back.height()), (import::PREVIEW_SIDE, 683));
    let small = white(300, 100);
    let (jpeg, _, _) = import::preview_bytes(&png(&small)).unwrap();
    let back = image::load_from_memory(&jpeg).unwrap();
    assert_eq!((back.width(), back.height()), (300, 100));
}

#[test]
fn a_tight_crop_round_a_wavy_signature_keeps_it() {
    // A short picture, as a crop round a signature is: the stroke is large against the short
    // side, and must not be taken for a blob.
    let mut img = white(1200, 400);
    scribble(&mut img, 80.0, 1120.0, 200.0, 40.0, 4.0);
    let out = import::import_bytes(&png(&img)).unwrap();
    assert!(out.width > 1050, "{} wide", out.width);
    // A thick marker cropped tighter still: kept, as there's nothing else.
    let mut img = white(700, 160);
    scribble(&mut img, 40.0, 660.0, 80.0, 30.0, 12.0);
    let out = import::import_bytes(&png(&img)).unwrap();
    assert!(out.width > 620, "{} wide", out.width);
}
