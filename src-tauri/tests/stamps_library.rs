//! Your own image stamps (stamps.rs): pictures in, PNGs with their transparency kept out, a
//! preview each, listed, fetched and removed. Pictures are synthetic, made here.

use std::path::{Path, PathBuf};
use vellum_lib::stamps::{MAX_SIDE, StampLibrary, name_from_path, prepare, valid_id};

fn dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("vellum-stamps-test-{}-{tag}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    d
}

fn png(w: u32, h: u32, alpha: u8) -> Vec<u8> {
    let img = image::RgbaImage::from_fn(w, h, |x, _| if x % 2 == 0 { image::Rgba([200, 0, 0, alpha]) } else { image::Rgba([0, 0, 0, 0]) });
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

fn jpeg(w: u32, h: u32) -> Vec<u8> {
    let img = image::RgbImage::from_pixel(w, h, image::Rgb([10, 120, 200]));
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Jpeg).unwrap();
    out.into_inner()
}

#[test]
fn a_png_keeps_its_transparency_and_a_jpeg_comes_in_too() {
    let (p, thumb, w, h) = prepare(&png(40, 20, 255)).unwrap();
    assert_eq!((w, h), (40, 20));
    let back = image::load_from_memory(&p).unwrap().to_rgba8();
    assert_eq!(back.get_pixel(0, 0).0, [200, 0, 0, 255]);
    assert_eq!(back.get_pixel(1, 0).0[3], 0, "clear stays clear: no knock-out, no flattening");
    assert!(image::load_from_memory(&thumb).is_ok());
    let (j, _, jw, jh) = prepare(&jpeg(30, 30)).unwrap();
    assert_eq!((jw, jh), (30, 30));
    assert_eq!(image::guess_format(&j).unwrap(), image::ImageFormat::Png);
}

#[test]
fn big_pictures_are_scaled_down_and_tiny_or_junk_ones_refused() {
    let (_, thumb, w, h) = prepare(&png(4000, 1000, 255)).unwrap();
    assert_eq!((w, h), (MAX_SIDE, 500));
    let t = image::load_from_memory(&thumb).unwrap();
    assert!(t.width() <= 240 && t.height() <= 80);
    assert!(prepare(&png(4, 4, 255)).unwrap_err().starts_with("[stamp_too_small]"));
    assert!(prepare(b"not a picture").unwrap_err().starts_with("[not_supported]"));
}

#[test]
fn add_list_get_and_delete() {
    let lib = StampLibrary::new(dir("lib"));
    assert!(lib.list().unwrap().is_empty(), "a missing folder is an empty library");
    let src = dir("src");
    std::fs::create_dir_all(&src).unwrap();
    let f = src.join("Checked by site.png");
    std::fs::write(&f, png(40, 20, 128)).unwrap();
    let a = lib.add_file(&f).unwrap();
    assert_eq!(a.meta.name, "Checked by site");
    let b = lib.add("Second", &jpeg(20, 20)).unwrap();
    let l = lib.list().unwrap();
    assert_eq!(l.iter().map(|i| i.meta.name.as_str()).collect::<Vec<_>>(), vec!["Checked by site", "Second"]);
    assert!(valid_id(&a.meta.id));
    let got = lib.get(&a.meta.id).unwrap();
    assert_eq!(image::load_from_memory(&got).unwrap().to_rgba8().get_pixel(0, 0).0, [200, 0, 0, 128]);
    lib.delete(&a.meta.id).unwrap();
    lib.delete(&a.meta.id).unwrap();
    assert_eq!(lib.list().unwrap().len(), 1);
    assert!(lib.get(&a.meta.id).unwrap_err().starts_with("[stamp_not_found]"));
    assert!(lib.get("../x").unwrap_err().starts_with("[stamp_not_found]"));
    assert!(lib.delete("..\\x").is_err());
    let _ = b;
}

#[test]
fn names_come_from_the_file() {
    assert_eq!(name_from_path(Path::new("C:/x/  Logo  .jpg")), "Logo");
    assert_eq!(name_from_path(Path::new("C:/x/ .png")), "Stamp");
    assert_eq!(name_from_path(Path::new(&format!("C:/x/{}.png", "n".repeat(200)))).chars().count(), 80);
}
