//! Pictures the `image` crate can't read, decoded through Windows Imaging Component: HEIC (an
//! iPhone's default), and JPEG XR as a format every Windows has a codec for. Fixtures are
//! encoded with WIC itself. The HEIC test needs Microsoft's HEIF and HEVC extensions to encode
//! its fixture; without them it says so and passes (the decode path is the same as JPEG XR's).

#![cfg(windows)]

use image::{Rgb, RgbImage};
use vellum_lib::signature::import;
use vellum_lib::signature::wic::{self, looks_like_heif};
use windows::Win32::Foundation::HGLOBAL;
use windows::Win32::Graphics::Imaging::*;
use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, STREAM_SEEK_END, STREAM_SEEK_SET,
};
use windows::core::GUID;

/// Encode with WIC into `container`. None if Windows has no encoder for it.
fn wic_encode(img: &RgbImage, container: &GUID) -> Option<Vec<u8>> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let factory: IWICImagingFactory = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).unwrap();
        let encoder = factory.CreateEncoder(container, std::ptr::null()).ok()?;
        let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true).unwrap();
        encoder.Initialize(&stream, WICBitmapEncoderNoCache).ok()?;
        let mut frame = None;
        encoder.CreateNewFrame(&mut frame, std::ptr::null_mut()).ok()?;
        let frame = frame?;
        frame.Initialize(None).ok()?;
        // WIC wants BGR; WriteSource converts to whatever the encoder takes.
        let bgr: Vec<u8> = img.pixels().flat_map(|p| [p[2], p[1], p[0]]).collect();
        let bitmap = factory
            .CreateBitmapFromMemory(img.width(), img.height(), &GUID_WICPixelFormat24bppBGR, img.width() * 3, &bgr)
            .unwrap();
        frame.SetSize(img.width(), img.height()).ok()?;
        frame.WriteSource(&bitmap, std::ptr::null()).ok()?;
        frame.Commit().ok()?;
        encoder.Commit().ok()?;
        let mut len = 0u64;
        stream.Seek(0, STREAM_SEEK_END, Some(&mut len)).unwrap();
        stream.Seek(0, STREAM_SEEK_SET, None).unwrap();
        let mut out = vec![0u8; len as usize];
        let mut read = 0u32;
        stream.Read(out.as_mut_ptr().cast(), len as u32, Some(&mut read)).ok().unwrap();
        out.truncate(read as usize);
        Some(out)
    }
}

/// A plain photo-ish fixture: light grey gradient paper, a dark horizontal stroke 8 px thick
/// from x = 100 to 500 at y = 200, and a short vertical stroke at x = 100 from y = 120 to 200
/// (so orientation is visible).
fn fixture() -> RgbImage {
    RgbImage::from_fn(600, 400, |x, y| {
        let paper = 225.0 - 30.0 * x as f32 / 600.0;
        let ink = (100..500).contains(&x) && (196..204).contains(&y) || (96..104).contains(&x) && (120..204).contains(&y);
        let v = if ink { 30.0 } else { paper } as u8;
        Rgb([v, v, v.saturating_sub(6)])
    })
}

#[test]
fn heif_is_recognised_by_its_header() {
    let mut b = vec![0, 0, 0, 24];
    b.extend_from_slice(b"ftypheic");
    b.extend_from_slice(&[0; 12]);
    assert!(looks_like_heif(&b));
    b[8..12].copy_from_slice(b"mif1");
    assert!(looks_like_heif(&b));
    b[8..12].copy_from_slice(b"isom"); // an MP4
    assert!(!looks_like_heif(&b));
    assert!(!looks_like_heif(b"\xFF\xD8\xFF\xE0 jpeg"));
    assert!(!looks_like_heif(b"short"));
}

#[test]
fn wic_reads_the_orientation_tag_without_turning_the_pixels() {
    // A JPEG tagged orientation 6, decoded by WIC directly: the tag comes back and the pixels
    // are as stored, so the import applies it once.
    let img = RgbImage::from_pixel(120, 60, Rgb([200, 200, 200]));
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new(&mut jpeg).encode_image(&img).unwrap();
    // EXIF APP1 with only Orientation = 6, after SOI.
    let mut tiff = b"II*\0".to_vec();
    tiff.extend_from_slice(&8u32.to_le_bytes());
    tiff.extend_from_slice(&1u16.to_le_bytes());
    tiff.extend_from_slice(&0x0112u16.to_le_bytes());
    tiff.extend_from_slice(&3u16.to_le_bytes());
    tiff.extend_from_slice(&1u32.to_le_bytes());
    tiff.extend_from_slice(&6u16.to_le_bytes());
    tiff.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
    let mut app1 = b"Exif\0\0".to_vec();
    app1.extend_from_slice(&tiff);
    let mut tagged = jpeg[..2].to_vec();
    tagged.extend_from_slice(&[0xFF, 0xE1]);
    tagged.extend_from_slice(&((app1.len() + 2) as u16).to_be_bytes());
    tagged.extend_from_slice(&app1);
    tagged.extend_from_slice(&jpeg[2..]);
    let Ok(d) = wic::decode(&tagged, u64::MAX) else { panic!("WIC decodes JPEG") };
    assert_eq!(d.orientation, Some(6));
    assert_eq!(d.rgba.dimensions(), (120, 60));
}

#[test]
fn a_jpeg_xr_picture_imports_through_wic() {
    let jxr = wic_encode(&fixture(), &GUID_ContainerFormatWmp).expect("Windows has a JPEG XR encoder");
    assert!(image::load_from_memory(&jxr).is_err(), "the image crate can't read JPEG XR");
    let r = import::import_bytes(&jxr).expect("imports through WIC");
    // The strokes span 400 x 84 px; plus a 3% margin (12 px) each side.
    assert!((r.width as i32 - 424).abs() <= 6, "width {}", r.width);
    assert!((r.height as i32 - 108).abs() <= 6, "height {}", r.height);
    assert!(r.ink.iter().all(|&c| c < 40), "ink {:?}", r.ink);
}

#[test]
fn a_heic_photo_imports_through_wic() {
    let Some(heic) = wic_encode(&fixture(), &GUID_ContainerFormatHeif) else {
        eprintln!("SKIPPED: this Windows can't encode HEIF (no HEIF/HEVC extensions)");
        return;
    };
    assert!(looks_like_heif(&heic), "header {:?}", &heic[..16.min(heic.len())]);
    assert!(image::load_from_memory(&heic).is_err(), "the image crate can't read HEIC");
    let r = import::import_bytes(&heic).expect("imports through WIC");
    assert!((r.width as i32 - 424).abs() <= 8, "width {}", r.width);
    assert!((r.height as i32 - 108).abs() <= 8, "height {}", r.height);
    assert!(r.ink.iter().all(|&c| c < 40), "ink {:?}", r.ink);
}

#[test]
fn a_heif_file_windows_cant_read_says_what_to_install() {
    // A HEIF header and nothing usable after it.
    let mut b = vec![0, 0, 0, 24];
    b.extend_from_slice(b"ftypheic");
    b.extend_from_slice(&[0u8; 200]);
    let e = import::import_bytes(&b).unwrap_err();
    assert!(e.starts_with("[heic_codec_missing]"), "{e}");
}

#[test]
fn junk_is_still_not_supported() {
    let e = import::import_bytes(b"neither image nor HEIF, just words").unwrap_err();
    assert!(e.starts_with("[not_supported]"), "{e}");
}

/// A 24-bit BMP's headers claiming `w` x `h`, followed by a few bytes of pixels: enough for
/// either decoder to read the size, nowhere near enough to fill it.
fn bmp_header(w: i32, h: i32) -> Vec<u8> {
    let mut b = b"BM".to_vec();
    b.extend_from_slice(&(54u32 + 64).to_le_bytes()); // file size (as written; decoders don't trust it)
    b.extend_from_slice(&[0, 0, 0, 0]);
    b.extend_from_slice(&54u32.to_le_bytes()); // pixels start here
    b.extend_from_slice(&40u32.to_le_bytes()); // BITMAPINFOHEADER
    b.extend_from_slice(&w.to_le_bytes());
    b.extend_from_slice(&h.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes()); // planes
    b.extend_from_slice(&24u16.to_le_bytes()); // bits per pixel
    b.extend_from_slice(&[0u8; 24]); // no compression, sizes and palette left to the decoder
    b.extend_from_slice(&[0x80u8; 64]);
    b
}

// docs/review-0.2.0.md, 4: a huge picture used to fall through to WIC on any image crate
// error, its 512 MiB limit included, and WIC would allocate up to 30000 x 30000 x 4 bytes.

/// A PNG's signature, header (`w` x `h`, 8-bit RGB) and end, with no pixel data at all.
fn png_header(w: u32, h: u32) -> Vec<u8> {
    fn crc(bytes: &[u8]) -> u32 {
        let mut c = !0u32;
        for &b in bytes {
            c ^= b as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            }
        }
        !c
    }
    let chunk = |kind: &[u8], data: &[u8]| {
        let mut c = (data.len() as u32).to_be_bytes().to_vec();
        let mut body = kind.to_vec();
        body.extend_from_slice(data);
        c.extend_from_slice(&body);
        c.extend_from_slice(&crc(&body).to_be_bytes());
        c
    };
    let mut ihdr = w.to_be_bytes().to_vec();
    ihdr.extend_from_slice(&h.to_be_bytes());
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
    let mut b = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    b.extend(chunk(b"IHDR", &ihdr));
    b.extend(chunk(b"IDAT", &[0x78, 0x9C, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]));
    b.extend(chunk(b"IEND", &[]));
    b
}

#[test]
fn wic_refuses_a_picture_over_the_limit_before_reading_it() {
    let png = png_header(12_000, 12_000); // 144 MP
    match wic::decode(&png, import::MAX_PIXELS) {
        Err(wic::WicError::TooLarge(12_000, 12_000)) => {}
        Err(wic::WicError::TooLarge(w, h)) => panic!("too large, but {w} x {h}"),
        Err(wic::WicError::Failed(why)) => panic!("failed rather than refused: {why}"),
        Err(wic::WicError::NoCodec) => panic!("no codec for BMP"),
        Ok(d) => panic!("decoded {:?}", d.rgba.dimensions()),
    }
}

#[test]
fn a_picture_over_100_megapixels_is_refused_as_too_large() {
    // Under the image crate's own memory limit (refused by the pixel count) and over it
    // (refused by the limit): either way too large, in words a user can act on, and never
    // handed to WIC.
    for (w, h) in [(12_000, 12_000), (20_000, 20_000)] {
        for (what, bytes) in [("BMP", bmp_header(w as i32, h as i32)), ("PNG", png_header(w, h))] {
            let e = import::import_bytes(&bytes).unwrap_err();
            assert!(e.starts_with("[picture_too_large]"), "{what} {w} x {h}: {e}");
            let e = import::preview_bytes(&bytes).unwrap_err();
            assert!(e.starts_with("[picture_too_large]"), "{what} {w} x {h} preview: {e}");
        }
    }
}

#[test]
fn a_file_over_the_size_limit_is_refused_without_reading_it() {
    let dir = std::env::temp_dir().join(format!("vellum-sigtest-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("huge.jpg");
    let f = std::fs::File::create(&path).unwrap();
    f.set_len(import::MAX_FILE_BYTES + 1).unwrap(); // allocated, never written
    drop(f);
    let p = path.to_str().unwrap();
    let preview = import::preview_file(p).unwrap_err();
    let imported = import::import_file(p).unwrap_err();
    std::fs::remove_dir_all(&dir).ok();
    assert!(preview.starts_with("[picture_too_large]"), "{preview}");
    assert!(imported.starts_with("[picture_too_large]"), "{imported}");
}

#[test]
fn a_bmp_within_the_limit_still_imports() {
    // The image crate reads BMP itself; the size check mustn't stop an ordinary picture.
    let mut bmp = Vec::new();
    image::codecs::bmp::BmpEncoder::new(&mut bmp).encode(fixture().as_raw(), 600, 400, image::ExtendedColorType::Rgb8).unwrap();
    let r = import::import_bytes(&bmp).expect("imports");
    assert!((r.width as i32 - 424).abs() <= 6, "width {}", r.width);
}
