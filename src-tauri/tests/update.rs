// In-app updates: the release page address, counting other running copies, and the note of
// open tabs kept across the restart.
use std::path::Path;
use vellum_lib::update::{count_other_copies, release_url, save_handover, take_handover};

#[test]
fn the_tab_note_is_read_once_then_gone() {
    let dir = std::env::temp_dir().join(format!("vellum-handover-test-{}", std::process::id()));
    let path = dir.join("nested").join("update-handover.json");
    let note = r#"{"paths":["C:/a.pdf"],"active":null,"t":1}"#;
    assert_eq!(take_handover(&path), None);
    save_handover(&path, note).unwrap();
    assert_eq!(take_handover(&path).as_deref(), Some(note));
    assert_eq!(take_handover(&path), None);
    assert!(!path.exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn release_page_for_a_version() {
    assert_eq!(release_url("0.1.2").as_deref(), Some("https://github.com/canoemoose/Vellum/releases/tag/v0.1.2"));
    assert_eq!(release_url("0.2.0-rc1").as_deref(), Some("https://github.com/canoemoose/Vellum/releases/tag/v0.2.0-rc1"));
    assert_eq!(release_url("1.20.300-beta.2").as_deref(), Some("https://github.com/canoemoose/Vellum/releases/tag/v1.20.300-beta.2"));
}

#[test]
fn anything_but_a_version_opens_nothing() {
    for bad in [
        "", "1.2", "1.2.3.4", "v1.2.3", "1.2.x", "1.2.3-", "1.2.3/../../evil", "1.2.3?x=1", "1.2.3#frag",
        "1.2.3 & calc.exe", "1.2.3-a b", "https://example.com", "1.2.3-\"", "1..3", "1.2.3-a/b",
    ] {
        assert_eq!(release_url(bad), None, "{bad:?}");
    }
}

#[test]
fn counts_other_copies_of_the_same_exe_only() {
    let me = Path::new(r"C:\Users\x\AppData\Local\Vellum\vellum.exe");
    let procs = vec![
        (10, r"C:\Users\x\AppData\Local\Vellum\vellum.exe".to_string()), // this process
        (11, r"c:\users\x\appdata\local\vellum\VELLUM.EXE".to_string()), // another window
        (12, "C:/Users/x/AppData/Local/Vellum/vellum.exe".to_string()),  // and another
        (13, r"C:\Repos\Vellum\target\release\vellum.exe".to_string()),  // a dev build: not this exe
        (14, r"C:\Windows\explorer.exe".to_string()),
    ];
    assert_eq!(count_other_copies(&procs, 10, me), 2);
}

#[test]
fn alone_counts_none() {
    let me = Path::new(r"C:\Vellum\vellum.exe");
    assert_eq!(count_other_copies(&[(10, r"C:\Vellum\vellum.exe".to_string())], 10, me), 0);
    assert_eq!(count_other_copies(&[], 10, me), 0);
}
