//! PDFium DLL copies: reused across launches, never overwritten, keyed by the original.

use std::time::{Duration, UNIX_EPOCH};
use vellum_lib::pdfium::{clean_other_copies, copies_dir_for, copies_key, ensure_copy};

fn temp_dir(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("vellum-dll-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn set_mtime(p: &std::path::Path, secs: u64) {
    let f = std::fs::OpenOptions::new().write(true).open(p).unwrap();
    f.set_modified(UNIX_EPOCH + Duration::from_secs(secs)).unwrap();
}

#[test]
fn key_names_size_and_mtime() {
    assert_eq!(copies_key(7824384, 1_700_000_000), "7824384-1700000000");
}

#[test]
fn folder_follows_the_original_dll() {
    let d = temp_dir("key");
    let dll = d.join("pdfium.dll");
    std::fs::write(&dll, vec![1u8; 1000]).unwrap();
    set_mtime(&dll, 1_000_000);
    let root = d.join("root");
    let a = copies_dir_for(&root, &dll).unwrap();
    assert_eq!(a, root.join("1000-1000000"));
    // A different build (new mtime) gets its own folder; the same one keeps the old.
    set_mtime(&dll, 2_000_000);
    assert_ne!(copies_dir_for(&root, &dll).unwrap(), a);
    assert!(copies_dir_for(&root, &d.join("missing.dll")).is_err());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn copy_is_made_once_and_then_reused_untouched() {
    let d = temp_dir("reuse");
    let dll = d.join("pdfium.dll");
    std::fs::write(&dll, vec![2u8; 4096]).unwrap();
    let dest = d.join("k").join("pdfium-1.dll");
    ensure_copy(&dll, &dest).unwrap();
    assert_eq!(std::fs::read(&dest).unwrap(), vec![2u8; 4096]);
    // Mark it so a rewrite would show.
    set_mtime(&dest, 1_234_567);
    ensure_copy(&dll, &dest).unwrap();
    let m = std::fs::metadata(&dest).unwrap().modified().unwrap();
    assert_eq!(m, UNIX_EPOCH + Duration::from_secs(1_234_567), "existing copy not rewritten");
    // No temporary files left behind.
    let names: Vec<_> = std::fs::read_dir(d.join("k")).unwrap().flatten().map(|e| e.file_name()).collect();
    assert_eq!(names.len(), 1);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn a_truncated_copy_is_replaced() {
    let d = temp_dir("partial");
    let dll = d.join("pdfium.dll");
    std::fs::write(&dll, vec![3u8; 4096]).unwrap();
    let dest = d.join("pdfium-2.dll");
    std::fs::write(&dest, vec![3u8; 100]).unwrap();
    ensure_copy(&dll, &dest).unwrap();
    assert_eq!(std::fs::metadata(&dest).unwrap().len(), 4096);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn cleanup_keeps_the_current_folder_and_recent_ones() {
    let d = temp_dir("clean");
    let keep = d.join("1000-1");
    let old = d.join("999-0");
    let old_pid = d.join("p1234");
    let fresh = d.join("998-0");
    for dir in [&keep, &old, &old_pid, &fresh] {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("pdfium-1.dll"), b"x").unwrap();
    }
    let flat = d.join("pdfium-3.dll");
    std::fs::write(&flat, b"x").unwrap();
    // Age everything except `fresh` (directory mtimes follow their newest entry on Windows,
    // so set them explicitly).
    for p in [&keep, &old, &old_pid, &flat] {
        let _ = filetime_like(p, 1_000_000);
    }
    clean_other_copies(&d, &keep);
    assert!(keep.exists());
    assert!(fresh.exists(), "touched in the last minute: left alone");
    assert!(!old.exists());
    assert!(!old_pid.exists());
    assert!(!flat.exists());
    let _ = std::fs::remove_dir_all(&d);
}

/// Set a file's or directory's modification time (directories need backup semantics on
/// Windows, which std's File::open doesn't request, so fall back to touching via the API).
fn filetime_like(p: &std::path::Path, secs: u64) -> std::io::Result<()> {
    let t = UNIX_EPOCH + Duration::from_secs(secs);
    if p.is_dir() {
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
            let f = std::fs::OpenOptions::new().write(true).custom_flags(FILE_FLAG_BACKUP_SEMANTICS).open(p)?;
            return f.set_modified(t);
        }
        #[cfg(not(windows))]
        return Ok(());
    }
    std::fs::OpenOptions::new().write(true).open(p)?.set_modified(t)
}
