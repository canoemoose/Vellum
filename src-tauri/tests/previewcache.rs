//! Persistent preview cache: keys and the size cap.

use vellum_lib::previewcache::{content_key, content_key_from, get, put, trim, valid_key};

fn temp_dir(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("vellum-pc-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn key_is_stable_and_sensitive_to_every_input() {
    let k = content_key_from(100, 5, b"head", b"tail");
    assert_eq!(k, content_key_from(100, 5, b"head", b"tail"));
    assert!(valid_key(&k));
    assert_ne!(k, content_key_from(101, 5, b"head", b"tail"));
    assert_ne!(k, content_key_from(100, 6, b"head", b"tail"));
    assert_ne!(k, content_key_from(100, 5, b"heaD", b"tail"));
    assert_ne!(k, content_key_from(100, 5, b"head", b"taiL"));
}

#[test]
fn valid_key_rejects_anything_but_16_hex_digits() {
    assert!(valid_key("0123456789abcdef"));
    assert!(!valid_key("0123456789abcde"));
    assert!(!valid_key("..\\..\\windows\\x"));
    assert!(!valid_key("0123456789abcdeg"));
}

#[test]
fn file_key_changes_when_the_file_changes() {
    let d = temp_dir("key");
    let f = d.join("a b (1).pdf");
    std::fs::write(&f, vec![7u8; 3 * 1024 * 1024]).unwrap();
    let k1 = content_key(&f).unwrap();
    assert_eq!(k1, content_key(&f).unwrap());
    // Same size, different last byte (inside the tail sample).
    let mut bytes = vec![7u8; 3 * 1024 * 1024];
    *bytes.last_mut().unwrap() = 8;
    std::fs::write(&f, bytes).unwrap();
    assert_ne!(k1, content_key(&f).unwrap());
    assert!(content_key(&d.join("missing.pdf")).is_none());
    // Small files (head only) work too.
    std::fs::write(d.join("tiny.pdf"), b"%PDF-1.4").unwrap();
    assert!(content_key(&d.join("tiny.pdf")).is_some());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn put_then_get_round_trips_and_bad_keys_are_refused() {
    let d = temp_dir("rt");
    put(&d, "00000000000000aa", 3, b"webp-bytes", 1 << 20).unwrap();
    assert_eq!(get(&d, "00000000000000aa", 3).as_deref(), Some(&b"webp-bytes"[..]));
    assert!(get(&d, "00000000000000aa", 4).is_none());
    assert!(put(&d, "../evil", 0, b"x", 1 << 20).is_err());
    assert!(get(&d, "../evil", 0).is_none());
    assert!(put(&d, "00000000000000aa", 0, b"", 1 << 20).is_err());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn trim_deletes_least_recently_used_first() {
    let d = temp_dir("trim");
    for (i, k) in ["000000000000000a", "000000000000000b", "000000000000000c"].iter().enumerate() {
        put(&d, k, 0, &vec![1u8; 1000], u64::MAX).unwrap();
        // Distinct, increasing modification times.
        let f = std::fs::OpenOptions::new().write(true).open(d.join(format!("{k}-p0.webp"))).unwrap();
        f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000 + i as u64)).unwrap();
    }
    trim(&d, 2000);
    assert!(get(&d, "000000000000000a", 0).is_none(), "oldest went");
    assert!(get(&d, "000000000000000b", 0).is_some());
    assert!(get(&d, "000000000000000c", 0).is_some());
    let _ = std::fs::remove_dir_all(&d);
}
