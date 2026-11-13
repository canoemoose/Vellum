//! Document kind detection.

use std::path::Path;
use vellum_lib::docs::{DocKind, detect_kind, sniff_kind};
use vellum_lib::imagedoc;

#[test]
fn sniffs_pdf_header_anywhere_in_first_kb() {
    assert_eq!(sniff_kind(b"%PDF-1.7\n..."), Some(DocKind::Pdf));
    let mut junk = vec![b' '; 500];
    junk.extend_from_slice(b"%PDF-1.4");
    assert_eq!(sniff_kind(&junk), Some(DocKind::Pdf));
}

#[test]
fn sniffs_image_magic() {
    assert_eq!(sniff_kind(b"\xFF\xD8\xFF\xE0rest"), Some(DocKind::Image));
    assert_eq!(sniff_kind(b"\x89PNG\r\n\x1a\nrest"), Some(DocKind::Image));
    assert_eq!(sniff_kind(b"GIF89a.."), Some(DocKind::Image));
    assert_eq!(sniff_kind(b"II*\x00...."), Some(DocKind::Image));
    assert_eq!(sniff_kind(b"RIFF\x00\x00\x00\x00WEBPVP8 "), Some(DocKind::Image));
    assert_eq!(sniff_kind(b"hello world"), None);
    assert_eq!(sniff_kind(b""), None);
}

#[test]
fn extension_decides_first() {
    assert_eq!(detect_kind(Path::new("C:/nowhere/a b (1).PDF")), Ok(DocKind::Pdf));
    assert_eq!(detect_kind(Path::new("C:/nowhere/scan.JPG")), Ok(DocKind::Image));
    assert!(imagedoc::handles(Path::new("x.tiff")));
    assert!(!imagedoc::handles(Path::new("x.pdf")));
}

#[test]
fn unknown_extension_is_sniffed() {
    let dir = std::env::temp_dir().join(format!("vellum-docs-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let pdf = dir.join("drawing.dat");
    std::fs::write(&pdf, b"%PDF-1.5\n%...").unwrap();
    assert_eq!(detect_kind(&pdf), Ok(DocKind::Pdf));
    let txt = dir.join("notes.txt");
    std::fs::write(&txt, b"just text").unwrap();
    assert_eq!(detect_kind(&txt), Err("[not_supported] Not a PDF or supported image".to_string()));
    let _ = std::fs::remove_dir_all(&dir);
}
