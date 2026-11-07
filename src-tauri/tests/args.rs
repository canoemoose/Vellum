use vellum_lib::parse_args;

fn p(v: &[&str]) -> vellum_lib::LaunchArgs {
    parse_args(v.iter().map(|s| s.to_string()))
}

#[test]
fn first_positional_is_file() {
    let a = p(&["vellum.exe", r"C:\a b\x.pdf"]);
    assert_eq!(a.file.as_deref(), Some(r"C:\a b\x.pdf"));
    assert!(!a.bench);
}

#[test]
fn bench_flags() {
    let a = p(&[
        "v", "--bench", "f.pdf", "--bench-out", "o.json", "--renderer", "pdfium", "--dpr", "2",
        "--pdfium-threads", "4",
    ]);
    assert!(a.bench);
    assert_eq!(a.file.as_deref(), Some("f.pdf"));
    assert_eq!(a.bench_out.as_deref(), Some("o.json"));
    assert_eq!(a.renderer.as_deref(), Some("pdfium"));
    assert_eq!(a.dpr, Some(2.0));
    assert_eq!(a.pdfium_threads, Some(4));
}

#[test]
fn unknown_flags_are_ignored() {
    let a = p(&["v", "--something", "x.pdf"]);
    assert_eq!(a.file.as_deref(), Some("x.pdf"));
}
