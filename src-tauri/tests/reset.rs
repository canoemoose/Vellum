use vellum_lib::reset::{remove_dir, Reset};

#[test]
fn parses_any_mix_and_ignores_the_rest() {
    assert_eq!(Reset::parse("settings"), Reset { settings: true, previews: false, library: false });
    assert_eq!(Reset::parse("Previews, library"), Reset { settings: false, previews: true, library: true });
    assert_eq!(Reset::parse("everything,,"), Reset::default());
}

#[test]
fn removes_a_folder_and_its_contents_and_accepts_one_that_is_not_there() {
    let dir = std::env::temp_dir().join(format!("vellum-reset-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("inner")).unwrap();
    std::fs::write(dir.join("inner").join("a.webp"), b"x").unwrap();
    assert_eq!(remove_dir(&dir), Ok(()));
    assert!(!dir.exists());
    assert_eq!(remove_dir(&dir), Ok(()));
}
