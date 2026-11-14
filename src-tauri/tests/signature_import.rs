//! Signature import from a photo or scan: synthesised "phone photos" (grey gradient paper with a
//! warm cast, sensor noise, the soft shadow of a phone, dust specks, a dark desk at one edge)
//! with a known stroke drawn on them, checked numerically.

use image::{ImageEncoder, Rgb, RgbImage, Rgba, RgbaImage};
use vellum_lib::signature::import::{self, Imported, MAX_OUTPUT_SIDE};

/// Deterministic noise (xorshift), roughly Gaussian by summing four uniforms.
struct Noise(u64);
impl Noise {
    fn next(&mut self) -> f32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        (x >> 40) as f32 / (1u64 << 24) as f32
    }
    fn gauss(&mut self) -> f32 {
        (self.next() + self.next() + self.next() + self.next() - 2.0) * 1.732
    }
}

/// The signature's centre line: a wavy stroke across the middle, and a dot above it (a
/// single pen touch, which must survive the speck filter).
fn stroke_points(w: u32, h: u32) -> Vec<(f32, f32)> {
    let (x0, x1) = (w as f32 * 0.18, w as f32 * 0.82);
    let yc = h as f32 * 0.5;
    let amp = h as f32 * 0.18;
    (0..=2000)
        .map(|i| {
            let t = i as f32 / 2000.0;
            let x = x0 + (x1 - x0) * t;
            let y = yc + amp * (t * std::f32::consts::PI * 5.0).sin() * (0.6 + 0.4 * t);
            (x, y)
        })
        .chain(std::iter::once((w as f32 * 0.5, h as f32 * 0.2))) // the dot of an i
        .collect()
}

struct Photo {
    img: RgbImage,
    /// Distance from each pixel to the stroke's centre line.
    dist: Vec<f32>,
    pts: Vec<(f32, f32)>,
    radius: f32,
}

struct Opts {
    w: u32,
    h: u32,
    ink: [f32; 3],
    shadow: bool,
    desk: bool,
    specks: bool,
    stroke: bool,
    noise: f32,
}

impl Default for Opts {
    fn default() -> Self {
        Opts { w: 1200, h: 800, ink: [0.12, 0.12, 0.13], shadow: true, desk: false, specks: true, stroke: true, noise: 4.0 }
    }
}

fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// A phone photo of a signature: light (gradient, shadow) times reflectance (paper or ink).
fn photo(o: &Opts) -> Photo {
    let (w, h) = (o.w, o.h);
    let pts = stroke_points(w, h);
    let radius = (w as f32 / 400.0).max(2.0); // a 5-6 px pen at 1200 wide
    let mut dist = vec![f32::MAX; (w * h) as usize];
    if o.stroke {
        let r = radius.ceil() as i32 + 3;
        for &(px, py) in &pts {
            for dy in -r..=r {
                for dx in -r..=r {
                    let (x, y) = (px.round() as i32 + dx, py.round() as i32 + dy);
                    if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
                        continue;
                    }
                    let d = ((x as f32 - px).powi(2) + (y as f32 - py).powi(2)).sqrt();
                    let i = (y as u32 * w + x as u32) as usize;
                    dist[i] = dist[i].min(d);
                }
            }
        }
    }
    let mut noise = Noise(0x9e3779b97f4a7c15);
    let mut img = RgbImage::new(w, h);
    let specks = [(0.1f32, 0.1f32), (0.9, 0.15), (0.5, 0.92), (0.95, 0.9)];
    for y in 0..h {
        for x in 0..w {
            let fx = x as f32 / w as f32;
            let fy = y as f32 / h as f32;
            // Light: a gradient across the sheet (bright top left, dimmer bottom right).
            let mut light = 0.95 - 0.25 * (0.6 * fx + 0.4 * fy);
            // The phone's shadow: a soft-edged darker region over the lower right third,
            // which the stroke runs through.
            if o.shadow {
                let s = smoothstep(0.45, 0.62, fx + 0.5 * fy - 0.25);
                light *= 1.0 - 0.45 * s;
            }
            // Paper with a warm white-balance cast.
            let mut refl = [0.92f32, 0.89, 0.80];
            let i = (y * w + x) as usize;
            let cover = (radius + 0.5 - dist[i]).clamp(0.0, 1.0); // anti-aliased pen edge
            for c in 0..3 {
                let ink = o.ink[c] * [1.0, 0.97, 0.87][c]; // the same cast on the ink
                refl[c] = refl[c] * (1.0 - cover) + ink * cover;
            }
            if o.specks {
                for &(sx, sy) in &specks {
                    let (cx, cy) = (sx * w as f32, sy * h as f32);
                    if (x as f32 - cx).abs() < 1.5 && (y as f32 - cy).abs() < 1.5 {
                        refl = [0.3, 0.3, 0.3];
                    }
                }
            }
            if o.desk && x < w / 14 {
                refl = [0.18, 0.12, 0.08]; // a wooden desk at the left edge
            }
            let mut px = [0u8; 3];
            for c in 0..3 {
                px[c] = (light * refl[c] * 255.0 + o.noise * noise.gauss()).round().clamp(0.0, 255.0) as u8;
            }
            img.put_pixel(x, y, Rgb(px));
        }
    }
    Photo { img, dist, pts, radius }
}

fn decode(r: &Imported) -> RgbaImage {
    image::load_from_memory(&r.png).expect("result is an image").to_rgba8()
}

/// The result pixel's alpha at a working-image point.
fn alpha_at(out: &RgbaImage, r: &Imported, x: f32, y: f32) -> u8 {
    let ox = ((x - r.origin.0 as f32) * r.scale as f32).round();
    let oy = ((y - r.origin.1 as f32) * r.scale as f32).round();
    if ox < 0.0 || oy < 0.0 || ox >= out.width() as f32 || oy >= out.height() as f32 {
        return 0;
    }
    out.get_pixel(ox as u32, oy as u32)[3]
}

/// Paper transparent, ink kept and bounds right for a photo.
fn check_photo(p: &Photo, r: &Imported) {
    let out = decode(r);
    assert_eq!((out.width(), out.height()), (r.width, r.height));

    // Ink kept: the centre line is fully opaque all the way along, in the shadow too.
    let mut weak = 0;
    for &(x, y) in &p.pts {
        if alpha_at(&out, r, x, y) < 230 {
            weak += 1;
        }
    }
    assert!(weak * 200 < p.pts.len(), "{weak} of {} centre-line samples not opaque", p.pts.len());
    let &(dx, dy) = p.pts.last().unwrap();
    assert!(alpha_at(&out, r, dx, dy) >= 230, "the dot of the i is kept");

    // Paper transparent: nothing visible more than 3 px outside the pen's edge.
    let (w, h) = (p.img.width(), p.img.height());
    let mut stray = 0;
    let mut paper = 0;
    for oy in 0..out.height() {
        for ox in 0..out.width() {
            let x = (ox as f32 / r.scale as f32 + r.origin.0 as f32).round() as i64;
            let y = (oy as f32 / r.scale as f32 + r.origin.1 as f32).round() as i64;
            if x < 0 || y < 0 || x >= w as i64 || y >= h as i64 {
                assert_eq!(out.get_pixel(ox, oy)[3], 0, "margin outside the photo is transparent");
                continue;
            }
            if p.dist[(y as u32 * w + x as u32) as usize] > p.radius + 3.0 {
                paper += 1;
                if out.get_pixel(ox, oy)[3] > 8 {
                    stray += 1;
                }
            }
        }
    }
    assert!(paper > 1000);
    assert!(stray * 2000 < paper, "{stray} of {paper} paper pixels visible");

    // Bounds: the stroke's extent plus the margin (3% of the larger side, at least 4 px).
    let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for &(x, y) in &p.pts {
        x0 = x0.min(x - p.radius);
        y0 = y0.min(y - p.radius);
        x1 = x1.max(x + p.radius);
        y1 = y1.max(y + p.radius);
    }
    let margin = ((x1 - x0).max(y1 - y0) * 0.03).round().max(4.0);
    let tol = 4.0;
    assert!((r.origin.0 as f32 - (x0 - margin)).abs() <= tol, "left {} vs {}", r.origin.0, x0 - margin);
    assert!((r.origin.1 as f32 - (y0 - margin)).abs() <= tol, "top {} vs {}", r.origin.1, y0 - margin);
    let ew = (x1 - x0 + 2.0 * margin) * r.scale as f32;
    let eh = (y1 - y0 + 2.0 * margin) * r.scale as f32;
    assert!((r.width as f32 - ew).abs() <= tol * 2.0, "width {} vs {ew}", r.width);
    assert!((r.height as f32 - eh).abs() <= tol * 2.0, "height {} vs {eh}", r.height);
}

fn to_png(img: &RgbImage) -> Vec<u8> {
    let mut buf = Vec::new();
    image::codecs::png::PngEncoder::new(&mut buf)
        .write_image(img.as_raw(), img.width(), img.height(), image::ExtendedColorType::Rgb8)
        .unwrap();
    buf
}

fn to_jpeg(img: &RgbImage) -> Vec<u8> {
    let mut buf = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 90).encode_image(img).unwrap();
    buf
}

#[test]
fn a_black_signature_in_uneven_light_comes_out_clean() {
    let p = photo(&Opts::default());
    let r = import::import_bytes(&to_png(&p.img)).expect("imports");
    check_photo(&p, &r);
    // Neutral ink comes out near-black.
    assert!(r.ink.iter().all(|&c| c < 40), "ink {:?}", r.ink);
    // Every pixel is the ink colour; only alpha varies.
    let out = decode(&r);
    assert!(out.pixels().all(|p| p[0] == r.ink[0] && p[1] == r.ink[1] && p[2] == r.ink[2]));
}

#[test]
fn a_blue_biro_stays_blue() {
    let p = photo(&Opts { ink: [0.18, 0.24, 0.62], ..Opts::default() });
    let r = import::import_bytes(&to_png(&p.img)).expect("imports");
    check_photo(&p, &r);
    let [cr, cg, cb] = r.ink.map(|c| c as i32);
    assert!(cb > cr + 40 && cb > cg + 30, "ink {:?} should be blue", r.ink);
    // The ink as it is, on white paper: ink over paper per channel (the cast cancels).
    assert_original(&r, [0.18, 0.24, 0.62]);
}

/// The result's ink is the photographed ink against white paper, not darkened or changed.
fn assert_original(r: &Imported, ink: [f32; 3]) {
    for c in 0..3 {
        // The photo's paper is [0.92, 0.89, 0.80] with the ink cast [1, 0.97, 0.87] on the ink.
        let want = ink[c] * [1.0f32, 0.97, 0.87][c] / [0.92f32, 0.89, 0.80][c] * 255.0;
        assert!((r.ink[c] as f32 - want).abs() <= 14.0, "ink {:?}, channel {c} should be about {want}", r.ink);
    }
}

#[test]
fn faded_blue_ink_is_kept_whole_and_stays_faded() {
    // A washed-out blue (a fountain pen or an old biro): nearly as bright as the paper, but it
    // takes out most of the red.
    let ink = [0.62, 0.72, 0.92];
    // No dust: specks darker than so faint an ink look as big as its dot, and are kept with
    // it (cropped out in the framing). The black and blue cases check dust is dropped.
    let p = photo(&Opts { ink, specks: false, ..Opts::default() });
    let r = import::import_bytes(&to_jpeg(&p.img)).expect("imports");
    check_photo(&p, &r);
    assert_original(&r, ink);
}

#[test]
fn a_jpeg_photo_with_a_desk_at_the_edge() {
    let p = photo(&Opts { desk: true, ..Opts::default() });
    let r = import::import_bytes(&to_jpeg(&p.img)).expect("imports");
    // The desk (a thick dark band at the left edge) isn't taken for ink, so the bounds are
    // still the stroke's.
    check_photo(&p, &r);
}

#[test]
fn a_clean_scan_without_shadow_or_noise() {
    let p = photo(&Opts { shadow: false, specks: false, noise: 0.0, ..Opts::default() });
    let r = import::import_bytes(&to_png(&p.img)).expect("imports");
    check_photo(&p, &r);
}

#[test]
fn blank_paper_is_no_ink() {
    let p = photo(&Opts { stroke: false, ..Opts::default() });
    let e = import::import_bytes(&to_png(&p.img)).unwrap_err();
    assert!(e.starts_with("[signature_no_ink]"), "{e}");
    // Nor is a desk at the edge taken for a signature when there's nothing else.
    let p = photo(&Opts { stroke: false, desk: true, ..Opts::default() });
    let e = import::import_bytes(&to_png(&p.img)).unwrap_err();
    assert!(e.starts_with("[signature_no_ink]"), "{e}");
}

#[test]
fn not_an_image_is_not_supported() {
    let e = import::import_bytes(b"%PDF-1.7 definitely not an image").unwrap_err();
    assert!(e.starts_with("[not_supported]"), "{e}");
    let e = import::import_file("C:\\no\\such\\signature.jpg").unwrap_err();
    assert!(e.starts_with("[not_found]"), "{e}");
}

#[test]
fn a_tiny_image_is_refused() {
    let img = RgbImage::from_pixel(10, 10, Rgb([200, 200, 200]));
    let e = import::import_bytes(&to_png(&img)).unwrap_err();
    assert!(e.starts_with("[signature_too_small]"), "{e}");
}

#[test]
fn a_large_photo_is_capped() {
    let p = photo(&Opts { w: 3600, h: 2400, ..Opts::default() });
    let r = import::import_bytes(&to_jpeg(&p.img)).expect("imports");
    assert!(r.width.max(r.height) <= MAX_OUTPUT_SIDE, "{} x {}", r.width, r.height);
    assert!(r.work_scale < 1.0);
    assert!(r.width.max(r.height) >= MAX_OUTPUT_SIDE - 1);
}

/// Insert an EXIF APP1 segment with just an Orientation tag after a JPEG's SOI marker.
fn with_orientation(jpeg: &[u8], orientation: u16) -> Vec<u8> {
    let mut tiff = Vec::new();
    tiff.extend_from_slice(b"II*\0");
    tiff.extend_from_slice(&8u32.to_le_bytes()); // first IFD
    tiff.extend_from_slice(&1u16.to_le_bytes()); // one entry
    tiff.extend_from_slice(&0x0112u16.to_le_bytes()); // Orientation
    tiff.extend_from_slice(&3u16.to_le_bytes()); // SHORT
    tiff.extend_from_slice(&1u32.to_le_bytes()); // count
    tiff.extend_from_slice(&orientation.to_le_bytes());
    tiff.extend_from_slice(&[0, 0]);
    tiff.extend_from_slice(&0u32.to_le_bytes()); // no next IFD
    let mut app1 = b"Exif\0\0".to_vec();
    app1.extend_from_slice(&tiff);
    let mut out = jpeg[..2].to_vec();
    out.extend_from_slice(&[0xFF, 0xE1]);
    out.extend_from_slice(&((app1.len() + 2) as u16).to_be_bytes());
    out.extend_from_slice(&app1);
    out.extend_from_slice(&jpeg[2..]);
    out
}

#[test]
fn exif_rotation_is_applied() {
    // A landscape-stored photo tagged "rotate 90 clockwise" (orientation 6) is portrait.
    let mut img = RgbImage::from_pixel(120, 60, Rgb([230, 230, 230]));
    // A dark mark at the stored top-left corner.
    for y in 0..10 {
        for x in 0..10 {
            img.put_pixel(x, y, Rgb([0, 0, 0]));
        }
    }
    let tagged = with_orientation(&to_jpeg(&img), 6);
    let up = import::load_oriented(&tagged).unwrap();
    assert_eq!((up.width(), up.height()), (60, 120));
    // Rotating 90 clockwise takes the top-left corner to the top-right.
    let px = up.to_rgb8();
    assert!(px.get_pixel(55, 4)[0] < 60, "mark at top right");
    assert!(px.get_pixel(4, 4)[0] > 180, "top left is paper");

    // Untagged stays as stored.
    let plain = import::load_oriented(&to_jpeg(&img)).unwrap();
    assert_eq!((plain.width(), plain.height()), (120, 60));

    // And the whole import honours it: a sideways photo of a signature comes out wide.
    let p = photo(&Opts { w: 600, h: 400, ..Opts::default() });
    let rotated = image::imageops::rotate270(&p.img); // stored sideways (portrait)...
    let tagged = with_orientation(&to_jpeg(&rotated), 6); // ...tagged to be turned back
    let r = import::import_bytes(&tagged).expect("imports");
    assert!(r.width > r.height, "{} x {}", r.width, r.height);
}

#[test]
fn a_png_with_transparency_is_treated_as_on_white() {
    // A signature that's already a cut-out: its transparent pixels store black, which would
    // read as solid ink if the alpha were dropped.
    let mut img = RgbaImage::from_pixel(400, 200, Rgba([0, 0, 0, 0]));
    for x in 60..340 {
        for dy in 0..5 {
            img.put_pixel(x, 100 + dy, Rgba([10, 10, 10, 255]));
        }
    }
    let mut buf = Vec::new();
    image::codecs::png::PngEncoder::new(&mut buf)
        .write_image(img.as_raw(), 400, 200, image::ExtendedColorType::Rgba8)
        .unwrap();
    let r = import::import_bytes(&buf).expect("imports");
    assert!(r.width > 280 && r.width < 330, "{}", r.width);
    assert!(r.height < 40, "{}", r.height);
}

#[test]
#[ignore]
fn dump_for_eyes() {
    let dir = std::env::var("SIG_DUMP").unwrap();
    for (name, o) in [("black", Opts::default()), ("blue", Opts { ink: [0.18, 0.24, 0.62], desk: true, ..Opts::default() })] {
        let p = photo(&o);
        p.img.save(format!("{dir}/{name}-photo.png")).unwrap();
        let r = import::import_bytes(&to_png(&p.img)).unwrap();
        // Composite on magenta so strays show.
        let out = decode(&r);
        let mut c = RgbImage::from_pixel(out.width(), out.height(), Rgb([255, 0, 255]));
        for (x, y, px) in out.enumerate_pixels() {
            let a = px[3] as f32 / 255.0;
            let m = [255.0, 0.0, 255.0];
            c.put_pixel(x, y, Rgb([0, 1, 2].map(|i| (px[i] as f32 * a + m[i] * (1.0 - a)) as u8)));
        }
        c.save(format!("{dir}/{name}-out.png")).unwrap();
        eprintln!("{name}: {:?} {}x{} origin {:?}", r.ink, r.width, r.height, r.origin);
    }
}
