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
    assert_eq!(a.dpr, Some(2.0));
    assert_eq!(a.pdfium_threads, Some(4));
    assert_eq!(a.bench_page, None);
    let b = p(&["v", "--bench", "f.pdf", "--bench-page", "47", "--bench-size", "2560x1400"]);
    assert_eq!(b.bench_page, Some(47));
    assert_eq!(b.bench_size, Some((2560.0, 1400.0)));
    assert_eq!(p(&["v", "--bench-size", "big"]).bench_size, None);
}

#[test]
fn unknown_flags_are_ignored() {
    let a = p(&["v", "--something", "x.pdf"]);
    assert_eq!(a.file.as_deref(), Some("x.pdf"));
}

#[test]
fn legacy_renderer_flag_consumes_its_value() {
    // --renderer was removed with pdf.js; its value must not be taken as the file.
    let a = p(&["v", "--renderer", "pdfium", "x.pdf"]);
    assert_eq!(a.file.as_deref(), Some("x.pdf"));
}

#[test]
fn stamp_popouts_only_for_one() {
    use vellum_lib::stamp_popouts;
    assert!(stamp_popouts(Some("1")));
    assert!(stamp_popouts(Some(" 1 ")));
    assert!(!stamp_popouts(Some("0")));
    assert!(!stamp_popouts(Some("")));
    assert!(!stamp_popouts(Some("yes")));
    assert!(!stamp_popouts(None));
    // Never from the command line: the default is the context bar's pickers.
    assert!(!p(&["v", "x.pdf"]).stamp_popouts);
}
