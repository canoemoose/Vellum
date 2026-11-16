//! Crash-recovery records are encrypted (annot/commands.rs): a record holding a placed
//! signature has none of it readable on disk, an old plain record still loads (once, sealed as
//! it's read), and a damaged one says so without its contents. The signature is synthetic.

use std::path::PathBuf;
use vellum_lib::annot::commands::{delete_record, read_record, recovery_file, sealed_file, write_sealed};

fn dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("vellum-recovery-test-{}-{tag}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// A recovery record like the app writes, with a signature stamp holding strokes and an image.
fn record() -> (String, Vec<String>) {
    // A recognisable fake PNG: the real signature, then bytes no encryption would leave alone.
    let png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0eNT6AAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";
    let strokes = "[[12.5,40.25,13.75,38.5,15.5,36.75],[22.25,30.5]]";
    let json = format!(
        r#"{{"v":1,"path":"C:\\Drawings\\plan.pdf","stamp":{{"size":1,"mtimeMs":2}},"markups":[{{"id":"vellum-sig-1","kind":"stamp","signature":true,"content":{{"type":"strokes","strokes":{strokes},"pen":2.6}}}},{{"id":"vellum-sig-2","kind":"stamp","signature":true,"content":{{"type":"image","png":"{png_b64}","hash":"ab12"}}}}],"saved":[]}}"#
    );
    (json, vec![png_b64.into(), "iVBORw0KGgo".into(), "12.5,40.25".into(), "strokes".into(), "signature".into(), "vellum-sig-1".into(), "plan.pdf".into()])
}

#[test]
fn a_record_holding_a_signature_has_nothing_readable_on_disk() {
    let d = dir("sealed");
    let (json, secrets) = record();
    write_sealed(&d, "m-abc", &json).unwrap();
    let f = sealed_file(&d, "m-abc").unwrap();
    let bytes = std::fs::read(&f).unwrap();
    let text = String::from_utf8_lossy(&bytes);
    for s in &secrets {
        assert!(!text.contains(s.as_str()), "{s:?} readable in the record");
    }
    // UTF-16 too (no plain text in any common encoding).
    let wide: Vec<u8> = "signature".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    assert!(!bytes.windows(wide.len()).any(|w| w == wide));
    // No plain file beside it, and it reads back exactly.
    assert!(!recovery_file(&d, "m-abc").unwrap().exists());
    assert_eq!(read_record(&d, "m-abc").unwrap().as_deref(), Some(json.as_str()));
    // Nothing else in the folder (no temporary file left behind).
    assert_eq!(std::fs::read_dir(&d).unwrap().count(), 1);
}

#[test]
fn an_old_plain_record_still_loads_once_and_is_sealed() {
    let d = dir("plain");
    let (json, _) = record();
    let old = recovery_file(&d, "m-old").unwrap();
    std::fs::write(&old, &json).unwrap();
    assert_eq!(read_record(&d, "m-old").unwrap().as_deref(), Some(json.as_str()));
    // Sealed as it was read: the plain file is gone and the sealed one reads the same.
    assert!(!old.exists());
    assert!(sealed_file(&d, "m-old").unwrap().exists());
    assert_eq!(read_record(&d, "m-old").unwrap().as_deref(), Some(json.as_str()));
}

#[test]
fn writing_replaces_an_old_plain_record() {
    let d = dir("replace");
    std::fs::write(recovery_file(&d, "m-x").unwrap(), "{\"old\":true}").unwrap();
    write_sealed(&d, "m-x", "{\"new\":true}").unwrap();
    assert!(!recovery_file(&d, "m-x").unwrap().exists());
    assert_eq!(read_record(&d, "m-x").unwrap().as_deref(), Some("{\"new\":true}"));
}

#[test]
fn a_damaged_record_says_so_without_its_contents() {
    let d = dir("damaged");
    let (json, _) = record();
    write_sealed(&d, "m-d", &json).unwrap();
    let f = sealed_file(&d, "m-d").unwrap();
    let mut b = std::fs::read(&f).unwrap();
    let n = b.len();
    b[n - 10] ^= 0xff;
    std::fs::write(&f, &b).unwrap();
    let e = read_record(&d, "m-d").unwrap_err();
    assert!(e.starts_with("[recovery_unreadable]"), "{e}");
    assert!(!e.contains("vellum-sig"));
    // A sealed record from something else (no header) is unreadable too.
    std::fs::write(&f, b"plain junk").unwrap();
    assert!(read_record(&d, "m-d").unwrap_err().starts_with("[recovery_unreadable]"));
}

#[test]
fn delete_removes_sealed_and_plain_and_missing_is_none() {
    let d = dir("delete");
    write_sealed(&d, "m-1", "{}").unwrap();
    std::fs::write(recovery_file(&d, "m-1").unwrap(), "{}").unwrap();
    delete_record(&d, "m-1").unwrap();
    delete_record(&d, "m-1").unwrap();
    assert_eq!(read_record(&d, "m-1").unwrap(), None);
    assert!(write_sealed(&d, "../escape", "{}").is_err());
}
