//! The system clipboard (stage 9): what reading a picture off it makes of its bytes. The
//! clipboard itself is not touched here (it is the user's; checked in the running app).

use vellum_lib::clipboard::{base64, bmp_from_dib, picture_png};

/// A 2 x 1 24-bit DIB: blue, then red (BGR, rows padded to 4 bytes, bottom up).
fn dib24() -> Vec<u8> {
    let mut d = Vec::new();
    d.extend_from_slice(&40u32.to_le_bytes()); // biSize
    d.extend_from_slice(&2i32.to_le_bytes()); // width
    d.extend_from_slice(&1i32.to_le_bytes()); // height
    d.extend_from_slice(&1u16.to_le_bytes()); // planes
    d.extend_from_slice(&24u16.to_le_bytes()); // bits
    d.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    d.extend_from_slice(&8u32.to_le_bytes()); // image size
    d.extend_from_slice(&[0; 16]); // resolution, colours used, important
    d.extend_from_slice(&[255, 0, 0, 0, 0, 255, 0, 0]);
    d
}

#[test]
fn a_dib_becomes_a_bmp_with_the_pixels_where_the_header_says() {
    let bmp = bmp_from_dib(&dib24()).unwrap();
    assert_eq!(&bmp[..2], b"BM");
    assert_eq!(u32::from_le_bytes(bmp[10..14].try_into().unwrap()), 14 + 40);
    let img = image::load_from_memory(&bmp).unwrap().to_rgb8();
    assert_eq!(img.get_pixel(0, 0).0, [0, 0, 255]);
    assert_eq!(img.get_pixel(1, 0).0, [255, 0, 0]);
}

#[test]
fn a_paletted_dib_counts_its_colour_table() {
    let mut d = dib24();
    d[14] = 8; // 8 bits per pixel, no colours-used count: 256 entries
    let bmp = bmp_from_dib(&d).unwrap();
    assert_eq!(u32::from_le_bytes(bmp[10..14].try_into().unwrap()), 14 + 40 + 256 * 4);
    assert!(bmp_from_dib(&[0; 10]).is_none());
}

#[test]
fn base64_is_the_standard_one() {
    assert_eq!(base64(b""), "");
    assert_eq!(base64(b"f"), "Zg==");
    assert_eq!(base64(b"fo"), "Zm8=");
    assert_eq!(base64(b"foo"), "Zm9v");
    assert_eq!(base64(b"foobar"), "Zm9vYmFy");
}

#[test]
fn a_large_picture_is_scaled_down_to_the_limit() {
    let img = image::RgbImage::from_pixel(3000, 1000, image::Rgb([10, 20, 30]));
    let mut png = Vec::new();
    image::DynamicImage::ImageRgb8(img).write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
    let (out, w, h) = picture_png(&png).unwrap();
    assert_eq!((w, h), (2000, 667));
    assert_eq!(&out[1..4], b"PNG");
    let (_, w, h) = picture_png(&bmp_from_dib(&dib24()).unwrap()).unwrap();
    assert_eq!((w, h), (2, 1));
}

// Stage 8: the Image tool's picture file goes through the same limit as a pasted picture.

#[test]
fn a_picture_file_is_scaled_to_the_limit_and_junk_is_refused() {
    use vellum_lib::clipboard::picture_file;
    let dir = std::env::temp_dir().join(format!("vellum-picture-file-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    // A tall JPEG over the limit: 2000 on its long side, aspect kept.
    let img = image::RgbImage::from_pixel(900, 2700, image::Rgb([200, 30, 30]));
    let jpg = dir.join("tall.jpg");
    image::DynamicImage::ImageRgb8(img).save(&jpg).unwrap();
    let (png, w, h) = picture_file(&jpg).unwrap();
    assert_eq!((w, h), (667, 2000));
    assert_eq!(&png[1..4], b"PNG");
    // A small PNG with transparency comes through as it is.
    let small = image::RgbaImage::from_pixel(40, 20, image::Rgba([0, 0, 0, 0]));
    let p = dir.join("clear.png");
    image::DynamicImage::ImageRgba8(small).save(&p).unwrap();
    let (png, w, h) = picture_file(&p).unwrap();
    assert_eq!((w, h), (40, 20));
    let back = image::load_from_memory(&png).unwrap().to_rgba8();
    assert_eq!(back.get_pixel(3, 3).0[3], 0, "transparency kept");
    // Not a picture, and not there.
    let junk = dir.join("junk.png");
    std::fs::write(&junk, b"not a picture").unwrap();
    assert!(picture_file(&junk).unwrap_err().starts_with("[picture_unreadable]"));
    assert!(picture_file(&dir.join("missing.png")).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}
