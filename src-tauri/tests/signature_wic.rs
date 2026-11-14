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
    let Ok(d) = wic::decode(&tagged) else { panic!("WIC decodes JPEG") };
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
