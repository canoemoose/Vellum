//! The signature library: DPAPI round trips, the commands' operations, and files that are
//! tampered with, not ours, or encrypted for someone else failing cleanly.

use image::{Rgba, RgbaImage};
use vellum_lib::signature::dpapi;
use vellum_lib::signature::import::encode_png;
use vellum_lib::signature::library::{self, Entry, Kind, Library, Meta, THUMB_H, THUMB_W};

/// A fresh, empty folder under the system temp folder.
fn temp_dir(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("vellum-sig-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn sample_png(w: u32, h: u32) -> Vec<u8> {
    let mut img = RgbaImage::from_pixel(w, h, Rgba([20, 20, 24, 0]));
    for x in w / 10..w - w / 10 {
        let y = h / 2 + ((x as f32 / 20.0).sin() * h as f32 / 4.0) as u32;
        for dy in 0..3 {
            img.put_pixel(x, (y + dy).min(h - 1), Rgba([20, 20, 24, 255]));
        }
    }
    encode_png(&img).unwrap()
}

#[test]
fn dpapi_round_trips_and_rejects_wrong_entropy_and_tampering() {
    let secret = b"a signature, in all its loops".to_vec();
    let blob = dpapi::protect(&secret, b"entropy one", "test").unwrap();
    assert!(!blob.windows(secret.len()).any(|w| w == secret.as_slice()), "the plaintext isn't in the blob");
    assert_eq!(dpapi::unprotect(&blob, b"entropy one").unwrap(), secret);
    assert!(dpapi::unprotect(&blob, b"entropy two").is_err());
    let mut bad = blob.clone();
    let mid = bad.len() / 2;
    bad[mid] ^= 0x40;
    assert!(dpapi::unprotect(&bad, b"entropy one").is_err());
    assert!(dpapi::unprotect(&blob[..blob.len() - 7], b"entropy one").is_err());
    assert!(dpapi::unprotect(b"", b"entropy one").is_err());
}

#[test]
fn add_list_get_rename_delete() {
    let dir = temp_dir("crud");
    let lib = Library::new(&dir);
    assert!(lib.list().unwrap().items.is_empty());

    let png = sample_png(900, 300);
    let strokes = r#"{"v":1,"strokes":[[[0,0],[10,5]]]}"#.to_string();
    let a = lib.add("  Matt James  ", Kind::Drawn, png.clone(), Some(strokes.clone())).unwrap();
    assert_eq!(a.meta.name, "Matt James");
    assert_eq!((a.meta.width, a.meta.height), (900, 300));
    let b = lib.add("Initials", Kind::Imported, sample_png(200, 120), None).unwrap();
    assert_ne!(a.meta.id, b.meta.id);

    // The preview fits the box and keeps the aspect ratio.
    let t = image::load_from_memory(&a.thumb).unwrap();
    assert!(t.width() <= THUMB_W && t.height() <= THUMB_H);
    assert_eq!((t.width(), t.height()), (THUMB_W, THUMB_W / 3));

    let l = lib.list().unwrap();
    assert_eq!(l.items.iter().map(|i| i.meta.name.as_str()).collect::<Vec<_>>(), ["Matt James", "Initials"]);
    assert!(l.unreadable.is_empty());

    let got = lib.get(&a.meta.id).unwrap();
    assert_eq!(got.png, png, "the full image comes back byte for byte");
    assert_eq!(got.strokes.as_deref(), Some(strokes.as_str()));
    assert_eq!(got.meta.kind, Kind::Drawn);
    assert_eq!(lib.get(&b.meta.id).unwrap().strokes, None);

    let m = lib.rename(&a.meta.id, "M. James\n").unwrap();
    assert_eq!(m.name, "M. James");
    assert_eq!(lib.get(&a.meta.id).unwrap().meta.name, "M. James");
    assert_eq!(lib.get(&a.meta.id).unwrap().png, png, "rename keeps the image");

    lib.delete(&a.meta.id).unwrap();
    lib.delete(&a.meta.id).unwrap(); // already gone is fine
    assert!(lib.get(&a.meta.id).unwrap_err().starts_with("[signature_not_found]"));
    assert_eq!(lib.list().unwrap().items.len(), 1);

    // No temporary files left behind.
    let names: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name()).collect();
    assert_eq!(names.len(), 1, "{names:?}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_file_on_disk_is_encrypted() {
    let dir = temp_dir("encrypted");
    let lib = Library::new(&dir);
    let png = sample_png(400, 150);
    let a = lib.add("Secret Name", Kind::Drawn, png.clone(), Some("STROKE-DATA".into())).unwrap();
    let bytes = std::fs::read(dir.join(format!("{}.vsig", a.meta.id))).unwrap();
    assert!(bytes.starts_with(b"VSIGLIB1"));
    let has = |needle: &[u8]| bytes.windows(needle.len()).any(|w| w == needle);
    assert!(!has(b"Secret Name"));
    assert!(!has(b"STROKE-DATA"));
    assert!(!has(b"IHDR"), "no PNG chunk visible");
    assert!(!has(&png[..64]));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn tampered_foreign_and_junk_files_fail_cleanly() {
    let dir = temp_dir("tamper");
    let lib = Library::new(&dir);
    let good = lib.add("Good", Kind::Drawn, sample_png(300, 100), None).unwrap();
    let victim = lib.add("Victim", Kind::Drawn, sample_png(300, 100), None).unwrap();

    // Tampered: one bit flipped in the middle of the encrypted blob.
    let p = dir.join(format!("{}.vsig", victim.meta.id));
    let mut bytes = std::fs::read(&p).unwrap();
    let mid = bytes.len() / 2;
    bytes[mid] ^= 0x01;
    std::fs::write(&p, &bytes).unwrap();
    assert!(lib.get(&victim.meta.id).unwrap_err().starts_with("[signature_unreadable]"));

    // Encrypted by DPAPI, but not by us (other entropy). Stands in for a file written by
    // another Windows account, which a test can't create: DPAPI refuses both the same way,
    // and the library reports them the same way.
    let foreign_id = "abc123";
    let mut foreign = b"VSIGLIB1".to_vec();
    foreign.extend(dpapi::protect(b"VSIGENT1 whatever", b"someone else's entropy", "x").unwrap());
    std::fs::write(dir.join(format!("{foreign_id}.vsig")), &foreign).unwrap();
    assert!(lib.get(foreign_id).unwrap_err().starts_with("[signature_unreadable]"));

    // Not a signature file at all; and one cut short.
    std::fs::write(dir.join("def456.vsig"), b"hello").unwrap();
    std::fs::write(dir.join("fed654.vsig"), &bytes[..20]).unwrap();
    // Other files in the folder are ignored.
    std::fs::write(dir.join("notes.txt"), b"ignore me").unwrap();
    std::fs::write(dir.join("NOT-AN-ID.vsig"), b"ignore me").unwrap();

    let l = lib.list().unwrap();
    assert_eq!(l.items.len(), 1, "the good one still lists");
    assert_eq!(l.items[0].meta.id, good.meta.id);
    let mut want = vec![victim.meta.id.clone(), foreign_id.to_string(), "def456".into(), "fed654".into()];
    want.sort();
    assert_eq!(l.unreadable, want);

    // Unreadable ones can still be deleted; rename fails cleanly.
    assert!(lib.rename(&victim.meta.id, "x").unwrap_err().starts_with("[signature_unreadable]"));
    lib.delete(&victim.meta.id).unwrap();
    assert!(!p.exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_decrypted_but_malformed_payload_fails_cleanly() {
    // Right key, wrong contents: library::open must not panic.
    for plain in [&b""[..], b"VSIGENT1", b"VSIGENT1\xff\xff\xff\xff", b"VSIGENT1\x02\x00\x00\x00{}"] {
        assert!(library::decode_entry(plain).is_none());
    }
    let e = Entry {
        meta: Meta { id: "1".into(), name: "N".into(), kind: Kind::Imported, width: 1, height: 1, created_ms: 5 },
        png: vec![1, 2, 3],
        thumb: vec![4],
        strokes: None,
    };
    assert_eq!(library::decode_entry(&library::encode_entry(&e)), Some(e.clone()));
    let sealed = library::seal(&e).unwrap();
    assert_eq!(library::open(&sealed).unwrap(), e);
}

#[test]
fn ids_names_and_images_are_checked() {
    let dir = temp_dir("checks");
    let lib = Library::new(&dir);
    for bad in ["", "..\\..\\x", "../x", "ABC", "a b", "g1", "0123456789abcdef0123456789abcdef0"] {
        assert!(!library::valid_id(bad), "{bad:?}");
        assert!(lib.get(bad).unwrap_err().starts_with("[signature_not_found]"));
        assert!(lib.delete(bad).is_err());
    }
    assert!(library::valid_id("19a0b1c2d3e4f0001"));

    assert_eq!(library::clean_name("   "), "Signature");
    assert_eq!(library::clean_name("a\tb\u{7}c"), "abc");
    assert_eq!(library::clean_name(&"x".repeat(200)).chars().count(), library::MAX_NAME_CHARS);
    assert_eq!(library::clean_name("Zoë Brontë"), "Zoë Brontë");

    // Not a PNG; a JPEG; too large.
    assert!(lib.add("x", Kind::Drawn, b"not an image".to_vec(), None).unwrap_err().starts_with("[not_supported]"));
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
        .encode_image(&image::RgbImage::new(10, 10))
        .unwrap();
    assert!(lib.add("x", Kind::Drawn, jpeg, None).unwrap_err().starts_with("[not_supported]"));
    let huge = encode_png(&RgbaImage::new(5000, 10)).unwrap();
    assert!(lib.add("x", Kind::Drawn, huge, None).unwrap_err().starts_with("[signature_too_large]"));
    let big_strokes = "x".repeat(library::MAX_STROKES_BYTES + 1);
    assert!(lib.add("x", Kind::Drawn, sample_png(50, 20), Some(big_strokes)).unwrap_err().starts_with("[signature_too_large]"));
    assert!(lib.list().unwrap().items.is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}
